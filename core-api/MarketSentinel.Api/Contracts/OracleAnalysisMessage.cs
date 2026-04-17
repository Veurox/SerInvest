using System.Text.Json.Serialization;

namespace MarketSentinel.Api.Contracts
{
    public class OracleAnalysisMessage
    {
        [JsonPropertyName("symbol")]
        public string Symbol { get; set; } = string.Empty;

        [JsonPropertyName("asset_type")]
        public string AssetType { get; set; } = string.Empty;

        [JsonPropertyName("price_at_analysis")]
        public double? PriceAtAnalysis { get; set; }

        [JsonPropertyName("recommendation")]
        public string Recommendation { get; set; } = "NÖTR";

        [JsonPropertyName("confidence")]
        public double Confidence { get; set; }

        [JsonPropertyName("short_term_bias")]
        public string ShortTermBias { get; set; } = "YATAY";

        [JsonPropertyName("short_term_target")]
        public double? ShortTermTarget { get; set; }

        [JsonPropertyName("short_term_stop")]
        public double? ShortTermStop { get; set; }

        [JsonPropertyName("long_term_bias")]
        public string LongTermBias { get; set; } = "YATAY";

        [JsonPropertyName("long_term_target")]
        public double? LongTermTarget { get; set; }

        [JsonPropertyName("reasoning")]
        public string Reasoning { get; set; } = string.Empty;

        [JsonPropertyName("key_drivers")]
        public string KeyDrivers { get; set; } = "[]";

        [JsonPropertyName("risks")]
        public string Risks { get; set; } = "[]";

        [JsonPropertyName("watch_points")]
        public string WatchPoints { get; set; } = "[]";

        [JsonPropertyName("technical_score")]
        public double TechnicalScore { get; set; }

        [JsonPropertyName("news_score")]
        public double NewsScore { get; set; }

        [JsonPropertyName("macro_score")]
        public double MacroScore { get; set; }

        [JsonPropertyName("fundamental_score")]
        public double FundamentalScore { get; set; }

        [JsonPropertyName("analyzed_at")]
        public string AnalyzedAt { get; set; } = string.Empty;
    }
}
