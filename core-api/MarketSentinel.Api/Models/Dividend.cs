using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace MarketSentinel.Api.Models
{
    /// <summary>
    /// Manuel girilen temettü ödemeleri.
    /// Toplam tutar pozisyon K/Z'sine eklenir.
    /// </summary>
    public class Dividend
    {
        [Key]
        public Guid Id { get; set; } = Guid.NewGuid();

        [Required]
        public string Symbol { get; set; } = string.Empty;

        public DateTime PaymentDate { get; set; }

        [Column(TypeName = "numeric(18,4)")]
        public decimal AmountPerShare { get; set; }

        [Column(TypeName = "numeric(18,4)")]
        public decimal TotalAmount { get; set; }     // = AmountPerShare * sahip olunan adet

        public string? Notes { get; set; }

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }
}
