using System.ComponentModel.DataAnnotations;

namespace MarketSentinel.Api.Models
{
    public class FundamentalData
    {
        [Key]
        public Guid Id { get; set; } = Guid.NewGuid();

        [Required]
        public string Symbol { get; set; } = string.Empty;

        public string AssetType { get; set; } = string.Empty;

        // Şirket Bilgisi
        public string CompanyName { get; set; } = string.Empty;
        public string Sector { get; set; } = string.Empty;

        // Değerleme Çarpanları
        public double? PeRatio { get; set; }       // F/K oranı
        public double? ForwardPe { get; set; }     // İleri F/K
        public double? PbRatio { get; set; }       // PD/DD oranı

        // Karlılık
        public double? Roe { get; set; }           // Özkaynak Karlılığı (0.15 = %15)
        public double? Eps { get; set; }           // Hisse Başına Kazanç
        public double? ForwardEps { get; set; }    // İleri HBK tahmini

        // FAVÖK / Operasyonel Karlılık (kritik BİST metriği)
        public double? Ebitda { get; set; }           // FAVÖK (TL)
        public double? EbitdaMargin { get; set; }     // FAVÖK Marjı (0.25 = %25)
        public double? NetDebtEbitda { get; set; }    // Net Borç / FAVÖK çarpanı
        public double? TcmbRatePct { get; set; }      // TCMB politika faizi (%)

        // Risk Göstergeleri
        public double? DebtToEquity { get; set; } // Borç/Özkaynak
        public double? Beta { get; set; }          // Piyasa betası

        // Büyüme
        public double? RevenueGrowth { get; set; }  // Gelir büyümesi YoY
        public double? EarningsGrowth { get; set; } // Kazanç büyümesi YoY

        // Temettü & Piyasa
        public double? DividendYield { get; set; }  // Temettü getirisi
        public double? MarketCap { get; set; }      // Piyasa değeri
        public double? Position52W { get; set; }    // 52 haftalık konum (0=dip, 1=tepe)

        // Bileşik Temel Skor (0–1)
        public double FundamentalScore { get; set; }

        // KAP Son Açıklama
        public string LastKapTitle { get; set; } = string.Empty;
        public string LastKapDate { get; set; } = string.Empty;

        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    }
}
