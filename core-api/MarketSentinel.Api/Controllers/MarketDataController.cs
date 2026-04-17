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

        public MarketDataController(MarketDbContext db, IConnectionMultiplexer redis, ILogger<MarketDataController> logger)
        {
            _db = db;
            _redis = redis.GetDatabase();
            _logger = logger;
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
    }
}
