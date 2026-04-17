using MarketSentinel.Api.Contracts;
using MarketSentinel.Api.Data;
using MarketSentinel.Api.Models;
using MassTransit;
using StackExchange.Redis;
using System.Text.Json;

namespace MarketSentinel.Api.Consumers
{
    public class MarketDataConsumer : IConsumer<MarketDataMessage>
    {
        private readonly MarketDbContext _db;
        private readonly IDatabase _redis;
        private readonly ILogger<MarketDataConsumer> _logger;

        public MarketDataConsumer(MarketDbContext db, IConnectionMultiplexer redis, ILogger<MarketDataConsumer> logger)
        {
            _db = db;
            _redis = redis.GetDatabase();
            _logger = logger;
        }

        public async Task Consume(ConsumeContext<MarketDataMessage> context)
        {
            var msg = context.Message;

            var record = new PriceData
            {
                Symbol        = msg.Symbol,
                AssetType     = msg.AssetType,
                Close         = msg.Close,
                Open          = msg.Open,
                High          = msg.High,
                Low           = msg.Low,
                Volume        = msg.Volume,
                Rsi           = msg.Rsi,
                MacdLine      = msg.MacdLine,
                MacdSignal    = msg.MacdSignal,
                MacdHistogram = msg.MacdHistogram,
                BbUpper       = msg.BbUpper,
                BbMiddle      = msg.BbMiddle,
                BbLower       = msg.BbLower,
                Ema9          = msg.Ema9,
                Ema20         = msg.Ema20,
                Ema50         = msg.Ema50,
                Ema200        = msg.Ema200,
                Signal        = msg.Signal,
                SignalStrength = msg.SignalStrength,
            };

            _db.PriceData.Add(record);
            await _db.SaveChangesAsync();

            // Redis'e son veriyi cache'le (10 dk TTL)
            var cacheKey = $"market:latest:{msg.Symbol.ToLower()}";
            await _redis.StringSetAsync(
                cacheKey,
                JsonSerializer.Serialize(record),
                TimeSpan.FromMinutes(10)
            );

            _logger.LogInformation(
                "Piyasa verisi kaydedildi: {Symbol} {Close} [{Signal} %{Strength}]",
                msg.Symbol, msg.Close, msg.Signal, msg.SignalStrength
            );
        }
    }
}
