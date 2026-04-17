using MarketSentinel.Api.Data;
using MarketSentinel.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using StackExchange.Redis;
using System.Text.Json;

namespace MarketSentinel.Api.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class SignalsController : ControllerBase
    {
        private readonly MarketDbContext _context;
        private readonly IDatabase _redis;
        private readonly ILogger<SignalsController> _logger;

        public SignalsController(MarketDbContext context, IConnectionMultiplexer redis, ILogger<SignalsController> logger)
        {
            _context = context;
            _redis = redis.GetDatabase();
            _logger = logger;
        }

        [HttpGet("{asset}")]
        public async Task<IActionResult> GetSignals(string asset, [FromQuery] int limit = 20)
        {
            try
            {
                var cacheKey = $"signals:{asset.ToLower()}";
                try
                {
                    var cached = await _redis.StringGetAsync(cacheKey);
                    if (!cached.IsNull)
                        return Ok(JsonSerializer.Deserialize<List<MarketSignal>>(cached!));
                }
                catch { /* Redis hatasında DB'ye devam et */ }

                var signals = await _context.MarketSignals
                    .Where(s => s.Entity.ToLower() == asset.ToLower())
                    .OrderByDescending(s => s.CreatedAt)
                    .Take(Math.Min(limit, 100))
                    .ToListAsync();

                if (signals.Count > 0)
                {
                    try { await _redis.StringSetAsync(cacheKey, JsonSerializer.Serialize(signals), TimeSpan.FromMinutes(2)); }
                    catch { }
                }

                return Ok(signals);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Sinyal sorgulama hatası: {Asset}", asset);
                return StatusCode(500, new { message = "Sunucu hatası", error = ex.Message });
            }
        }

        [HttpGet("latest")]
        public async Task<IActionResult> GetLatestSignals([FromQuery] int limit = 30)
        {
            try
            {
                var signals = await _context.MarketSignals
                    .OrderByDescending(s => s.CreatedAt)
                    .Take(Math.Min(limit, 200))
                    .ToListAsync();

                return Ok(signals);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Son sinyaller sorgulanırken hata");
                return StatusCode(500, new { message = "Sunucu hatası", error = ex.Message });
            }
        }
    }
}
