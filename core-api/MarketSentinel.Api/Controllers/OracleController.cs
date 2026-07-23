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

        // NOT (ml v3): Eski /oracle/walkforward, /oracle/walkforward/details ve
        // /oracle/evaluations uçları kaldırıldı. Bunlar eski füzyon sisteminin
        // dosyalarını (walkforward_summary.json, prediction_log_v2.csv) okuyordu.
        // Yeni sistemde doğrulama/tahmin geçmişi oracle admin API'sinden gelir
        // (/admin/training-info, /admin/prediction-log).
    }
}
