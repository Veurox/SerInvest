import { useMemo, useState } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────
export interface HeatmapAsset {
  symbol: string
  assetType: string
  open: number | null
  close: number | null
  volume?: number | null
}

interface Cell {
  symbol: string
  pct: number
  close: number
  size: number   // göreceli boyut (volume veya 1)
}

// ── Yardımcılar ───────────────────────────────────────────────────────────────
function colorFor(pct: number): { bg: string; text: string } {
  // -3% → koyu kırmızı, 0 → nötr, +3% → koyu yeşil
  const clamped = Math.max(-3, Math.min(3, pct))
  const intensity = Math.abs(clamped) / 3
  if (clamped > 0.05) {
    // yeşil — alpha intensity'ye göre
    const a = 0.15 + intensity * 0.55
    return { bg: `rgba(5, 150, 105, ${a.toFixed(2)})`, text: intensity > 0.4 ? '#ffffff' : 'var(--text-primary)' }
  }
  if (clamped < -0.05) {
    const a = 0.12 + intensity * 0.55
    return { bg: `rgba(220, 38, 38, ${a.toFixed(2)})`, text: intensity > 0.4 ? '#ffffff' : 'var(--text-primary)' }
  }
  return { bg: 'var(--bg-surface-2)', text: 'var(--text-secondary)' }
}

// ── Component ─────────────────────────────────────────────────────────────────
export function BistHeatmap({
  assets,
  onSelect,
}: {
  assets: HeatmapAsset[]
  onSelect?: (symbol: string) => void
}) {
  const [sortMode, setSortMode] = useState<'change' | 'alpha' | 'volume'>('change')

  const cells: Cell[] = useMemo(() => {
    const filtered = assets
      .filter(a => a.assetType === 'BIST' && a.close != null && a.open != null && (a.open ?? 0) > 0)
      .map(a => {
        const close = a.close as number
        const open  = a.open as number
        const pct = ((close - open) / open) * 100
        const size = Math.max(1, Math.log10(Math.max(1, a.volume ?? 1) + 1))
        return { symbol: a.symbol, pct, close, size }
      })

    if (sortMode === 'change') {
      filtered.sort((a, b) => b.pct - a.pct)
    } else if (sortMode === 'volume') {
      filtered.sort((a, b) => b.size - a.size)
    } else {
      filtered.sort((a, b) => a.symbol.localeCompare(b.symbol))
    }
    return filtered
  }, [assets, sortMode])

  if (cells.length === 0) return null

  // İstatistikler
  const stats = useMemo(() => {
    const ups = cells.filter(c => c.pct > 0.05).length
    const downs = cells.filter(c => c.pct < -0.05).length
    const flat = cells.length - ups - downs
    const avg = cells.reduce((s, c) => s + c.pct, 0) / cells.length
    return { ups, downs, flat, avg }
  }, [cells])

  return (
    <div style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-md)', padding: 'var(--space-4)',
      marginBottom: 'var(--space-5)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    marginBottom: 'var(--space-3)', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
        <div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
                        textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700 }}>
            BIST Isı Haritası
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'baseline',
                        marginTop: 4, fontSize: 'var(--text-sm)' }}>
            <span style={{ color: 'var(--profit)', fontWeight: 700 }}>▲ {stats.ups}</span>
            <span style={{ color: 'var(--text-muted)' }}>● {stats.flat}</span>
            <span style={{ color: 'var(--loss)', fontWeight: 700 }}>▼ {stats.downs}</span>
            <span style={{
              color: stats.avg >= 0 ? 'var(--profit)' : 'var(--loss)',
              fontWeight: 700, marginLeft: 'var(--space-3)',
            }}>
              Ort: {stats.avg >= 0 ? '+' : ''}{stats.avg.toFixed(2)}%
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 4, background: 'var(--bg-surface-2)',
                      padding: 4, borderRadius: 'var(--radius-sm)' }}>
          {(['change', 'volume', 'alpha'] as const).map(m => (
            <button
              key={m}
              onClick={() => setSortMode(m)}
              style={{
                background: m === sortMode ? 'var(--bg-surface)' : 'transparent',
                color:      m === sortMode ? 'var(--text-primary)' : 'var(--text-muted)',
                border: 'none', cursor: 'pointer',
                padding: '4px 10px', borderRadius: 'var(--radius-xs)',
                fontSize: 'var(--text-xs)', fontWeight: 700,
                boxShadow: m === sortMode ? 'var(--shadow-xs)' : 'none',
              }}
            >
              {m === 'change' ? '% Değişim' : m === 'volume' ? 'Hacim' : 'A→Z'}
            </button>
          ))}
        </div>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(82px, 1fr))',
        gap: 4,
      }}>
        {cells.map(c => {
          const { bg, text } = colorFor(c.pct)
          return (
            <div
              key={c.symbol}
              onClick={() => onSelect?.(c.symbol)}
              title={`${c.symbol}  ${c.pct >= 0 ? '+' : ''}${c.pct.toFixed(2)}%  •  ${c.close.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}`}
              style={{
                background: bg, color: text,
                padding: '8px 6px', borderRadius: 'var(--radius-xs)',
                cursor: onSelect ? 'pointer' : 'default',
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', minHeight: 56, gap: 2,
                border: '1px solid var(--border-subtle)',
                transition: 'transform var(--transition-fast)',
              }}
              onMouseEnter={e => { if (onSelect) e.currentTarget.style.transform = 'scale(1.03)' }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)' }}
            >
              <div style={{ fontSize: 'var(--text-xs)', fontWeight: 800, letterSpacing: '.02em' }}>
                {c.symbol}
              </div>
              <div style={{ fontSize: '11px', fontWeight: 700, opacity: .92 }}>
                {c.pct >= 0 ? '+' : ''}{c.pct.toFixed(2)}%
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default BistHeatmap
