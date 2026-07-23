using MarketSentinel.Api.Data;
using MarketSentinel.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace MarketSentinel.Api.Controllers
{
    [ApiController]
    [Route("api/portfolio")]
    public class PortfolioController : ControllerBase
    {
        private readonly MarketDbContext _db;
        private readonly ILogger<PortfolioController> _logger;

        public PortfolioController(MarketDbContext db, ILogger<PortfolioController> logger)
        {
            _db = db;
            _logger = logger;
        }

        // ════════════════════════════════════════════════════════════════
        //  POZISYONLAR
        // ════════════════════════════════════════════════════════════════

        public class CreatePositionDto
        {
            public string Symbol { get; set; } = string.Empty;
            public decimal BuyPrice { get; set; }
            public decimal Quantity { get; set; }
            public DateTime BuyDate { get; set; }
            public decimal BuyCommission { get; set; } = 0;
            public string? Notes { get; set; }
        }

        public class ClosePositionDto
        {
            public decimal ClosePrice { get; set; }
            public DateTime CloseDate { get; set; }
            public decimal CloseCommission { get; set; } = 0;
            public string CloseReason { get; set; } = "MANUAL";
            // Kısmi satış için adet — null ise tüm pozisyon kapanır
            public decimal? Quantity { get; set; }
        }

        /// <summary>Açık pozisyonları + güncel K/Z bilgilerini döndürür.</summary>
        [HttpGet("positions")]
        public async Task<IActionResult> GetOpenPositions()
        {
            var positions = await _db.PortfolioPositions
                .Where(p => p.Status == "OPEN")
                .OrderByDescending(p => p.BuyDate)
                .ToListAsync();

            // Her sembol için son Oracle analizini ve son fiyatı çek
            var symbols = positions.Select(p => p.Symbol).Distinct().ToList();

            var latestOracleQ = _db.OracleAnalyses
                .Where(o => symbols.Contains(o.Symbol))
                .GroupBy(o => o.Symbol)
                .Select(g => g.OrderByDescending(x => x.AnalyzedAt).First());
            var latestOracle = await latestOracleQ.ToDictionaryAsync(o => o.Symbol);

            var latestPriceQ = _db.PriceData
                .Where(p => symbols.Contains(p.Symbol))
                .GroupBy(p => p.Symbol)
                .Select(g => g.OrderByDescending(x => x.RecordedAt).First());
            var latestPrice = await latestPriceQ.ToDictionaryAsync(p => p.Symbol);

            var enriched = positions.Select(p =>
            {
                latestOracle.TryGetValue(p.Symbol, out var oracle);
                latestPrice.TryGetValue(p.Symbol, out var price);

                var currentPrice = price?.Close ?? (double?)oracle?.PriceAtAnalysis ?? (double)p.BuyPrice;
                var costBasis = p.BuyPrice * p.Quantity + p.BuyCommission;
                var currentValue = (decimal)currentPrice * p.Quantity;
                var unrealizedPnl = currentValue - costBasis;
                var unrealizedPnlPct = costBasis > 0 ? (double)(unrealizedPnl / costBasis) : 0.0;
                var holdDays = (int)(DateTime.UtcNow - p.BuyDate).TotalDays;

                // Günlük değişim — PriceData'dan Open vs Close
                // yfinance her güncellemede o günün open/close'unu döner.
                // Veri ~15dk gecikmeli; market saatleri dışında dünün kapanışı sabit kalır.
                double? dailyChangePct = null;
                if (price != null && price.Open.HasValue && price.Open.Value > 0 && price.Close.HasValue)
                    dailyChangePct = (price.Close.Value - price.Open.Value) / price.Open.Value;

                var advice = ComputeAdvice(p, oracle, currentPrice);

                return new
                {
                    id              = p.Id,
                    symbol          = p.Symbol,
                    buyPrice        = p.BuyPrice,
                    quantity        = p.Quantity,
                    buyDate         = p.BuyDate,
                    buyCommission   = p.BuyCommission,
                    notes           = p.Notes,
                    currentPrice    = currentPrice,
                    dailyChangePct,                              // YENİ: günlük %
                    costBasis       = costBasis,
                    currentValue    = currentValue,
                    unrealizedPnl   = unrealizedPnl,
                    unrealizedPnlPct = unrealizedPnlPct,
                    holdDays        = holdDays,
                    // Oracle bilgileri
                    oracleRec       = oracle?.Recommendation,
                    oracleConf      = oracle?.Confidence,
                    targetPrice     = oracle?.ShortTermTarget,
                    stopPrice       = oracle?.ShortTermStop,
                    riskReward      = oracle?.RiskRewardRatio,
                    // AI tavsiye
                    advice          = advice.Action,
                    adviceReason    = advice.Reason,
                    adviceColor     = advice.Color,
                };
            }).ToList();

            return Ok(enriched);
        }

        /// <summary>Kapatılan pozisyonlar — geçmiş.</summary>
        [HttpGet("positions/closed")]
        public async Task<IActionResult> GetClosedPositions()
        {
            var positions = await _db.PortfolioPositions
                .Where(p => p.Status == "CLOSED")
                .OrderByDescending(p => p.CloseDate)
                .Take(200)
                .ToListAsync();

            return Ok(positions.Select(p => new
            {
                p.Id, p.Symbol,
                p.BuyPrice, p.Quantity, p.BuyDate, p.BuyCommission,
                p.ClosePrice, p.CloseDate, p.CloseCommission, p.CloseReason,
                p.RealizedPnl,
                holdDays = p.CloseDate.HasValue ? (int)(p.CloseDate.Value - p.BuyDate).TotalDays : 0,
                pnlPct = p.RealizedPnl.HasValue && p.BuyPrice > 0 && p.Quantity > 0
                    ? (double)(p.RealizedPnl.Value / (p.BuyPrice * p.Quantity))
                    : 0.0,
            }));
        }

        [HttpPost("positions")]
        public async Task<IActionResult> CreatePosition([FromBody] CreatePositionDto dto)
        {
            if (string.IsNullOrWhiteSpace(dto.Symbol) || dto.BuyPrice <= 0 || dto.Quantity <= 0)
                return BadRequest(new { error = "Sembol, fiyat ve adet zorunlu, sıfırdan büyük olmalı." });

            var pos = new PortfolioPosition
            {
                Symbol         = dto.Symbol.Trim().ToUpper(),
                BuyPrice       = dto.BuyPrice,
                Quantity       = dto.Quantity,
                BuyDate        = dto.BuyDate == default ? DateTime.UtcNow : dto.BuyDate,
                BuyCommission  = dto.BuyCommission,
                Notes          = dto.Notes,
                Status         = "OPEN",
            };
            _db.PortfolioPositions.Add(pos);
            await _db.SaveChangesAsync();
            return Ok(pos);
        }

        [HttpPut("positions/{id:guid}")]
        public async Task<IActionResult> UpdatePosition(Guid id, [FromBody] CreatePositionDto dto)
        {
            var pos = await _db.PortfolioPositions.FindAsync(id);
            if (pos == null) return NotFound();
            if (pos.Status == "CLOSED") return BadRequest(new { error = "Kapalı pozisyon düzenlenemez." });

            pos.BuyPrice      = dto.BuyPrice;
            pos.Quantity      = dto.Quantity;
            pos.BuyDate       = dto.BuyDate == default ? pos.BuyDate : dto.BuyDate;
            pos.BuyCommission = dto.BuyCommission;
            pos.Notes         = dto.Notes;
            pos.UpdatedAt     = DateTime.UtcNow;

            await _db.SaveChangesAsync();
            return Ok(pos);
        }

        [HttpDelete("positions/{id:guid}")]
        public async Task<IActionResult> DeletePosition(Guid id)
        {
            var pos = await _db.PortfolioPositions.FindAsync(id);
            if (pos == null) return NotFound();

            _db.PortfolioPositions.Remove(pos);
            await _db.SaveChangesAsync();
            return Ok(new { ok = true });
        }

        [HttpPost("positions/{id:guid}/close")]
        public async Task<IActionResult> ClosePosition(Guid id, [FromBody] ClosePositionDto dto)
        {
            var pos = await _db.PortfolioPositions.FindAsync(id);
            if (pos == null) return NotFound();
            if (pos.Status == "CLOSED") return BadRequest(new { error = "Pozisyon zaten kapalı." });

            // Kısmi satış: yeni adet < mevcut adet ise pozisyonu böl
            if (dto.Quantity.HasValue && dto.Quantity.Value < pos.Quantity)
            {
                var qtySold = dto.Quantity.Value;
                var ratio   = qtySold / pos.Quantity;

                // Mevcut pozisyonun bir kopyasını CLOSED olarak ekle (satılan kısım)
                var soldPos = new PortfolioPosition
                {
                    Symbol           = pos.Symbol,
                    BuyPrice         = pos.BuyPrice,
                    Quantity         = qtySold,
                    BuyDate          = pos.BuyDate,
                    BuyCommission    = pos.BuyCommission * ratio,
                    Status           = "CLOSED",
                    ClosePrice       = dto.ClosePrice,
                    CloseDate        = dto.CloseDate == default ? DateTime.UtcNow : dto.CloseDate,
                    CloseCommission  = dto.CloseCommission,
                    CloseReason      = dto.CloseReason,
                    Notes            = pos.Notes,
                };
                soldPos.RealizedPnl = (dto.ClosePrice - pos.BuyPrice) * qtySold
                                    - soldPos.BuyCommission - dto.CloseCommission;
                _db.PortfolioPositions.Add(soldPos);

                // Mevcut pozisyondan satılan kısmı düş
                pos.Quantity      -= qtySold;
                pos.BuyCommission *= (1 - ratio);
                pos.UpdatedAt      = DateTime.UtcNow;
            }
            else
            {
                pos.Status          = "CLOSED";
                pos.ClosePrice      = dto.ClosePrice;
                pos.CloseDate       = dto.CloseDate == default ? DateTime.UtcNow : dto.CloseDate;
                pos.CloseCommission = dto.CloseCommission;
                pos.CloseReason     = dto.CloseReason;
                pos.RealizedPnl     = (dto.ClosePrice - pos.BuyPrice) * pos.Quantity
                                    - pos.BuyCommission - dto.CloseCommission;
                pos.UpdatedAt       = DateTime.UtcNow;
            }

            await _db.SaveChangesAsync();
            return Ok(new { ok = true });
        }

        // ════════════════════════════════════════════════════════════════
        //  ÖZET (SUMMARY)
        // ════════════════════════════════════════════════════════════════

        [HttpGet("summary")]
        public async Task<IActionResult> GetSummary()
        {
            var openPositions = await _db.PortfolioPositions
                .Where(p => p.Status == "OPEN").ToListAsync();
            var closedPositions = await _db.PortfolioPositions
                .Where(p => p.Status == "CLOSED").ToListAsync();
            var dividends = await _db.Dividends.ToListAsync();

            // Her sembol için son fiyatı al
            var symbols = openPositions.Select(p => p.Symbol).Distinct().ToList();
            var latestPrice = await _db.PriceData
                .Where(p => symbols.Contains(p.Symbol))
                .GroupBy(p => p.Symbol)
                .Select(g => g.OrderByDescending(x => x.RecordedAt).First())
                .ToDictionaryAsync(p => p.Symbol);

            // Açık pozisyonların maliyeti ve güncel değeri
            decimal totalCost = 0, totalCurrent = 0;
            var perSymbol = new Dictionary<string, dynamic>();

            foreach (var p in openPositions)
            {
                var price = latestPrice.TryGetValue(p.Symbol, out var pd) ? (decimal)(pd.Close ?? (double)p.BuyPrice) : p.BuyPrice;
                var cost = p.BuyPrice * p.Quantity + p.BuyCommission;
                var curr = price * p.Quantity;
                totalCost += cost;
                totalCurrent += curr;

                if (!perSymbol.ContainsKey(p.Symbol))
                    perSymbol[p.Symbol] = new { totalCost = (decimal)0, totalCurrent = (decimal)0, totalQty = (decimal)0 };
                var prev = (dynamic)perSymbol[p.Symbol];
                perSymbol[p.Symbol] = new
                {
                    totalCost    = (decimal)prev.totalCost + cost,
                    totalCurrent = (decimal)prev.totalCurrent + curr,
                    totalQty     = (decimal)prev.totalQty + p.Quantity,
                };
            }

            var unrealizedPnl = totalCurrent - totalCost;
            var realizedPnl = closedPositions.Sum(p => p.RealizedPnl ?? 0);
            var totalDividends = dividends.Sum(d => d.TotalAmount);

            // En iyi / en kötü açık pozisyon
            var positionPnls = openPositions.Select(p =>
            {
                var price = latestPrice.TryGetValue(p.Symbol, out var pd) ? (decimal)(pd.Close ?? (double)p.BuyPrice) : p.BuyPrice;
                var cost = p.BuyPrice * p.Quantity + p.BuyCommission;
                var curr = price * p.Quantity;
                var pnlPct = cost > 0 ? (double)((curr - cost) / cost) : 0.0;
                return new { p.Symbol, pnl = curr - cost, pnlPct };
            }).ToList();

            var best  = positionPnls.OrderByDescending(x => x.pnlPct).FirstOrDefault();
            var worst = positionPnls.OrderBy(x => x.pnlPct).FirstOrDefault();

            // Dağılım (her sembolün toplam değeri / portföy değeri)
            var allocation = perSymbol
                .Select(kv => new {
                    symbol = kv.Key,
                    value = (decimal)((dynamic)kv.Value).totalCurrent,
                    weight = totalCurrent > 0 ? (double)(((decimal)((dynamic)kv.Value).totalCurrent) / totalCurrent) : 0,
                })
                .OrderByDescending(x => x.value)
                .ToList();

            // ── Sektör Dağılımı (FundamentalData'dan Sector ile gruplandır) ─
            var fundSymbols = perSymbol.Keys.ToList();
            var fundLatest = await _db.FundamentalData
                .Where(f => fundSymbols.Contains(f.Symbol))
                .GroupBy(f => f.Symbol)
                .Select(g => g.OrderByDescending(x => x.UpdatedAt).First())
                .ToDictionaryAsync(f => f.Symbol);

            var bySector = new Dictionary<string, decimal>();
            foreach (var kv in perSymbol)
            {
                var sym = kv.Key;
                var val = (decimal)((dynamic)kv.Value).totalCurrent;
                var sector = fundLatest.TryGetValue(sym, out var f) && !string.IsNullOrWhiteSpace(f.Sector)
                    ? f.Sector : "Diğer";
                bySector[sector] = (bySector.TryGetValue(sector, out var prev) ? prev : 0) + val;
            }
            var sectorAllocation = bySector
                .Select(kv => new {
                    sector = kv.Key,
                    value = kv.Value,
                    weight = totalCurrent > 0 ? (double)(kv.Value / totalCurrent) : 0,
                })
                .OrderByDescending(x => x.value)
                .ToList();

            // Risk uyarıları
            var warnings = new List<object>();
            foreach (var a in allocation)
            {
                if (a.weight > 0.25)
                    warnings.Add(new {
                        type = "CONCENTRATION", severity = "HIGH",
                        message = $"{a.symbol} portföyün %{a.weight*100:F0}'i — çeşitlendirme önerilir"
                    });
            }
            foreach (var p in positionPnls)
            {
                if (p.pnlPct < -0.20)
                    warnings.Add(new {
                        type = "DRAWDOWN", severity = "HIGH",
                        message = $"{p.Symbol} %{p.pnlPct*100:F1} zararda — stop-loss değerlendirin"
                    });
                else if (p.pnlPct > 0.30)
                    warnings.Add(new {
                        type = "PROFIT_TAKE", severity = "MEDIUM",
                        message = $"{p.Symbol} %{p.pnlPct*100:F0} karda — kısmi satış değerlendirin"
                    });
            }

            // ── Tüm Zamanlar K/Z (Audit 05/2026) ──────────────────────────
            // Net = Açık K/Z + Realize K/Z + Temettü
            // Bu rakam kullanıcının sistemden bugüne kadar ne kazandığı/kaybettiği
            var allTimePnl = unrealizedPnl + realizedPnl + totalDividends;
            // Yüzde için referans: tüm zamanlar yatırılan toplam maliyet
            // (açık pozisyonların maliyeti + kapatılan pozisyonların alış maliyeti)
            var historicalCostBasis = totalCost
                + closedPositions.Sum(p => p.BuyPrice * p.Quantity + p.BuyCommission);
            var allTimePnlPct = historicalCostBasis > 0
                ? (double)(allTimePnl / historicalCostBasis) : 0.0;

            return Ok(new
            {
                totalCost,
                totalCurrent,
                unrealizedPnl,
                unrealizedPnlPct = totalCost > 0 ? (double)(unrealizedPnl / totalCost) : 0.0,
                realizedPnl,
                totalDividends,
                allTimePnl,                           // YENİ: tüm zamanlar net K/Z (TL)
                allTimePnlPct,                        // YENİ: tüm zamanlar net K/Z (%)
                historicalCostBasis,                  // YENİ: hayatın tüm yatırımları
                openPositionCount = openPositions.Count,
                closedPositionCount = closedPositions.Count,
                bestPosition  = best,
                worstPosition = worst,
                allocation,
                sectorAllocation,        // YENİ — sektör bazlı dağılım
                warnings,
            });
        }

        // ════════════════════════════════════════════════════════════════
        //  TEMETTÜ
        // ════════════════════════════════════════════════════════════════

        public class DividendDto
        {
            public string Symbol { get; set; } = string.Empty;
            public DateTime PaymentDate { get; set; }
            public decimal AmountPerShare { get; set; }
            public decimal TotalAmount { get; set; }
            public string? Notes { get; set; }
        }

        [HttpGet("dividends")]
        public async Task<IActionResult> GetDividends()
        {
            return Ok(await _db.Dividends.OrderByDescending(d => d.PaymentDate).ToListAsync());
        }

        [HttpPost("dividends")]
        public async Task<IActionResult> AddDividend([FromBody] DividendDto dto)
        {
            var d = new Dividend
            {
                Symbol         = dto.Symbol.Trim().ToUpper(),
                PaymentDate    = dto.PaymentDate,
                AmountPerShare = dto.AmountPerShare,
                TotalAmount    = dto.TotalAmount,
                Notes          = dto.Notes,
            };
            _db.Dividends.Add(d);
            await _db.SaveChangesAsync();
            return Ok(d);
        }

        [HttpDelete("dividends/{id:guid}")]
        public async Task<IActionResult> DeleteDividend(Guid id)
        {
            var d = await _db.Dividends.FindAsync(id);
            if (d == null) return NotFound();
            _db.Dividends.Remove(d);
            await _db.SaveChangesAsync();
            return Ok(new { ok = true });
        }

        // ════════════════════════════════════════════════════════════════
        //  AI TAVSIYE MANTIĞI
        // ════════════════════════════════════════════════════════════════

        private record AdviceResult(string Action, string Reason, string Color);

        private static AdviceResult ComputeAdvice(
            PortfolioPosition pos, OracleAnalysis? oracle, double currentPrice)
        {
            if (oracle == null)
                return new("İZLE", "Henüz Oracle analizi yok — bekle", "#94a3b8");

            var pnlPct = pos.BuyPrice > 0 ? (double)((decimal)currentPrice - pos.BuyPrice) / (double)pos.BuyPrice : 0.0;
            var rec = oracle.Recommendation;

            // ─ Stop-loss / Take-profit override ─
            if (oracle.ShortTermStop.HasValue && currentPrice <= oracle.ShortTermStop.Value)
                return new("🚨 ACİL SAT", $"Stop-loss seviyesi kırıldı ({oracle.ShortTermStop:F2}) — pozisyondan çık", "#dc2626");

            if (oracle.ShortTermTarget.HasValue && currentPrice >= oracle.ShortTermTarget.Value)
                return new("💰 KAR AL", $"Take-profit seviyesi geldi ({oracle.ShortTermTarget:F2}) — kısmi/tam sat", "#22c55e");

            // ─ Model bazlı tavsiye ─
            if (rec == "GÜÇLÜ KAÇIN")
                return new("🔴 SAT", "Model çok olumsuz — pozisyondan çık", "#ef4444");

            if (rec == "KAÇIN")
            {
                if (pnlPct > 0.05)
                    return new("🟠 KISMİ SAT", $"Karda (%{pnlPct*100:F1}) — kâr realize et, model olumsuz", "#f97316");
                return new("🟡 İZLE", "Zararda — SL takip et, full çıkış erken olabilir", "#eab308");
            }

            if (rec == "GÜÇLÜ ALIM")
            {
                if (pnlPct < -0.03)
                    return new("🟢 EKLE", $"Maliyet ortala — model çok güçlü (zarar %{pnlPct*100:F1})", "#16a34a");
                if (pnlPct > 0.15)
                    return new("🟡 TUT/KISMİ SAT", $"Hedef yakın (%{pnlPct*100:F0} kar) — kısmi realize", "#eab308");
                return new("🟢 TUT", "Model güçlü — pozisyonu koru", "#22c55e");
            }

            if (rec == "ALIM")
                return new("🟢 TUT", $"Model olumlu — pozisyonu koru ({(pnlPct >= 0 ? "kar" : "zarar")} %{pnlPct*100:F1})", "#22c55e");

            // NÖTR
            if (pnlPct > 0.10)
                return new("🟡 TUT", "Karda, momentum yok ama yön belirsiz", "#eab308");
            if (pnlPct < -0.10)
                return new("🟠 İZLE", "Zararda + nötr sinyal — SL'i takip et", "#f97316");
            return new("🟡 TUT", "Net sinyal yok — izlemeye devam", "#94a3b8");
        }
    }
}
