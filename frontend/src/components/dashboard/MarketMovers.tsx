// =============================================================================
// SerInvest — Hareket Edenler
// 3 kolon: En Çok Yükselen · En Çok Düşen · En Çok İşlem Gören (hacim).
// Her satır tıklanır → DetailPanel açılır.
// =============================================================================
import { CompanyLogo } from '../common/CompanyLogo'
import { fmt } from '../../lib/format'
import { COMPANY_NAMES } from '../../lib/companies'
import type { PriceData } from '../../lib/types'

const fmtVol = (v: number | null): string => {
  if (v == null) return '—'
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`
  return `${v}`
}

type Mover = PriceData & { pct: number }

function Row({ a, onSelect, showVol }: { a: Mover; onSelect: (s: string) => void; showVol?: boolean }) {
  const up = a.pct >= 0
  return (
    <button
      onClick={() => onSelect(a.symbol)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%',
        background: 'transparent', border: 'none', cursor: 'pointer',
        padding: '5px 0', textAlign: 'left', borderBottom: '0.5px solid var(--border-subtle)',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-surface-2)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      <CompanyLogo symbol={a.symbol} size={22} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--fw-black)', color: 'var(--text-primary)' }}>
          {a.symbol}
        </div>
        <div style={{ fontSize: 9, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 110 }}>
          {showVol ? `Hacim ${fmtVol(a.volume)}` : (COMPANY_NAMES[a.symbol] ?? '')}
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--fw-bold)', color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
          {fmt(a.close, 2)}
        </div>
        <div style={{ fontSize: 10, fontWeight: 700, color: up ? 'var(--profit)' : 'var(--loss)', fontVariantNumeric: 'tabular-nums' }}>
          {up ? '▲ +' : '▼ '}{Math.abs(a.pct).toFixed(2)}%
        </div>
      </div>
    </button>
  )
}

function Col({ title, color, rows, onSelect, showVol }: {
  title: string; color: string; rows: Mover[]; onSelect: (s: string) => void; showVol?: boolean
}) {
  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-md)', padding: 'var(--space-3)' }}>
      <div style={{ fontSize: 9, fontWeight: 700, color, textTransform: 'uppercase',
        letterSpacing: '.08em', marginBottom: 6 }}>{title}</div>
      {rows.map(a => <Row key={a.symbol} a={a} onSelect={onSelect} showVol={showVol} />)}
    </div>
  )
}

export function MarketMovers({ assets, onSelect }: {
  assets: PriceData[]
  onSelect: (symbol: string) => void
}) {
  const bist: Mover[] = assets
    .filter(a => a.assetType === 'BIST' && a.open != null && a.close != null && a.open > 0)
    .map(a => ({ ...a, pct: ((a.close! - a.open!) / a.open!) * 100 }))

  if (bist.length === 0) return null

  const byPct = [...bist].sort((a, b) => b.pct - a.pct)
  const gainers = byPct.slice(0, 5)
  const losers = [...byPct].reverse().slice(0, 5)
  const active = [...bist].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0)).slice(0, 5)

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-3)' }}>
      <Col title="En Çok Yükselen" color="var(--profit)" rows={gainers} onSelect={onSelect} />
      <Col title="En Çok Düşen" color="var(--loss)" rows={losers} onSelect={onSelect} />
      <Col title="En Çok İşlem Gören" color="var(--accent)" rows={active} onSelect={onSelect} showVol />
    </div>
  )
}
