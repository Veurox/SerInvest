using System.ComponentModel.DataAnnotations;

namespace MarketSentinel.Api.Models
{
    public class OracleAnalysis
    {
        [Key]
        public Guid Id { get; set; } = Guid.NewGuid();

        [Required]
        public string Symbol { get; set; } = string.Empty;

        public string AssetType { get; set; } = string.Empty;

        // Fiyat analiz anında
        public double? PriceAtAnalysis { get; set; }

        // Ana Tavsiye
        public string Recommendation { get; set; } = "NÖTR";  // GÜÇLÜ ALIM / ALIM / NÖTR / KAÇIN / GÜÇLÜ KAÇIN
        public double Confidence { get; set; }

        // Kısa Vade
        public string ShortTermBias { get; set; } = "YATAY";
        public double? ShortTermTarget { get; set; }
        public double? ShortTermStop { get; set; }

        // Uzun Vade
        public string LongTermBias { get; set; } = "YATAY";
        public double? LongTermTarget { get; set; }

        // Açıklama (Türkçe)
        public string Reasoning { get; set; } = string.Empty;

        // JSON string dizileri (["a","b","c"])
        public string KeyDrivers { get; set; } = "[]";
        public string Risks { get; set; } = "[]";
        public string WatchPoints { get; set; } = "[]";

        // Bileşen Skorları
        public double TechnicalScore { get; set; }
        public double NewsScore { get; set; }
        public double MacroScore { get; set; }
        public double FundamentalScore { get; set; }  // Faz 2: temel analiz skoru (0–1)

        public DateTime AnalyzedAt { get; set; } = DateTime.UtcNow;
    }
}
