// =============================================================================
// SerInvest — Piyasa Nabzı
// Tek bakışta piyasa durumu: BIST barometresi + genişlik (advance/decline),
// gram altın (TL), USD/TRY, risk barometresi (VIX). ~72px yatay şerit.
// =============================================================================
import { fmt } from '../../lib/format'
import type { PriceData } from '../../lib/types'

const pct = (a: PriceData) =>
  a.open && a.open > 0 && a.close != null ? ((a.close - a.open) / a.open) * 100 : null

export function MarketPulse({ assets }: { assets: PriceData[] }) {
  const bist = assets.filter(a => a.assetType === 'BIST' && pct(a) != null)
  if (bist.length === 0) return null

  // BIST barometresi — tüm hisselerin ortalama günlük değişimi (sentetik endeks)
  const changes = bist.map(a => pct(a)!)
  const avg = changes.reduce((s, v) => s + v, 0) / changes.length
  const up = changes.filter(v => v > 0.05).length
  const down = changes.filter(v => v < -0.05).length
  const flat = changes.length - up - down
  const total = changes.length
  const baroColor = avg >= 0 ? 'var(--profit)' : 'var(--loss)'

  // Gram altın (TL) = (XAUUSD / 31.1035) × USDTRY
  const xau = assets.find(a => a.symbol === 'XAUUSD')
  const usd = assets.find(a => a.symbol === 'USDTRY')
  const gramGold = xau?.close != null && usd?.close != null
    ? (xau.close / 31.1035) * usd.close
    : null
  // Gram altın günlük değişimi ≈ altın% + dolar%
  const gramPct = xau && usd ? (pct(xau) ?? 0) + (pct(usd) ?? 0) : null

  const usdPct = usd ? pct(usd) : null

  // Risk barometresi (VIX)
  const vix = assets.find(a => a.symbol === 'VIX')
  const risk = vix?.close == null ? null
    : vix.close < 20 ? { label: 'Düşük Risk', color: 'var(--profit)' }
    : vix.close < 30 ? { label: 'Orta Risk', color: 'var(--warning)' }
    : { label: 'Yüksek Risk', color: 'var(--loss)' }

  const Pct = ({ v }: { v: number | null }) => (
    <span className="pulse-sub" style={{ color: v == null ? 'var(--text-muted)' : v >= 0 ? 'var(--profit)' : 'var(--loss)' }}>
      {v == null ? '—' : `${v >= 0 ? '▲ +' : '▼ '}${Math.abs(v).toFixed(2)}%`}
    </span>
  )

  return (
    <div className="market-pulse">
      {/* BIST barometresi + genişlik */}
      <div className="pulse-cell hero">
        <span className="pulse-k">BIST Barometresi · {total} hisse</span>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span className="pulse-v" style={{ color: baroColor }}>
            {avg >= 0 ? '+' : ''}{avg.toFixed(2)}%
          </span>
          <span style={{ fontSize: 10, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            <span style={{ color: 'var(--profit)' }}>{up} ↑</span>
            <span style={{ color: 'var(--text-muted)', margin: '0 4px' }}>{flat} →</span>
            <span style={{ color: 'var(--loss)' }}>{down} ↓</span>
          </span>
        </div>
        <div className="breadth-track">
          <div className="breadth-up" style={{ width: `${(up / total) * 100}%` }} />
          <div className="breadth-flat" style={{ width: `${(flat / total) * 100}%` }} />
          <div className="breadth-down" style={{ width: `${(down / total) * 100}%` }} />
        </div>
      </div>

      {/* Gram Altın */}
      <div className="pulse-cell">
        <span className="pulse-k">Gram Altın</span>
        <span className="pulse-v">{gramGold != null ? fmt(gramGold, 0) : '—'}<span style={{ fontSize: '.6em', color: 'var(--text-muted)', marginLeft: 2 }}>₺</span></span>
        <Pct v={gramPct} />
      </div>

      {/* USD/TRY */}
      <div className="pulse-cell">
        <span className="pulse-k">Dolar/TL</span>
        <span className="pulse-v">{usd?.close != null ? fmt(usd.close, 2) : '—'}<span style={{ fontSize: '.6em', color: 'var(--text-muted)', marginLeft: 2 }}>₺</span></span>
        <Pct v={usdPct} />
      </div>

      {/* Risk barometresi */}
      {risk && (
        <div className="pulse-cell">
          <span className="pulse-k">Risk · VIX</span>
          <span className="pulse-v" style={{ fontSize: 'var(--text-sm)' }}>{fmt(vix!.close, 1)}</span>
          <span className="pulse-sub" style={{ color: risk.color }}>● {risk.label}</span>
        </div>
      )}
    </div>
  )
}
