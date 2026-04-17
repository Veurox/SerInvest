using System.Text.Json.Serialization;

namespace MarketSentinel.Api.Contracts
{
    public class AnalyzedNewsMessage
    {
        [JsonPropertyName("source")]
        public string Source { get; set; } = string.Empty;

        [JsonPropertyName("timestamp")]
        public string Timestamp { get; set; } = string.Empty;

        [JsonPropertyName("entity")]
        public string Entity { get; set; } = string.Empty;

        [JsonPropertyName("asset_type")]
        public string AssetType { get; set; } = string.Empty;

        [JsonPropertyName("sentiment_score")]
        public double SentimentScore { get; set; }

        [JsonPropertyName("sentiment_label")]
        public string SentimentLabel { get; set; } = "NEUTRAL";

        [JsonPropertyName("is_geopolitical")]
        public bool IsGeopolitical { get; set; }

        [JsonPropertyName("summary")]
        public string Summary { get; set; } = string.Empty;

        [JsonPropertyName("headline")]
        public string Headline { get; set; } = string.Empty;

        [JsonPropertyName("url")]
        public string Url { get; set; } = string.Empty;
    }
}
