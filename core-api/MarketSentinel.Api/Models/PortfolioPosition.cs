using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace MarketSentinel.Api.Models
{
    /// <summary>
    /// Kullanıcının portföyünde tuttuğu/tutuğu pozisyon.
    /// Aynı sembol için birden fazla pozisyon olabilir (çoklu alım).
    /// Summary endpoint'i bunları "ortalama maliyet" ile birleştirir.
    /// </summary>
    public class PortfolioPosition
    {
        [Key]
        public Guid Id { get; set; } = Guid.NewGuid();

        [Required]
        public string Symbol { get; set; } = string.Empty;

        // ── Alım bilgileri ──────────────────────────────────────────────
        [Column(TypeName = "numeric(18,4)")]
        public decimal BuyPrice { get; set; }

        [Column(TypeName = "numeric(18,4)")]
        public decimal Quantity { get; set; }     // Lot sayısı (kesirli olabilir)

        public DateTime BuyDate { get; set; }

        [Column(TypeName = "numeric(18,4)")]
        public decimal BuyCommission { get; set; }   // İşlem ücreti TL

        // ── Pozisyon durumu ─────────────────────────────────────────────
        public string Status { get; set; } = "OPEN";   // OPEN | CLOSED

        // ── Kapatma bilgileri (Status=CLOSED ise) ───────────────────────
        [Column(TypeName = "numeric(18,4)")]
        public decimal? ClosePrice { get; set; }

        public DateTime? CloseDate { get; set; }

        [Column(TypeName = "numeric(18,4)")]
        public decimal? CloseCommission { get; set; }

        public string? CloseReason { get; set; }   // MANUAL | STOP_LOSS | TAKE_PROFIT | RECOMMENDATION

        // ── Hesaplanan / Cache ──────────────────────────────────────────
        // Realize edilmiş K/Z (CLOSED olunca doldurulur)
        [Column(TypeName = "numeric(18,4)")]
        public decimal? RealizedPnl { get; set; }

        public string? Notes { get; set; }

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    }
}
