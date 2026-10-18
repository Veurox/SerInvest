using Microsoft.EntityFrameworkCore;

namespace MarketSentinel.Api.Data
{
    /// <summary>
    /// PriceData saklama kuralı (18.10.2026).
    ///
    /// NEDEN: market-data servisi ~7 dakikada bir 96 varlığın fiyatını yazıyor
    /// ve hiçbir şey silinmiyordu — 302.181 satır, 103 MB; yılda ~1 milyon satır.
    ///
    /// KURAL: son 30 gün OLDUĞU GİBİ kalır. Daha eskisi için her sembolün her
    /// günden yalnız SON kaydı (günün kapanışı) tutulur.
    ///
    /// NEDEN 30 GÜN: tablonun ayrıntılı okunduğu en uzun yer /history
    /// (varsayılan 30 gün). Günlük okuyan /price-history (≤90 gün) ve son
    /// fiyatı okuyan uç noktalar bu kuraldan etkilenmez: her günün son satırı
    /// korunuyor.
    ///
    /// Açılıştan 2 dk sonra, sonra günde bir koşar; hata servisi durdurmaz.
    /// </summary>
    public sealed class PriceDataRetentionService : BackgroundService
    {
        private const int DetayliGun = 30;
        private readonly IServiceScopeFactory _scopes;
        private readonly ILogger<PriceDataRetentionService> _log;

        public PriceDataRetentionService(IServiceScopeFactory scopes,
                                         ILogger<PriceDataRetentionService> log)
        {
            _scopes = scopes;
            _log = log;
        }

        protected override async Task ExecuteAsync(CancellationToken stop)
        {
            try { await Task.Delay(TimeSpan.FromMinutes(2), stop); }
            catch (TaskCanceledException) { return; }

            while (!stop.IsCancellationRequested)
            {
                try
                {
                    using var scope = _scopes.CreateScope();
                    var db = scope.ServiceProvider.GetRequiredService<MarketDbContext>();
                    db.Database.SetCommandTimeout(TimeSpan.FromMinutes(5));

                    var silinen = await db.Database.ExecuteSqlRawAsync($@"
                        DELETE FROM ""PriceData"" p
                        USING (
                            SELECT ""Id"",
                                   ROW_NUMBER() OVER (
                                       PARTITION BY ""Symbol"", date_trunc('day', ""RecordedAt"")
                                       ORDER BY ""RecordedAt"" DESC) AS sira
                            FROM ""PriceData""
                            WHERE ""RecordedAt"" < now() - interval '{DetayliGun} days'
                        ) eski
                        WHERE p.""Id"" = eski.""Id"" AND eski.sira > 1;", stop);

                    if (silinen > 0)
                    {
                        // Boşalan yer yeniden kullanılsın, planlayıcı güncel istatistik görsün.
                        await db.Database.ExecuteSqlRawAsync(@"VACUUM (ANALYZE) ""PriceData"";", stop);
                    }
                    _log.LogInformation("PriceData saklama: {Silinen} gün içi satır özetlendi", silinen);
                }
                catch (OperationCanceledException) { return; }
                catch (Exception ex)
                {
                    _log.LogWarning(ex, "PriceData saklama başarısız — yarın yeniden denenecek");
                }

                try { await Task.Delay(TimeSpan.FromHours(24), stop); }
                catch (TaskCanceledException) { return; }
            }
        }
    }
}
