using MarketSentinel.Api.Data;
using MarketSentinel.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using StackExchange.Redis;
using System.Text.Json;

namespace MarketSentinel.Api.Controllers
{
    [ApiController]
    [Route("api/oracle")]
    public class OracleController : ControllerBase
    {
        private readonly MarketDbContext _db;
        private readonly IDatabase _redis;

        public OracleController(MarketDbContext db, IConnectionMultiplexer redis)
        {
            _db = db;
            _redis = redis.GetDatabase();
        }

        /// <summary>Tüm varlıkların en son Oracle analizini döndürür.</summary>
        [HttpGet("overview")]
        public async Task<IActionResult> GetOverview()
        {
            // EF Core GroupBy+First() PostgreSQL'de çalışmaz; join yaklaşımı kullanılır.
            var maxDates = _db.OracleAnalyses
                .GroupBy(o => o.Symbol)
                .Select(g => new { Symbol = g.Key, MaxDate = g.Max(x => x.AnalyzedAt) });

            var latest = await _db.OracleAnalyses
                .Join(maxDates,
                    o => new { o.Symbol, Date = o.AnalyzedAt },
                    m => new { m.Symbol, Date = m.MaxDate },
                    (o, _) => o)
                .OrderByDescending(o => o.Confidence)
                .ToListAsync();

            return Ok(latest);
        }

        /// <summary>Belirli bir varlığın en son Oracle analizini döndürür.</summary>
        [HttpGet("{symbol}/latest")]
        public async Task<IActionResult> GetLatest(string symbol)
        {
            try
            {
                var key = $"oracle:latest:{symbol.ToLower()}";
                var cached = await _redis.StringGetAsync(key);
                if (!cached.IsNull)
                    return Ok(JsonSerializer.Deserialize<OracleAnalysis>(cached!));
            }
            catch { }

            var analysis = await _db.OracleAnalyses
                .Where(o => o.Symbol.ToLower() == symbol.ToLower())
                .OrderByDescending(o => o.AnalyzedAt)
                .FirstOrDefaultAsync();

            if (analysis == null) return NotFound(new { message = $"{symbol} için Oracle analizi bulunamadı." });
            return Ok(analysis);
        }

        /// <summary>Belirli bir varlığın analiz geçmişini döndürür.</summary>
        [HttpGet("{symbol}/history")]
        public async Task<IActionResult> GetHistory(string symbol, [FromQuery] int limit = 10)
        {
            var history = await _db.OracleAnalyses
                .Where(o => o.Symbol.ToLower() == symbol.ToLower())
                .OrderByDescending(o => o.AnalyzedAt)
                .Take(Math.Min(limit, 50))
                .ToListAsync();

            return Ok(history);
        }

        /// <summary>Tavsiyeye göre filtrelenmiş analizleri döndürür.</summary>
        [HttpGet("filter")]
        public async Task<IActionResult> Filter([FromQuery] string recommendation = "ALIM")
        {
            var maxDates = _db.OracleAnalyses
                .GroupBy(o => o.Symbol)
                .Select(g => new { Symbol = g.Key, MaxDate = g.Max(x => x.AnalyzedAt) });

            var results = await _db.OracleAnalyses
                .Join(maxDates,
                    o => new { o.Symbol, Date = o.AnalyzedAt },
                    m => new { m.Symbol, Date = m.MaxDate },
                    (o, _) => o)
                .Where(o => o.Recommendation.Contains(recommendation.ToUpper()))
                .OrderByDescending(o => o.Confidence)
                .ToListAsync();

            return Ok(results);
        }

        /// <summary>Oracle modelinin canlı eğitim ve analiz loglarını döndürür.</summary>
        [HttpGet("syslogs")]
        public async Task<IActionResult> GetSyslogs()
        {
            try
            {
                var logs = await _redis.ListRangeAsync("oracle:syslogs", 0, 99);
                var parsedLogs = logs.Select(l => JsonSerializer.Deserialize<OracleSysLog>(l!)).ToList();
                
                var accString = await _redis.StringGetAsync("oracle:accuracy");
                double accuracy = 0;
                if (!accString.IsNull) double.TryParse(accString, out accuracy);

                return Ok(new { logs = parsedLogs, currentAccuracy = accuracy });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { message = "Loglar alınırken hata oluştu.", error = ex.Message });
            }
        }

