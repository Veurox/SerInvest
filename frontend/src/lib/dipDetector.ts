// =============================================================================
// SerInvest — Dip Fırsat Dedektörü (kural-tabanlı, ML değil)
// Bir borsa uzmanının "düşen hisse ne zaman alınır?" mantığını 5 kapıya döker.
// Her kapının eşikleri profesyonel teknik analiz pratiğine göre kalibre edildi.
//
// Veri: /api/market/{symbol}/chart?tf=1Y  → ~250 günlük OHLCV bar.
// Snapshot: PriceData (latest) → ema20/50/200, bbLower, close (trend & destek).
// =============================================================================
import type { PriceData } from './types'

export interface ChartPoint { t: number; o: number | null; h: number | null; l: number | null; c: number | null; v: number | null }

export interface GateResult { id: number; name: string; pass: boolean; detail: string }

export interface DipScore {
  score: number              // 0–5 (kaç kapı geçti)
  gates: GateResult[]
  entry: number              // mevcut fiyat (giriş referansı)
  stop: number               // önerilen stop (desteğin altı)
  target: number             // 2R hedef
  rr: number                 // risk:ödül
  support: number            // tetiklenen destek seviyesi
  pullbackPct: number        // 20-gün tepesinden geri çekilme %
  label: string
}

// ── Wilder RSI serisi ────────────────────────────────────────────────────────
function rsiSeries(closes: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null)
  if (closes.length < period + 1) return out
  let gain = 0, loss = 0
  for (let i = 1; i <= period; i++) {
    const ch = closes[i] - closes[i - 1]
    if (ch >= 0) gain += ch; else loss -= ch
  }
  let avgG = gain / period, avgL = loss / period
  out[period] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL)
  for (let i = period + 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1]
    const g = ch > 0 ? ch : 0, l = ch < 0 ? -ch : 0
    avgG = (avgG * (period - 1) + g) / period
    avgL = (avgL * (period - 1) + l) / period
    out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL)
  }
  return out
}

// ── Swing dip indeksleri (±k bar içinde yerel minimum) ───────────────────────
function swingLowIdx(lows: number[], k = 3): number[] {
  const idx: number[] = []
  for (let i = k; i < lows.length - k; i++) {
    let isMin = true
    for (let j = i - k; j <= i + k; j++) {
      if (j !== i && lows[j] < lows[i]) { isMin = false; break }
    }
    if (isMin) idx.push(i)
  }
  return idx
}

const mean = (a: number[]) => a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0

/**
 * 5 kapılı dip fırsat skoru hesaplar. Geçmiş yoksa/yetersizse null döner.
 */
