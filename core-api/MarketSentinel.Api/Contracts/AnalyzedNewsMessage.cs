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

        // ── Faz 1 (ml v4): point-in-time haber deposu alanları ──────────────
        // Eski analyst-engine sürümleri bu alanları göndermez — default'lar güvenli.

        [JsonPropertyName("guid")]
        public string Guid { get; set; } = string.Empty;

        /// <summary>Haberin GERÇEK yayın zamanı (event_ts, ISO 8601 UTC).
        /// "timestamp" alanı analiz zamanıdır (ingest_ts) — karıştırma.</summary>
        [JsonPropertyName("published_at")]
        public string PublishedAt { get; set; } = string.Empty;

        [JsonPropertyName("sentiment_raw")]
        public double SentimentRaw { get; set; }

        [JsonPropertyName("source_weight")]
        public double SourceWeight { get; set; } = 1.0;

        [JsonPropertyName("lang")]
        public string Lang { get; set; } = string.Empty;

        // ── Faz 3 (ml v4): olay tipolojisi + yenilik skoru ───────────────────
        /// <summary>Yapılandırılmış olay tipi (TEMETTU, KAR_ACIKLAMA, ...) — GENEL = sınıflandırılamadı.</summary>
        [JsonPropertyName("event_type")]
        public string EventType { get; set; } = string.Empty;

        /// <summary>Yenilik skoru [0,1]: 1 = tamamen yeni bilgi, ~0 = son 72 saatin tekrarı.</summary>
        [JsonPropertyName("novelty")]
        public double Novelty { get; set; } = 1.0;
    }
}
