using MarketSentinel.Api.Contracts;
using MarketSentinel.Api.Data;
using MarketSentinel.Api.Models;
using MassTransit;

namespace MarketSentinel.Api.Consumers
{
    public class AnalyzedNewsConsumer : IConsumer<AnalyzedNewsMessage>
    {
        private readonly ILogger<AnalyzedNewsConsumer> _logger;
        private readonly MarketDbContext _dbContext;

        public AnalyzedNewsConsumer(ILogger<AnalyzedNewsConsumer> logger, MarketDbContext dbContext)
        {
            _logger = logger;
            _dbContext = dbContext;
        }

        public async Task Consume(ConsumeContext<AnalyzedNewsMessage> context)
        {
            var msg = context.Message;

            string direction = msg.SentimentLabel switch
            {
                "BULLISH" => "Up",
                "BEARISH" => "Down",
                _         => "Neutral"
            };

            double sourceReliability = msg.Source switch
            {
                "AA Ekonomi"      => 0.85,
                "Bloomberg HT"    => 0.90,
                "Dünya Gazetesi"  => 0.80,
                "CNBC Economy"    => 0.90,
                "CNBC Markets"    => 0.90,
                "MarketWatch"     => 0.85,
                _                 => 0.70
            };

            // Jeopolitik haberler daha az kesin tahmin → güven düşer
            double geopoliticalPenalty = msg.IsGeopolitical ? 0.85 : 1.0;
            double confidence = Math.Abs(msg.SentimentScore) * sourceReliability * geopoliticalPenalty * 100;

            var signal = new MarketSignal
            {
                Entity               = msg.Entity,
                Source               = msg.Source,
                AssetType            = msg.AssetType,
                SentimentLabel       = msg.SentimentLabel,
                SentimentScore       = msg.SentimentScore,
                IsGeopolitical       = msg.IsGeopolitical,
                Headline             = msg.Headline,
                Summary              = msg.Summary,
                Url                  = msg.Url,
                Direction            = direction,
                SignalConfidenceScore = Math.Round(confidence, 2),
            };

            _dbContext.MarketSignals.Add(signal);
            await _dbContext.SaveChangesAsync();

            _logger.LogInformation(
                "Haber sinyali kaydedildi: {Entity} → {Direction} ({Label}, güven: {Confidence:F1}%)",
                msg.Entity, direction, msg.SentimentLabel, confidence
            );
        }
    }
}
