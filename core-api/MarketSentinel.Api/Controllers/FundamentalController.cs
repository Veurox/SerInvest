using MarketSentinel.Api.Data;
using MarketSentinel.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using StackExchange.Redis;
using System.Text.Json;

namespace MarketSentinel.Api.Controllers
{
    [ApiController]
    [Route("api/fundamental")]
    public class FundamentalController : ControllerBase
    {
        private readonly MarketDbContext _db;
        private readonly IDatabase _redis;

        public FundamentalController(MarketDbContext db, IConnectionMultiplexer redis)
        {
            _db    = db;
            _redis = redis.GetDatabase();
        }

        /// <summary>Tüm varlıkların en güncel temel analiz verisini döndürür.</summary>
        [HttpGet("overview")]
        public async Task<IActionResult> GetOverview()
        {
            var maxDates = _db.FundamentalData
                .GroupBy(f => f.Symbol)
                .Select(g => new { Symbol = g.Key, MaxDate = g.Max(x => x.UpdatedAt) });

            var latest = await _db.FundamentalData
                .Join(maxDates,
                    f => new { f.Symbol, Date = f.UpdatedAt },
                    m => new { m.Symbol, Date = m.MaxDate },
                    (f, _) => f)
                .OrderByDescending(f => f.FundamentalScore)
                .ToListAsync();

            return Ok(latest);
        }

        /// <summary>Belirli bir sembol için en güncel temel analiz verisini döndürür.</summary>
        [HttpGet("{symbol}")]
        public async Task<IActionResult> GetLatest(string symbol)
        {
            // Redis cache kontrolü
            try
            {
                var key    = $"fundamental:latest:{symbol.ToLower()}";
                var cached = await _redis.StringGetAsync(key);
                if (!cached.IsNull)
                    return Ok(JsonSerializer.Deserialize<FundamentalData>(cached!));
            }
            catch { }

            var data = await _db.FundamentalData
                .Where(f => f.Symbol.ToLower() == symbol.ToLower())
                .OrderByDescending(f => f.UpdatedAt)
                .FirstOrDefaultAsync();

            if (data == null)
                return NotFound(new { message = $"{symbol} için temel analiz verisi bulunamadı." });

            return Ok(data);
        }

        /// <summary>
        /// Temel skor filtreli özet.
        /// strength: "strong" (>0.6), "neutral" (0.4-0.6), "weak" (<0.4)
        /// </summary>
        [HttpGet("filter")]
        public async Task<IActionResult> Filter([FromQuery] string strength = "strong")
        {
            var maxDates = _db.FundamentalData
                .GroupBy(f => f.Symbol)
                .Select(g => new { Symbol = g.Key, MaxDate = g.Max(x => x.UpdatedAt) });

            var query = _db.FundamentalData
                .Join(maxDates,
                    f => new { f.Symbol, Date = f.UpdatedAt },
                    m => new { m.Symbol, Date = m.MaxDate },
                    (f, _) => f);

            query = strength.ToLower() switch
            {
                "strong"  => query.Where(f => f.FundamentalScore > 0.60),
                "weak"    => query.Where(f => f.FundamentalScore < 0.40),
                _         => query.Where(f => f.FundamentalScore >= 0.40 && f.FundamentalScore <= 0.60),
            };

            var results = await query
                .OrderByDescending(f => f.FundamentalScore)
                .ToListAsync();

            return Ok(results);
        }

        /// <summary>Belirli bir sembolün temel analiz geçmişini döndürür.</summary>
        [HttpGet("{symbol}/history")]
        public async Task<IActionResult> GetHistory(string symbol, [FromQuery] int limit = 10)
        {
            var history = await _db.FundamentalData
                .Where(f => f.Symbol.ToLower() == symbol.ToLower())
                .OrderByDescending(f => f.UpdatedAt)
                .Take(Math.Min(limit, 50))
                .ToListAsync();

            return Ok(history);
        }
    }
}
