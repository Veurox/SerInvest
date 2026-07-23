/**
 * Confidence (güven) ölçer — % değil görsel bar.
 * 5 segment, dolan kısım renkli.
 */
interface ConfidenceMeterProps {
  value: number              // 0-1 arası
  label?: string
  size?: 'sm' | 'md'
  showPct?: boolean
}

export function ConfidenceMeter({
  value, label = 'Güven', size = 'sm', showPct = true,
}: ConfidenceMeterProps) {
  const v = Math.max(0, Math.min(1, value))
  const segments = 10
  const filled = Math.round(v * segments)

  // Renk skalası: <%55 nötr, %55-70 yeşil, >%70 koyu yeşil
  const color = v < 0.55 ? 'var(--text-muted)'
    : v < 0.70 ? 'var(--profit-soft)'
    : 'var(--profit)'

  const segHeight = size === 'sm' ? '6px' : '10px'
  const segGap    = size === 'sm' ? '2px' : '3px'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', minWidth: '120px' }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: 'var(--text-xs)',
        color: 'var(--text-muted)',
        fontWeight: 'var(--fw-medium)',
      }}>
        <span>{label}</span>
        {showPct && (
          <span style={{ color, fontWeight: 'var(--fw-bold)', fontVariantNumeric: 'tabular-nums' }}>
            %{Math.round(v * 100)}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', gap: segGap }}>
        {Array.from({ length: segments }).map((_, i) => (
          <div key={i} style={{
            flex: 1,
            height: segHeight,
            background: i < filled ? color : 'var(--bg-surface-3)',
            borderRadius: '2px',
            transition: 'background 0.3s',
          }} />
        ))}
      </div>
    </div>
  )
}
