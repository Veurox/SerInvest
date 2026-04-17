using MarketSentinel.Api.Contracts;
using MarketSentinel.Api.Data;
using MarketSentinel.Api.Models;
using MassTransit;
using StackExchange.Redis;
using System.Text.Json;

namespace MarketSentinel.Api.Consumers
{
    public class FundamentalDataConsumer : IConsumer<FundamentalDataMessage>
    {
        private readonly MarketDbContext _db;
        private readonly IDatabase _redis;
        private readonly ILogger<FundamentalDataConsumer> _logger;

        public FundamentalDataConsumer(
            MarketDbContext db,
            IConnectionMultiplexer redis,
            ILogger<FundamentalDataConsumer> logger)
        {
            _db    = db;
            _redis = redis.GetDatabase();
            _logger = logger;
        }

        public async Task Consume(ConsumeContext<FundamentalDataMessage> context)
        {
            var msg = context.Message;

            var record = new FundamentalData
            {
                Symbol          = msg.Symbol,
                AssetType       = msg.AssetType,
                CompanyName     = msg.CompanyName,
                Sector          = msg.Sector,
                PeRatio         = msg.PeRatio,
                ForwardPe       = msg.ForwardPe,
                PbRatio         = msg.PbRatio,
                Roe             = msg.Roe,
                Eps             = msg.Eps,
                ForwardEps      = msg.ForwardEps,
                Ebitda          = msg.Ebitda,
                EbitdaMargin    = msg.EbitdaMargin,
                NetDebtEbitda   = msg.NetDebtEbitda,
                TcmbRatePct     = msg.TcmbRatePct,
                DebtToEquity    = msg.DebtToEquity,
                Beta            = msg.Beta,
                RevenueGrowth   = msg.RevenueGrowth,
                EarningsGrowth  = msg.EarningsGrowth,
                DividendYield   = msg.DividendYield,
                MarketCap       = msg.MarketCap,
                Position52W     = msg.Position52W,
                FundamentalScore = msg.FundamentalScore,
                LastKapTitle    = msg.LastKapTitle,
                LastKapDate     = msg.LastKapDate,
                UpdatedAt       = DateTime.UtcNow,
            };

            _db.FundamentalData.Add(record);
            await _db.SaveChangesAsync();

            // Son temel veriyi Redis'e cache'le (8 saat TTL — fundamental veriler çeyreklik değişir)
            var key = $"fundamental:latest:{msg.Symbol.ToLower()}";
            await _redis.StringSetAsync(
                key,
                JsonSerializer.Serialize(record),
                TimeSpan.FromHours(8)
            );

            _logger.LogInformation(
                "Temel veri kaydedildi: {Symbol} F/K={PE} ROE={ROE:P0} Skor={Score:F2}",
                msg.Symbol, msg.PeRatio, msg.Roe, msg.FundamentalScore
            );
        }
    }
}
