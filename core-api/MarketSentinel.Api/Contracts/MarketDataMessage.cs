using System.Text.Json.Serialization;

namespace MarketSentinel.Api.Contracts
{
    public class MarketDataMessage
    {
        [JsonPropertyName("symbol")]
        public string Symbol { get; set; } = string.Empty;

        [JsonPropertyName("asset_type")]
        public string AssetType { get; set; } = string.Empty;

        [JsonPropertyName("timestamp")]
        public string Timestamp { get; set; } = string.Empty;

        [JsonPropertyName("close")]
        public double? Close { get; set; }

        [JsonPropertyName("open")]
        public double? Open { get; set; }

        [JsonPropertyName("high")]
        public double? High { get; set; }

        [JsonPropertyName("low")]
        public double? Low { get; set; }

        [JsonPropertyName("volume")]
        public double? Volume { get; set; }

        [JsonPropertyName("rsi")]
        public double? Rsi { get; set; }

        [JsonPropertyName("macd_line")]
        public double? MacdLine { get; set; }

        [JsonPropertyName("macd_signal")]
        public double? MacdSignal { get; set; }

        [JsonPropertyName("macd_histogram")]
        public double? MacdHistogram { get; set; }

        [JsonPropertyName("bb_upper")]
        public double? BbUpper { get; set; }

        [JsonPropertyName("bb_middle")]
        public double? BbMiddle { get; set; }

        [JsonPropertyName("bb_lower")]
        public double? BbLower { get; set; }

        [JsonPropertyName("ema9")]
        public double? Ema9 { get; set; }

        [JsonPropertyName("ema20")]
        public double? Ema20 { get; set; }

        [JsonPropertyName("ema50")]
        public double? Ema50 { get; set; }

        [JsonPropertyName("ema200")]
        public double? Ema200 { get; set; }

        [JsonPropertyName("signal")]
        public string Signal { get; set; } = "NEUTRAL";

        [JsonPropertyName("signal_strength")]
        public double SignalStrength { get; set; }
    }
}
