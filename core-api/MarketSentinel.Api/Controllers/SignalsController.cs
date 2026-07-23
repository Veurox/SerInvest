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

        /// <summary>
        /// Son N saatteki haberleri her sembol için aggregate eder.
        /// Oracle bu endpoint'i kullanır — eski "limit=100" yöntemi global haberlerle
        /// dolup BIST haberlerini pencereden atıyordu. Burada zaman penceresi sabit.
        /// Her sembol için: zaman-decay ağırlıklı sentiment + sayım + son haber zamanı.
        /// </summary>
        [HttpGet("aggregate")]
        public async Task<IActionResult> GetAggregatedSentiment([FromQuery] int hours = 48)
        {
            try
            {
                hours = Math.Clamp(hours, 1, 168); // 1 saat - 1 hafta arası
                var since = DateTime.UtcNow.AddHours(-hours);

                var rows = await _context.MarketSignals
                    .Where(s => s.CreatedAt >= since)
                    .Select(s => new
                    {
                        s.Entity,
                        s.AssetType,
                        s.SentimentScore,
                        s.IsGeopolitical,
                        s.CreatedAt,
                        // Faz 3 (ml v4): meta-labeling özellikleri
                        s.EventType,
                        s.Novelty,
                    })
                    .ToListAsync();

                var now = DateTime.UtcNow;
                // Yön ipucu olan olay tipleri (analyst-engine EVENT_PATTERNS ile hizalı)
                var positiveEvents = new HashSet<string> { "TEMETTU", "GERI_ALIM", "SOZLESME", "YATIRIM" };
                var negativeEvents = new HashSet<string> { "CEZA_SORUSTURMA", "JEOPOLITIK" };

                var grouped = rows
                    .GroupBy(r => r.Entity)
                    .Select(g =>
                    {
                        // Zaman-decay: yeni haber daha ağır. half-life = 24 saat.
                        // weight = exp(-Δsaat / 24)
                        var items = g.Select(r =>
                        {
                            var hoursAgo = (now - r.CreatedAt).TotalHours;
                            var w = Math.Exp(-hoursAgo / 24.0);
                            return new { r.SentimentScore, r.IsGeopolitical, Weight = w, r.CreatedAt,
                                         r.EventType, r.Novelty };
                        }).ToList();

                        var totalW = items.Sum(i => i.Weight);
                        var avg    = totalW > 0 ? items.Sum(i => i.SentimentScore * i.Weight) / totalW : 0.0;
                        var geoCt  = items.Count(i => i.IsGeopolitical);
                        var latest = items.Max(i => i.CreatedAt);

                        // Faz 3: yenilik-ağırlıklı sentiment (tekrar haber şişirmesin) +
                        // yön ipuçlu olay sayaçları + ortalama yenilik
                        var totalWN = items.Sum(i => i.Weight * i.Novelty);
                        var avgNov  = totalWN > 0
                            ? items.Sum(i => i.SentimentScore * i.Weight * i.Novelty) / totalWN
                            : 0.0;
                        var meanNovelty = items.Count > 0 ? items.Average(i => i.Novelty) : 1.0;
                        var posEv = items.Count(i => positiveEvents.Contains(i.EventType));
                        var negEv = items.Count(i => negativeEvents.Contains(i.EventType));

                        return new
                        {
                            entity      = g.Key,
                            assetType   = g.First().AssetType,
                            score       = Math.Round(avg, 4),
                            count       = items.Count,
                            geoCount    = geoCt,
                            latestAt    = latest,
                            hoursWindow = hours,
                            // Faz 3 alanları
                            noveltyScore  = Math.Round(avgNov, 4),   // yenilik×decay ağırlıklı sentiment
                            meanNovelty   = Math.Round(meanNovelty, 4),
                            positiveEvents = posEv,
                            negativeEvents = negEv,
                        };
                    })
                    .OrderByDescending(g => g.count)
                    .ToList();

                return Ok(grouped);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Aggregate sentiment sorgulanırken hata");
                return StatusCode(500, new { message = "Sunucu hatası", error = ex.Message });
            }
        }
    }
}
