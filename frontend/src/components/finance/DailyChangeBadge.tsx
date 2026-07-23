/**
 * Günlük değişim rozeti: ▲ %1.42 / ▼ %0.85
 * Pozitif yeşil, negatif kırmızı, sıfır nötr.
 */
interface DailyChangeBadgeProps {
  changePct: number | null            // 0.0142 = %1.42
  size?: 'sm' | 'md'
  showSymbol?: boolean
}

const sizeMap = {
  sm: { fontSize: 'var(--text-xs)',  padding: '1px var(--space-2)',  height: '18px' },
  md: { fontSize: 'var(--text-sm)',  padding: '2px var(--space-3)',  height: '24px' },
}

export function DailyChangeBadge({ changePct, size = 'sm', showSymbol = true }: DailyChangeBadgeProps) {
  if (changePct == null) return null

  const sz = sizeMap[size]
  const isUp = changePct > 0
  const isFlat = Math.abs(changePct) < 0.0001

  const color = isFlat ? 'var(--text-muted)' : isUp ? 'var(--profit)' : 'var(--loss)'
  const bg    = isFlat ? 'var(--bg-glass)' : isUp ? 'var(--profit-bg)' : 'var(--loss-bg)'
  const arrow = showSymbol ? (isFlat ? '─' : isUp ? '▲' : '▼') : ''

  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 'var(--space-1)',
      padding: sz.padding,
      height: sz.height,
      fontSize: sz.fontSize,
      fontWeight: 'var(--fw-bold)',
      color,
      background: bg,
      borderRadius: 'var(--radius-xs)',
      whiteSpace: 'nowrap',
      fontVariantNumeric: 'tabular-nums',
    }}>
      {arrow && <span style={{ fontSize: '0.85em' }}>{arrow}</span>}
      {Math.abs(changePct * 100).toFixed(2)}%
    </span>
  )
}
