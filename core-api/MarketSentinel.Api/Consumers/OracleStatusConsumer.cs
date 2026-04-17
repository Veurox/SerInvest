using MarketSentinel.Api.Contracts;
using MarketSentinel.Api.Models;
using MassTransit;
using StackExchange.Redis;
using System.Text.Json;

namespace MarketSentinel.Api.Consumers
{
    public class OracleStatusConsumer : IConsumer<OracleStatusMessage>
    {
        private readonly IDatabase _redis;
        private readonly ILogger<OracleStatusConsumer> _logger;

        public OracleStatusConsumer(IConnectionMultiplexer redis, ILogger<OracleStatusConsumer> logger)
        {
            _redis = redis.GetDatabase();
            _logger = logger;
        }

        public async Task Consume(ConsumeContext<OracleStatusMessage> context)
        {
            var msg = context.Message;
            
            var logEntry = new OracleSysLog
            {
                Level = msg.Level,
                Message = msg.Message,
                Timestamp = msg.Timestamp,
                Accuracy = msg.Accuracy
            };

            var json = JsonSerializer.Serialize(logEntry);

            // Add to redis list (Oracle:Syslogs)
            await _redis.ListLeftPushAsync("oracle:syslogs", json);
            // Limit to 100 entries
            await _redis.ListTrimAsync("oracle:syslogs", 0, 99);

            // Save the last known accuracy in a separate key for quick access if needed
            await _redis.StringSetAsync("oracle:accuracy", msg.Accuracy.ToString(), TimeSpan.FromHours(24));

            _logger.LogInformation("Oracle Syslog alındı: [{Level}] {Msg}", msg.Level, msg.Message);
        }
    }
}
