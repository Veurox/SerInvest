using MarketSentinel.Api.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using StackExchange.Redis;

namespace MarketSentinel.Api.Controllers
{
    [ApiController]
    [Route("api/status")]
    public class StatusController : ControllerBase
    {
        private readonly MarketDbContext _db;
        private readonly IConnectionMultiplexer _redis;

        public StatusController(MarketDbContext db, IConnectionMultiplexer redis)
        {
            _db    = db;
            _redis = redis;
        }

        [HttpGet]
        public async Task<IActionResult> GetStatus()
        {
            var status = new Dictionary<string, object>();

            // PostgreSQL
            try
            {
                await _db.Database.ExecuteSqlRawAsync("SELECT 1");
                status["db"] = "ok";
            }
            catch { status["db"] = "error"; }

            // Redis
            try
            {
                _redis.GetDatabase().Ping();
                status["redis"] = "ok";
            }
            catch { status["redis"] = "error"; }

            // market-data-service: PriceData var mı?
            var priceCount = await _db.PriceData.CountAsync();
            status["market_data_service"] = priceCount > 0 ? "ok" : "waiting";
            status["tracked_assets"]      = priceCount > 0
                ? await _db.PriceData.Select(p => p.Symbol).Distinct().CountAsync()
                : 0;

            // analyst-engine: MarketSignal var mı?
            var newsCount = await _db.MarketSignals.CountAsync();
            status["analyst_engine"] = newsCount > 0 ? "ok" : "waiting";
            status["news_signals"]   = newsCount;

            // ai-oracle-service: OracleAnalysis var mı?
            var oracleCount = await _db.OracleAnalyses.CountAsync();
            status["oracle_service"]   = oracleCount > 0 ? "ok" : "training";
            status["oracle_analyses"]  = oracleCount;

            // Son güncelleme zamanları
            if (priceCount > 0)
            {
                var lastPrice = await _db.PriceData
                    .OrderByDescending(p => p.RecordedAt)
                    .Select(p => p.RecordedAt)
                    .FirstOrDefaultAsync();
                status["last_price_update"] = lastPrice;
            }

            if (oracleCount > 0)
            {
                var lastOracle = await _db.OracleAnalyses
                    .OrderByDescending(o => o.AnalyzedAt)
                    .Select(o => o.AnalyzedAt)
                    .FirstOrDefaultAsync();
                status["last_oracle_update"] = lastOracle;
            }

            // Genel hazırlık
            status["ready"] = priceCount > 0 && oracleCount > 0;

            return Ok(status);
        }
    }
}
