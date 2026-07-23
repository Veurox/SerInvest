// =============================================================================
// SerInvest — Teknik Özet (Investing.com tarzı AL/NÖTR/SAT gauge)
// Mevcut PriceData göstergelerinden (RSI, MACD, EMA, BB) sinyal üretir.
// =============================================================================
import type { PriceData } from '../../lib/types'

interface Signal { label: string; verdict: 'AL' | 'NÖTR' | 'SAT' }

function computeSignals(a: PriceData): Signal[] {
  const signals: Signal[] = []
  const { close: c, open: o, rsi, macdHistogram, bbUpper, bbLower, bbMiddle,
          ema9, ema20, ema50, ema200 } = a

  // RSI
  if (rsi != null) {
    signals.push({ label: 'RSI(14)', verdict: rsi < 35 ? 'AL' : rsi > 65 ? 'SAT' : 'NÖTR' })
  }
  // MACD histogram
  if (macdHistogram != null) {
    signals.push({ label: 'MACD', verdict: macdHistogram > 0.002 ? 'AL' : macdHistogram < -0.002 ? 'SAT' : 'NÖTR' })
  }
  // BB konumu
  if (bbUpper != null && bbLower != null && bbMiddle != null && c != null) {
    const bbRange = bbUpper - bbLower
    if (bbRange > 0) {
      const pos = (c - bbLower) / bbRange
      signals.push({ label: 'Bollinger', verdict: pos < 0.2 ? 'AL' : pos > 0.8 ? 'SAT' : 'NÖTR' })
    }
  }
  // Fiyat vs EMA9
  if (ema9 != null && c != null) {
    signals.push({ label: 'EMA 9', verdict: c > ema9 ? 'AL' : c < ema9 ? 'SAT' : 'NÖTR' })
  }
  // Fiyat vs EMA20
  if (ema20 != null && c != null) {
    signals.push({ label: 'EMA 20', verdict: c > ema20 ? 'AL' : c < ema20 ? 'SAT' : 'NÖTR' })
  }
  // Fiyat vs EMA50
  if (ema50 != null && c != null) {
    signals.push({ label: 'EMA 50', verdict: c > ema50 ? 'AL' : c < ema50 ? 'SAT' : 'NÖTR' })
  }
  // Fiyat vs EMA200
  if (ema200 != null && c != null) {
    signals.push({ label: 'EMA 200', verdict: c > ema200 ? 'AL' : c < ema200 ? 'SAT' : 'NÖTR' })
  }
  // EMA20/EMA50 kesişim
  if (ema20 != null && ema50 != null) {
    signals.push({ label: 'EMA 20/50', verdict: ema20 > ema50 ? 'AL' : ema20 < ema50 ? 'SAT' : 'NÖTR' })
  }
  // Günlük değişim yönü
  if (c != null && o != null) {
    const chg = (c - o) / o
    signals.push({ label: 'Gün Yönü', verdict: chg > 0.003 ? 'AL' : chg < -0.003 ? 'SAT' : 'NÖTR' })
  }

  return signals
}

function verdictLabel(buy: number, sell: number, total: number): { text: string; color: string; bg: string } {
  const buyPct = total > 0 ? buy / total : 0
  const selPct = total > 0 ? sell / total : 0
  if (buyPct >= 0.55) return { text: 'ALIM', color: 'var(--profit)', bg: 'var(--profit-bg)' }
  if (selPct >= 0.55) return { text: 'SATIŞ', color: 'var(--loss)', bg: 'var(--loss-bg)' }
  if (buyPct > selPct) return { text: 'NÖTR (Hafif Al)', color: 'var(--warning)', bg: 'rgba(251,191,36,.1)' }
  if (selPct > buyPct) return { text: 'NÖTR (Hafif Sat)', color: 'var(--warning)', bg: 'rgba(251,191,36,.1)' }
  return { text: 'NÖTR', color: 'var(--text-muted)', bg: 'var(--bg-surface-2)' }
}

export function TechnicalSummary({ asset }: { asset: PriceData | undefined }) {
  if (!asset) return null

  const signals = computeSignals(asset)
  if (signals.length === 0) return null

  const buy  = signals.filter(s => s.verdict === 'AL').length
  const sell = signals.filter(s => s.verdict === 'SAT').length
  const neut = signals.filter(s => s.verdict === 'NÖTR').length
  const total = signals.length
  const verd = verdictLabel(buy, sell, total)

  const buyPct  = Math.round((buy  / total) * 100)
  const selPct  = Math.round((sell / total) * 100)

  const col = (v: 'AL' | 'NÖTR' | 'SAT') =>
    v === 'AL' ? 'var(--profit)' : v === 'SAT' ? 'var(--loss)' : 'var(--text-muted)'

  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4)',
      marginTop: 'var(--space-4)',
    }}>
      {/* Başlık */}
      <div style={{
        fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
        textTransform: 'uppercase', letterSpacing: '0.06em',
        fontWeight: 'var(--fw-bold)', marginBottom: 'var(--space-3)',
      }}>
        Teknik Özet
      </div>

      {/* Ana verdict + gauge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)',
                    marginBottom: 'var(--space-3)' }}>
        {/* Gauge bar */}
        <div style={{ flex: 1 }}>
          <div style={{
            height: 6, borderRadius: 3, background: 'var(--bg-surface-3)',
            position: 'relative', overflow: 'hidden',
          }}>
            <div style={{
              position: 'absolute', left: 0, top: 0, bottom: 0,
              width: `${buyPct}%`, background: 'var(--profit)', borderRadius: 3,
              transition: 'width .3s',
            }} />
            <div style={{
              position: 'absolute', right: 0, top: 0, bottom: 0,
              width: `${selPct}%`, background: 'var(--loss)', borderRadius: 3,
              transition: 'width .3s',
            }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between',
                        marginTop: 'var(--space-1)', fontSize: 10, color: 'var(--text-muted)' }}>
            <span style={{ color: 'var(--profit)', fontWeight: 700 }}>{buy} Al</span>
            <span>{neut} Nötr</span>
            <span style={{ color: 'var(--loss)', fontWeight: 700 }}>{sell} Sat</span>
          </div>
        </div>

        {/* Verdict badge */}
        <div style={{
          padding: '4px 12px', borderRadius: 'var(--radius-full)',
          background: verd.bg, color: verd.color,
          fontSize: 'var(--text-xs)', fontWeight: 800,
          whiteSpace: 'nowrap', flexShrink: 0,
        }}>
          {verd.text}
        </div>
      </div>

      {/* Bireysel sinyaller */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: '6px 10px',
      }}>
        {signals.map(s => (
          <div key={s.label} style={{
            display: 'flex', alignItems: 'center', gap: 5,
            fontSize: 10,
          }}>
            <span style={{ color: 'var(--text-muted)' }}>{s.label}:</span>
            <span style={{ color: col(s.verdict), fontWeight: 700 }}>{s.verdict}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
