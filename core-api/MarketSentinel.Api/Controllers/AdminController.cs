using Microsoft.AspNetCore.Mvc;

namespace MarketSentinel.Api.Controllers
{
    /// <summary>
    /// Oracle admin HTTP sunucusuna (port 5001) transparent proxy.
    /// Frontend doğrudan oracle container'a bağlanamaz (iç ağ) —
    /// core-api aracı olarak yönlendirir.
    /// </summary>
    [ApiController]
    [Route("api/admin")]
    public class AdminController : ControllerBase
    {
        private readonly IHttpClientFactory _httpFactory;
        private readonly ILogger<AdminController> _logger;
        private readonly string _oracleAdminUrl;

        public AdminController(IHttpClientFactory httpFactory, ILogger<AdminController> logger, IConfiguration config)
        {
            _httpFactory    = httpFactory;
            _logger         = logger;
            _oracleAdminUrl = config["OracleAdminUrl"] ?? "http://ai-oracle-service:5001";
        }

        // ── GET /api/admin/oracle/status ──────────────────────────────────────
        [HttpGet("oracle/{**path}")]
        public async Task<IActionResult> ProxyGet(string path)
            => await Forward(HttpMethod.Get, path, null);

        // ── POST /api/admin/oracle/{action} ───────────────────────────────────
        [HttpPost("oracle/{**path}")]
        public async Task<IActionResult> ProxyPost(string path)
        {
            string? body = null;
            if (Request.ContentLength > 0)
                using (var sr = new StreamReader(Request.Body))
                    body = await sr.ReadToEndAsync();
            return await Forward(HttpMethod.Post, path, body);
        }

        // ── İç yardımcı ──────────────────────────────────────────────────────
        private async Task<IActionResult> Forward(HttpMethod method, string path, string? body)
        {
            try
            {
                var client  = _httpFactory.CreateClient("oracle-admin");
                var url     = $"{_oracleAdminUrl}/admin/{path}";
                var req     = new HttpRequestMessage(method, url);
                if (body != null)
                    req.Content = new StringContent(body, System.Text.Encoding.UTF8, "application/json");

                var res     = await client.SendAsync(req);
                var content = await res.Content.ReadAsStringAsync();

                return new ContentResult
                {
                    StatusCode  = (int)res.StatusCode,
                    Content     = content,
                    ContentType = "application/json",
                };
            }
            catch (HttpRequestException ex)
            {
                _logger.LogWarning("Oracle admin proxy hatası: {Msg}", ex.Message);
                return StatusCode(503, new { error = "Oracle admin sunucusuna ulaşılamadı", detail = ex.Message });
            }
        }
    }
}
