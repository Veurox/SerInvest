namespace MarketSentinel.Api.Contracts
{
    public class OracleStatusMessage
    {
        public string Level { get; set; } = string.Empty;
        public string Message { get; set; } = string.Empty;
        public string Timestamp { get; set; } = string.Empty;
        public double Accuracy { get; set; }
    }
}
