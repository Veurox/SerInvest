// =============================================================================
// Terminal — Canlı Ticker Şeridi
// Emtia/döviz + BIST hareketlileri tek akan bantta. Hover'da durur; tık → sembol.
// =============================================================================
import { useMemo } from 'react'
import type { PriceData } from '../../lib/types'

interface Props {
  assets: PriceData[]
  onSelect: (symbol: string) => void
}

function dayChangePct(a: PriceData): number | null {
  if (a.close == null || a.open == null || a.open === 0) return null
  return ((a.close - a.open) / a.open) * 100
}

const px = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pct = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'always' })

export function TickerTape({ assets, onSelect }: Props) {
  const items = useMemo(() => {
    const macro = assets.filter(a => a.assetType !== 'BIST' && a.close != null)
    const bist = assets
      .filter(a => a.assetType === 'BIST' && a.close != null)
      .map(a => ({ a, ch: Math.abs(dayChangePct(a) ?? 0) }))
      .sort((x, y) => y.ch - x.ch)
      .slice(0, 14)
      .map(x => x.a)
    return [...macro, ...bist]
  }, [assets])

  if (items.length === 0) return null

  // Kesintisiz kayma için içerik iki kez basılır (%-50 translate döngüsü)
  const strip = (keyPrefix: string) => items.map(a => {
    const ch = dayChangePct(a)
    const cls = ch == null || Math.abs(ch) < 0.005 ? 't-flat' : ch > 0 ? 't-up' : 't-down'
    return (
      <span key={`${keyPrefix}-${a.symbol}`} className="t-tick" onClick={() => onSelect(a.symbol)}
            title={`${a.symbol} grafiğini aç`}>
        <span className="t-tick__sym">{a.symbol}</span>
        <span className="t-tick__px t-num">{a.close != null ? px.format(a.close) : '—'}</span>
        <span className={`t-num ${cls}`} style={{ fontSize: 11 }}>
          {ch != null ? `${pct.format(ch)}%` : ''}
        </span>
      </span>
    )
  })

  return (
    <div className="t-panel t-area-ticker">
      <div className="t-tickertape">
        <div className="t-tickertape__inner">
          {strip('a')}
          {strip('b')}
        </div>
      </div>
    </div>
  )
}
