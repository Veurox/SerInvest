using System.Text.Json.Serialization;

namespace MarketSentinel.Api.Contracts
{
    public class FundamentalDataMessage
    {
        [JsonPropertyName("symbol")]
        public string Symbol { get; set; } = string.Empty;

        [JsonPropertyName("asset_type")]
        public string AssetType { get; set; } = string.Empty;

        [JsonPropertyName("company_name")]
        public string CompanyName { get; set; } = string.Empty;

        [JsonPropertyName("sector")]
        public string Sector { get; set; } = string.Empty;

        [JsonPropertyName("pe_ratio")]
        public double? PeRatio { get; set; }

        [JsonPropertyName("forward_pe")]
        public double? ForwardPe { get; set; }

        [JsonPropertyName("pb_ratio")]
        public double? PbRatio { get; set; }

        [JsonPropertyName("roe")]
        public double? Roe { get; set; }

        [JsonPropertyName("eps")]
        public double? Eps { get; set; }

        [JsonPropertyName("forward_eps")]
        public double? ForwardEps { get; set; }

        // FAVÖK / Operasyonel Karlılık
        [JsonPropertyName("ebitda")]
        public double? Ebitda { get; set; }

        [JsonPropertyName("ebitda_margin")]
        public double? EbitdaMargin { get; set; }

        [JsonPropertyName("net_debt_ebitda")]
        public double? NetDebtEbitda { get; set; }

        [JsonPropertyName("tcmb_rate_pct")]
        public double? TcmbRatePct { get; set; }

        [JsonPropertyName("debt_to_equity")]
        public double? DebtToEquity { get; set; }

        [JsonPropertyName("beta")]
        public double? Beta { get; set; }

        [JsonPropertyName("revenue_growth")]
        public double? RevenueGrowth { get; set; }

        [JsonPropertyName("earnings_growth")]
        public double? EarningsGrowth { get; set; }

        [JsonPropertyName("dividend_yield")]
        public double? DividendYield { get; set; }

        [JsonPropertyName("market_cap")]
        public double? MarketCap { get; set; }

        [JsonPropertyName("position_52w")]
        public double? Position52W { get; set; }

        [JsonPropertyName("fundamental_score")]
        public double FundamentalScore { get; set; }

        [JsonPropertyName("last_kap_title")]
        public string LastKapTitle { get; set; } = string.Empty;

        [JsonPropertyName("last_kap_date")]
        public string LastKapDate { get; set; } = string.Empty;

        [JsonPropertyName("updated_at")]
        public string UpdatedAt { get; set; } = string.Empty;
    }
}
