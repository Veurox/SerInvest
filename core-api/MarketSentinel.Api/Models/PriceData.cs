using System.ComponentModel.DataAnnotations;

namespace MarketSentinel.Api.Models
{
    public class PriceData
    {
        [Key]
        public Guid Id { get; set; } = Guid.NewGuid();

        [Required]
        public string Symbol { get; set; } = string.Empty;

        [Required]
        public string AssetType { get; set; } = string.Empty;

        // OHLCV
        public double? Close { get; set; }
        public double? Open { get; set; }
        public double? High { get; set; }
        public double? Low { get; set; }
        public double? Volume { get; set; }

        // Teknik İndikatörler
        public double? Rsi { get; set; }
        public double? MacdLine { get; set; }
        public double? MacdSignal { get; set; }
        public double? MacdHistogram { get; set; }
        public double? BbUpper { get; set; }
        public double? BbMiddle { get; set; }
        public double? BbLower { get; set; }
        public double? Ema9 { get; set; }
        public double? Ema20 { get; set; }
        public double? Ema50 { get; set; }
        public double? Ema200 { get; set; }

        // Sinyal
        public string Signal { get; set; } = "NEUTRAL";
        public double SignalStrength { get; set; }

        public DateTime RecordedAt { get; set; } = DateTime.UtcNow;
    }
}
