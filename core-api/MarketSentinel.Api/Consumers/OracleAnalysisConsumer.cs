using MarketSentinel.Api.Contracts;
using MarketSentinel.Api.Data;
using MarketSentinel.Api.Models;
using MassTransit;
using StackExchange.Redis;
using System.Text.Json;

namespace MarketSentinel.Api.Consumers
{
    public class OracleAnalysisConsumer : IConsumer<OracleAnalysisMessage>
    {
        private readonly MarketDbContext _db;
        private readonly IDatabase _redis;
        private readonly ILogger<OracleAnalysisConsumer> _logger;

        public OracleAnalysisConsumer(MarketDbContext db, IConnectionMultiplexer redis, ILogger<OracleAnalysisConsumer> logger)
        {
            _db = db;
            _redis = redis.GetDatabase();
            _logger = logger;
        }

        public async Task Consume(ConsumeContext<OracleAnalysisMessage> context)
        {
            var msg = context.Message;

            var record = new OracleAnalysis
            {
                Symbol           = msg.Symbol,
                AssetType        = msg.AssetType,
                PriceAtAnalysis  = msg.PriceAtAnalysis,
                Recommendation   = msg.Recommendation,
                Confidence       = msg.Confidence,
                ShortTermBias    = msg.ShortTermBias,
                ShortTermTarget  = msg.ShortTermTarget,
                ShortTermStop    = msg.ShortTermStop,
                PositionSizePct  = msg.PositionSizePct,
                RiskRewardRatio  = msg.RiskRewardRatio,
                LongTermBias     = msg.LongTermBias,
                LongTermTarget   = msg.LongTermTarget,
                Reasoning        = msg.Reasoning,
                KeyDrivers       = msg.KeyDrivers,
                Risks            = msg.Risks,
                WatchPoints      = msg.WatchPoints,
                TechnicalScore   = msg.TechnicalScore,
                NewsScore        = msg.NewsScore,
                MacroScore       = msg.MacroScore,
                FundamentalScore = msg.FundamentalScore,
            };

            _db.OracleAnalyses.Add(record);
            await _db.SaveChangesAsync();

            // Son Oracle analizini Redis cache'e yaz (2 saat TTL)
            var key = $"oracle:latest:{msg.Symbol.ToLower()}";
            await _redis.StringSetAsync(key, JsonSerializer.Serialize(record), TimeSpan.FromHours(2));

            _logger.LogInformation(
                "Oracle analizi kaydedildi: {Symbol} → {Rec} (güven: {Conf:P0})",
                msg.Symbol, msg.Recommendation, msg.Confidence
            );
        }
    }
}
