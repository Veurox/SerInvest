using System.ComponentModel.DataAnnotations;

namespace MarketSentinel.Api.Models
{
    public class MarketSignal
    {
        [Key]
        public Guid Id { get; set; } = Guid.NewGuid();

        [Required]
        public string Entity { get; set; } = string.Empty;

        [Required]
        public string Source { get; set; } = string.Empty;

        public string AssetType { get; set; } = string.Empty;
        public string SentimentLabel { get; set; } = "NEUTRAL";
        public double SentimentScore { get; set; }
        public bool IsGeopolitical { get; set; }

        public string Headline { get; set; } = string.Empty;
        public string Summary { get; set; } = string.Empty;
        public string Url { get; set; } = string.Empty;

        // Hesaplanan sinyal (habere göre)
        public string Direction { get; set; } = string.Empty;
        public double SignalConfidenceScore { get; set; }

        // ── Faz 1 (ml v4): point-in-time haber deposu ────────────────────────
        // PublishedAt = event_ts (haber ne zaman yayınlandı)
        // CreatedAt   = ingest_ts (biz ne zaman öğrendik) — eğitim as-of join'leri
        // DAİMA CreatedAt üzerinden yapılır (lookahead sızıntısı önlemi).
        public DateTime? PublishedAt { get; set; }
        public string NewsGuid { get; set; } = string.Empty;   // dedupe anahtarı
        public double SentimentRaw { get; set; }               // ham model çıktısı (ağırlıksız)
        public double SourceWeight { get; set; } = 1.0;
        public string Lang { get; set; } = string.Empty;       // "tr" | "en"

        // ── Faz 3 (ml v4): olay tipolojisi + yenilik ─────────────────────────
        public string EventType { get; set; } = string.Empty;  // TEMETTU, KAR_ACIKLAMA, ... GENEL
        public double Novelty { get; set; } = 1.0;             // 1=yeni bilgi, ~0=tekrar

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }
}