        /// <summary>Walk-Forward Backtest özet sonuçlarını döndürür.</summary>
        [HttpGet("walkforward")]
        public IActionResult GetWalkForwardSummary()
        {
            var path = "/app/oracle_models/walkforward_summary.json";
            if (!System.IO.File.Exists(path))
                return Ok(new { status = "pending", message = "Walk-Forward backtest henüz tamamlanmadı. Arka planda devam ediyor..." });

            try
            {
                var json = System.IO.File.ReadAllText(path);
                using var doc = JsonDocument.Parse(json);
                return Ok(doc.RootElement);
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { message = "Walk-Forward özeti okunamadı.", error = ex.Message });
            }
        }

        /// <summary>Walk-Forward Backtest ham sonuçlarını (adım bazlı) döndürür.</summary>
        [HttpGet("walkforward/details")]
        public IActionResult GetWalkForwardDetails([FromQuery] string? symbol = null, [FromQuery] int limit = 500)
        {
            var path = "/app/oracle_models/walkforward_results.csv";
            if (!System.IO.File.Exists(path))
                return Ok(new List<object>());

            try
            {
                var lines = System.IO.File.ReadAllLines(path);
                if (lines.Length <= 1) return Ok(new List<object>());

                var headers = lines[0].Split(',');
                var results = new List<object>();

                // Sondan başa oku
                for (int i = lines.Length - 1; i > 0 && results.Count < limit; i--)
                {
                    var cols = lines[i].Split(',');
                    if (cols.Length < headers.Length) continue;
                    if (!string.IsNullOrEmpty(symbol) &&
                        !cols[1].Equals(symbol, StringComparison.OrdinalIgnoreCase))
                        continue;

                    results.Add(new
                    {
                        Date       = cols[0],
                        Symbol     = cols[1],
                        Step       = int.TryParse(cols[2], out int s) ? s : 0,
                        TrainSize  = int.TryParse(cols[3], out int ts) ? ts : 0,
                        Predicted  = cols[4],
                        Actual     = cols[5],
                        Correct    = cols[6] == "1",
                        Confidence = double.TryParse(cols[7], out double conf) ? conf : 0,
                        Close      = double.TryParse(cols[8], out double cl) ? cl : 0,
                    });
                }

                return Ok(results);
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { message = "Walk-Forward detayları okunamadı.", error = ex.Message });
            }
        }

        /// <summary>Geçmiş tahminlerin ve doğrulanma durumlarının sonuçlarını (CSV tabanlı) getirir.</summary>
        [HttpGet("evaluations")]
        public IActionResult GetEvaluations([FromQuery] int limit = 100)
        {
            var path = "/app/oracle_models/prediction_log_v2.csv";
            
            // Windows üzerinde (IDE direkt çalıştırılırsa) docker dışında bir test yapılıyorsa graceful handling
            if (!System.IO.File.Exists(path))
            {
                return Ok(new List<object>()); // Boş liste dön, çökmeyi engelle
            }

            try
            {
                var lines = System.IO.File.ReadAllLines(path);
                if (lines.Length <= 1) return Ok(new List<object>()); // Sadece başlık veya boş

                var results = new List<object>();
                var headers = lines[0].Split(',');

                // Sondan başa doğru oku (en güncelleri getirmek için - limit kadar)
                for (int i = lines.Length - 1; i > 0 && results.Count < limit; i--)
                {
                    var cols = lines[i].Split(',');
                    if (cols.Length < headers.Length) continue;

                    results.Add(new
                    {
                        Timestamp = cols[0],
                        Symbol    = cols[1],
                        Predicted = cols[3],
                        Confidence= double.TryParse(cols[4], out double c) ? c : 0,
                        Close     = double.TryParse(cols[5], out double cl) ? cl : 0,
                        Target    = cols.Length > 6 ? (double.TryParse(cols[6], out double t) ? t : 0) : 0,
                        Eval1d    = cols.Length > 7 ? cols[7] : "",
                        Eval5d    = cols.Length > 8 ? cols[8] : "",
                        Eval20d   = cols.Length > 9 ? cols[9] : "",
                    });
                }

                return Ok(results);
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { message = "Tahmin geçmişi okunurken hata oluştu.", error = ex.Message });
            }
        }
    }
}