export function scoreDip(points: ChartPoint[], snap: PriceData): DipScore | null {
  // Temiz OHLCV serileri
  const pts = points.filter(p => p.c != null && p.o != null && p.h != null && p.l != null)
  if (pts.length < 60) return null
  const closes = pts.map(p => p.c!) , highs = pts.map(p => p.h!), lows = pts.map(p => p.l!)
  const opens  = pts.map(p => p.o!), vols  = pts.map(p => p.v ?? 0)
  const n = closes.length, last = n - 1

  const entry  = snap.close ?? closes[last]
  const ema50 = snap.ema50, ema200 = snap.ema200
  const bbLow  = snap.bbLower
  if (ema200 == null || ema50 == null) return null

  const rsi = rsiSeries(closes)
  const swings = swingLowIdx(lows, 3)

  // candle yardımcıları (i. bar)
  const body  = (i: number) => Math.abs(closes[i] - opens[i])
  const range = (i: number) => Math.max(1e-9, highs[i] - lows[i])
  const lowerWick = (i: number) => Math.min(opens[i], closes[i]) - lows[i]
  const upperWick = (i: number) => highs[i] - Math.max(opens[i], closes[i])

  // 20-gün tepesi → pullback derinliği
  const recentHigh = Math.max(...highs.slice(-20))
  const pullbackPct = recentHigh > 0 ? (recentHigh - entry) / recentHigh : 0

  const gates: GateResult[] = []

  // ── KAPI 1 · Trend yukarı mı? ──────────────────────────────────────────────
  // Uzman kuralı: dip yalnızca ana yükseliş trendinde alınır. Fiyat EMA200
  // üstünde VE EMA50 > EMA200 (orta vade de yukarı hizalı).
  const g1 = entry > ema200 && ema50 > ema200
  gates.push({ id: 1, name: 'Trend yukarı', pass: g1,
    detail: g1 ? 'Fiyat EMA200 üstü, EMA50>EMA200' : 'Trend aşağı — düşen bıçak riski' })

  // ── KAPI 2 · Gerçek desteğe geldi mi? ──────────────────────────────────────
  // %3 bandında EMA50/EMA200, alt Bollinger'a değme, ya da son 120 barın
  // bir swing dibine %2.5 yakınlık. Tetikleyen seviye stop için saklanır.
  let support = 0; let g2 = false; let g2detail = 'Desteğe uzak'
  const near = (lvl: number | null, tol: number) => lvl != null && lvl > 0 && Math.abs(entry - lvl) / lvl <= tol
  if (near(ema50, 0.03))  { g2 = true; support = ema50!;  g2detail = 'EMA50 desteğinde' }
  else if (near(ema200, 0.03)) { g2 = true; support = ema200!; g2detail = 'EMA200 desteğinde' }
  else if (bbLow != null && entry <= bbLow * 1.015) { g2 = true; support = bbLow; g2detail = 'Alt Bollinger bandında' }
  else {
    // en yakın alttaki swing dibi
    const below = swings.map(i => lows[i]).filter(l => l <= entry).sort((a, b) => b - a)
    if (below.length && (entry - below[0]) / below[0] <= 0.025) { g2 = true; support = below[0]; g2detail = 'Önceki dip desteğinde' }
  }
  gates.push({ id: 2, name: 'Destekte', pass: g2, detail: g2detail })

  // ── KAPI 3 · Boğa uyumsuzluğu (divergence) ─────────────────────────────────
  // Son 40 barda son iki swing dibi: fiyat daha düşük dip yaparken RSI daha
  // yüksek dip → satış baskısı tükeniyor. Alternatif: derin aşırı satım (RSI<25)
  // ve RSI yukarı dönmüş.
  let g3 = false; let g3detail = 'Uyumsuzluk yok'
  const recentSwings = swings.filter(i => i >= n - 40)
  if (recentSwings.length >= 2) {
    const L2 = recentSwings[recentSwings.length - 1]
    const L1 = recentSwings[recentSwings.length - 2]
    const r1 = rsi[L1], r2 = rsi[L2]
    if (r1 != null && r2 != null && lows[L2] < lows[L1] && r2 > r1 + 2 && r2 < 45) {
      g3 = true; g3detail = `Boğa uyumsuzluğu (RSI ${r1.toFixed(0)}→${r2.toFixed(0)})`
    }
  }
  if (!g3) {
    const last5 = rsi.slice(-5).filter((v): v is number => v != null)
    if (last5.length >= 2 && Math.min(...last5) < 25 && rsi[last]! > rsi[last - 1]! + 1) {
      g3 = true; g3detail = `Aşırı satımdan dönüş (RSI ${rsi[last]!.toFixed(0)})`
    }
  }
  gates.push({ id: 3, name: 'Uyumsuzluk', pass: g3, detail: g3detail })

  // ── KAPI 4 · Hacim doruğu / kapitülasyon ───────────────────────────────────
  // Son 6 barda: hacim 20-bar ortalamasının ≥1.8 katı VE uzun alt fitil
  // (satıcılar fiyatı aşağı itti, alıcılar geri aldı). Alıcı emilimi sinyali.
  let g4 = false; let g4detail = 'Kapitülasyon yok'
  for (let i = Math.max(20, n - 6); i < n; i++) {
    const avgV = mean(vols.slice(i - 20, i))
    if (avgV <= 0) continue
    const volSpike = vols[i] >= 1.8 * avgV
    const longLowerWick = lowerWick(i) >= body(i) && lowerWick(i) >= 0.4 * range(i)
    const closedUpperHalf = (closes[i] - lows[i]) / range(i) >= 0.5
    if (volSpike && (longLowerWick || closedUpperHalf)) {
      g4 = true; g4detail = `Hacim doruğu ×${(vols[i] / avgV).toFixed(1)} + alt fitil`; break
    }
  }
  gates.push({ id: 4, name: 'Hacim doruğu', pass: g4, detail: g4detail })

  // ── KAPI 5 · Dönüş mumu + onay ─────────────────────────────────────────────
  // Son 2 barda hammer / yutan boğa, ya da önceki tepeyi kapanışla aşma.
  let g5 = false; let g5detail = 'Dönüş onayı yok'
  const isHammer = (i: number) =>
    body(i) <= 0.35 * range(i) && lowerWick(i) >= 2 * body(i) && upperWick(i) <= 0.25 * range(i)
  const isEngulf = (i: number) =>
    i > 0 && closes[i] > opens[i] && closes[i - 1] < opens[i - 1] &&
    closes[i] >= opens[i - 1] && opens[i] <= closes[i - 1]
  for (let i = last; i >= last - 1 && i > 0; i--) {
    if (isHammer(i))      { g5 = true; g5detail = 'Çekiç (hammer) mumu'; break }
    if (isEngulf(i))      { g5 = true; g5detail = 'Yutan boğa mumu'; break }
    if (closes[i] > highs[i - 1]) { g5 = true; g5detail = 'Önceki tepeyi kapanışla aştı'; break }
  }
  gates.push({ id: 5, name: 'Dönüş mumu', pass: g5, detail: g5detail })

  // ── Skor + stop/hedef ──────────────────────────────────────────────────────
  const score = gates.filter(g => g.pass).length

  // Stop: tetiklenen destek ile son 10 barın dibinin altı (%1 tampon)
  const swingLow10 = Math.min(...lows.slice(-10))
  const stopBase = support > 0 ? Math.min(support, swingLow10) : swingLow10
  let stop = stopBase * 0.99
  let risk = entry - stop
  if (risk <= 0) { stop = entry * 0.95; risk = entry - stop }   // güvenli fallback
  const target = entry + 2 * risk
  const rr = 2.0

  const label = score >= 5 ? 'Güçlü dip kurulumu'
    : score === 4 ? 'İyi fırsat'
    : score === 3 ? 'İzle (zayıf)'
    : 'Yetersiz'

  return { score, gates, entry, stop, target, rr, support: stopBase, pullbackPct, label }
}

/**
 * Ucuz ön-filtre (snapshot'tan): yalnızca yükseliş trendinde VE düşüşte olan
 * BIST hisseleri taranır. Geçenler için 1Y grafik çekilip tam skor hesaplanır.
 */
export function isDipCandidate(a: PriceData): boolean {
  if (a.assetType !== 'BIST') return false
  if (a.close == null || a.ema200 == null || a.ema50 == null) return false
  const trendUp = a.close > a.ema200 && a.ema50 > a.ema200
  if (!trendUp) return false
  // Düşüşte mi? EMA20 altında ya da RSI<48 ya da gün içi negatif
  const dipping = (a.ema20 != null && a.close < a.ema20)
    || (a.rsi != null && a.rsi < 48)
    || (a.open != null && a.close < a.open)
  return dipping
}
