using MarketSentinel.Api.Data;
using MarketSentinel.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using StackExchange.Redis;
using System.Text.Json;

namespace MarketSentinel.Api.Controllers
{
    [ApiController]
    [Route("api/market")]
    public class MarketDataController : ControllerBase
    {
        private readonly MarketDbContext _db;
        private readonly IDatabase _redis;
        private readonly ILogger<MarketDataController> _logger;
        private readonly IHttpClientFactory _httpFactory;

        public MarketDataController(MarketDbContext db, IConnectionMultiplexer redis,
            ILogger<MarketDataController> logger, IHttpClientFactory httpFactory)
        {
            _db = db;
            _redis = redis.GetDatabase();
            _logger = logger;
            _httpFactory = httpFactory;
        }

        /// <summary>
        /// UI'da bir varlığa tıklayınca açılan çoklu zaman dilimli grafik verisi.
        /// market-data-service'in Flask /chart endpoint'ine proxy yapar.
        /// tf: 1H, 1D, 1W, 1M, 3M, 1Y, 5Y
        /// </summary>
        [HttpGet("{symbol}/chart")]
        public async Task<IActionResult> GetChart(string symbol, [FromQuery] string tf = "1D")
        {
            var http = _httpFactory.CreateClient("market-data-chart");
            try
            {
                var resp = await http.GetAsync($"/chart/{Uri.EscapeDataString(symbol)}?tf={Uri.EscapeDataString(tf)}");
                var body = await resp.Content.ReadAsStringAsync();
                return new ContentResult
                {
                    Content = body,
                    ContentType = "application/json",
                    StatusCode = (int)resp.StatusCode
                };
            }
            catch (Exception ex)
            {
                _logger.LogWarning("Chart proxy hatası {Symbol}/{Tf}: {Msg}", symbol, tf, ex.Message);
                return StatusCode(502, new { error = "chart servisine ulaşılamadı", detail = ex.Message });
            }
        }

        /// <summary>Tüm izlenen varlıkların en son fiyat + sinyal özetini döndürür.</summary>
        [HttpGet("overview")]
        public async Task<IActionResult> GetOverview()
        {
            // EF Core GroupBy+First() PostgreSQL'de çalışmaz; join yaklaşımı kullanılır.
            var maxDates = _db.PriceData
                .GroupBy(p => p.Symbol)
                .Select(g => new { Symbol = g.Key, MaxDate = g.Max(x => x.RecordedAt) });

            var latest = await _db.PriceData
                .Join(maxDates,
                    p => new { p.Symbol, Date = p.RecordedAt },
                    m => new { m.Symbol, Date = m.MaxDate },
                    (p, _) => p)
                .OrderBy(p => p.AssetType).ThenBy(p => p.Symbol)
                .ToListAsync();

            return Ok(latest);
        }

        /// <summary>Belirli bir varlığın en son fiyat ve teknik indikatörlerini döndürür.</summary>
        [HttpGet("{symbol}/latest")]
        public async Task<IActionResult> GetLatest(string symbol)
        {
            // Önce Redis cache'e bak
            try
            {
                var cacheKey = $"market:latest:{symbol.ToLower()}";
                var cached = await _redis.StringGetAsync(cacheKey);
                if (!cached.IsNull)
                    return Ok(JsonSerializer.Deserialize<PriceData>(cached!));
            }
            catch (Exception ex)
            {
                _logger.LogWarning("Redis cache hatası: {Msg}", ex.Message);
            }

            var data = await _db.PriceData
                .Where(p => p.Symbol.ToLower() == symbol.ToLower())
                .OrderByDescending(p => p.RecordedAt)
                .FirstOrDefaultAsync();

            if (data == null) return NotFound(new { message = $"{symbol} için veri bulunamadı." });
            return Ok(data);
        }

        /// <summary>Geçmiş fiyat verilerini döndürür (varsayılan 30 gün).</summary>
        [HttpGet("{symbol}/history")]
        public async Task<IActionResult> GetHistory(string symbol, [FromQuery] int days = 30)
        {
            var since = DateTime.UtcNow.AddDays(-Math.Min(days, 365));
            var history = await _db.PriceData
                .Where(p => p.Symbol.ToLower() == symbol.ToLower() && p.RecordedAt >= since)
                .OrderBy(p => p.RecordedAt)
                .Select(p => new
                {
                    p.RecordedAt,
                    p.Open, p.High, p.Low, p.Close, p.Volume,
                    p.Rsi, p.MacdLine, p.MacdSignal, p.MacdHistogram,
                    p.BbUpper, p.BbMiddle, p.BbLower,
                    p.Ema20, p.Ema50,
                    p.Signal, p.SignalStrength
                })
                .ToListAsync();

            return Ok(history);
        }

        /// <summary>Belirli bir varlık için son haberleri döndürür.</summary>
        [HttpGet("{symbol}/news")]
        public async Task<IActionResult> GetNews(string symbol, [FromQuery] int limit = 10)
        {
            var news = await _db.MarketSignals
                .Where(s => s.Entity.ToLower() == symbol.ToLower())
                .OrderByDescending(s => s.CreatedAt)
                .Take(Math.Min(limit, 50))
                .ToListAsync();

            return Ok(news);
        }

        /// <summary>İzlenen tüm varlıkları (sembol + tür) listeler.</summary>
        [HttpGet("assets")]
        public async Task<IActionResult> GetTrackedAssets()
        {
            var assets = await _db.PriceData
                .GroupBy(p => new { p.Symbol, p.AssetType })
                .Select(g => new { g.Key.Symbol, g.Key.AssetType, LastUpdate = g.Max(p => p.RecordedAt) })
                .OrderBy(a => a.AssetType).ThenBy(a => a.Symbol)
                .ToListAsync();

            return Ok(assets);
        }

        /// <summary>
        /// Bir sembolün son N günlük fiyat geçmişini döndürür (sparkline için).
        /// Her gün için son kayıt alınır → günde max 1 nokta.
        /// </summary>
        [HttpGet("price-history/{symbol}")]
        public async Task<IActionResult> GetPriceHistory(
            string symbol, [FromQuery] int days = 7)
        {
            symbol = symbol.ToUpper().Trim();
            days = Math.Clamp(days, 1, 90);

            var cutoff = DateTime.UtcNow.AddDays(-days - 1);
            // Son N günün kayıtlarını al (5dk arayla yazılıyor, çok satır olur)
            var rows = await _db.PriceData
                .Where(p => p.Symbol == symbol && p.RecordedAt >= cutoff)
                .OrderBy(p => p.RecordedAt)
                .Select(p => new { p.RecordedAt, p.Close })
                .ToListAsync();

            // Gün başına son fiyatı al — sparkline daha temiz
            var byDay = rows
                .Where(r => r.Close.HasValue)
                .GroupBy(r => r.RecordedAt.Date)
                .Select(g => new {
                    date  = g.Key,
                    close = g.OrderByDescending(x => x.RecordedAt).First().Close,
                })
                .OrderBy(x => x.date)
                .Take(days)
                .ToList();

            return Ok(new {
                symbol,
                days,
                points = byDay.Select(p => new { p.date, p.close }).ToList(),
            });
        }
    }
}
