using Microsoft.AspNetCore.Mvc;

namespace MarketSentinel.Api.Controllers
{
    /// <summary>
    /// TEFAS fon verisi — tefas-service'e ince proxy.
    ///
    /// NEDEN PROXY, NEDEN DB DEĞİL (11.09.2026 kararı, docs/PLAN_TEFAS.md §3):
    /// fon verisi günde tek satır; mevcut PriceData tablosu OHLCV için
    /// biçimlenmiş ve fonda High/Low/hacim YOK. Fonu oraya koymak o alanları
    /// sıfırla doldurmayı gerektirirdi — tam da yasakladığımız şey. Ayrıca
    /// tefas-service'in deposu EKLEMELİ ve noktasal-zamanlı; bir EF tablosu
    /// upsert'e davet eder ve "o gün ne biliyorduk" cevabını sessizce siler.
    /// Grafik verisi zaten aynı desenle (core-api → market-data HTTP) akıyor.
    ///
    /// Burada iş mantığı YOK: hesap tefas-service'te, tek doğru yer orası.
    /// </summary>
    [ApiController]
    [Route("api/fon")]
    public class TefasController : ControllerBase
    {
        private readonly IHttpClientFactory _httpFactory;
        private readonly ILogger<TefasController> _logger;

        public TefasController(IHttpClientFactory httpFactory, ILogger<TefasController> logger)
        {
            _httpFactory = httpFactory;
            _logger = logger;
        }

        /// <summary>Servisin durumu: depo özeti, son çekim, geriye dönük doldurma ilerlemesi.</summary>
        [HttpGet("durum")]
        public Task<IActionResult> Durum() => Ilet("/durum");

        /// <summary>İzlenen kategoriler ve her birindeki fon sayısı.</summary>
        [HttpGet("kategoriler")]
        public Task<IActionResult> Kategoriler() => Ilet("/kategoriler");

        /// <summary>
        /// Bir günün fon listesi. gun verilmezse depodaki en son gün.
        /// asOf verilirse noktasal-zamanlı okuma: o ana kadar öğrendiklerimiz.
        /// </summary>
        [HttpGet("liste")]
        public Task<IActionResult> Liste([FromQuery] string? gun,
                                         [FromQuery] string? kategori,
                                         [FromQuery] string? asOf)
        {
            var q = Sorgu(("gun", gun), ("kategori", kategori), ("as_of", asOf));
            return Ilet($"/fonlar{q}");
        }

        /// <summary>Tek fonun seri geçmişi (grafik ve getiri hesapları için).</summary>
        [HttpGet("seri/{kod}")]
        public Task<IActionResult> Seri(string kod,
                                        [FromQuery] int gun = 400,
                                        [FromQuery] string? asOf = null)
        {
            var q = Sorgu(("gun", gun.ToString()), ("as_of", asOf));
            return Ilet($"/fon/{Uri.EscapeDataString(kod)}{q}");
        }

        // ── yardımcılar ──────────────────────────────────────────────────────

        private static string Sorgu(params (string ad, string? deger)[] parcalar)
        {
            var dolu = parcalar
                .Where(p => !string.IsNullOrWhiteSpace(p.deger))
                .Select(p => $"{p.ad}={Uri.EscapeDataString(p.deger!)}")
                .ToArray();
            return dolu.Length == 0 ? "" : "?" + string.Join("&", dolu);
        }

        private async Task<IActionResult> Ilet(string yol)
        {
            var http = _httpFactory.CreateClient("tefas");
            try
            {
                var resp = await http.GetAsync(yol);
                var body = await resp.Content.ReadAsStringAsync();
                return new ContentResult
                {
                    Content = body,
                    ContentType = "application/json",
                    StatusCode = (int)resp.StatusCode
                };
            }
            catch (Exception ex)
            {
                // Sessizce boş liste dönmüyoruz: "veri yok" ile "servis kapalı"
                // farkı arayüzde görünmeli, yoksa bozukluk fark edilmez.
                _logger.LogWarning("TEFAS proxy hatası {Yol}: {Msg}", yol, ex.Message);
                return StatusCode(502, new { error = "tefas servisine ulaşılamadı", detail = ex.Message });
            }
        }
    }
}
