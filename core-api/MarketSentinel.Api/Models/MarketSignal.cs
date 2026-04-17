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

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }
}
