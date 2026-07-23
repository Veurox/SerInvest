/**
 * Oracle önerisi rozeti: GÜÇLÜ ALIM / ALIM / NÖTR / KAÇIN / GÜÇLÜ KAÇIN
 * Sinyal token renklerine göre otomatik renklenir.
 */
interface SignalPillProps {
  signal: string                         // 'GÜÇLÜ ALIM' | 'BUY' vb.
  size?: 'sm' | 'md'
  outlined?: boolean
}

function getColor(signal: string): { color: string; bg: string; border: string } {
  const s = signal.toUpperCase()
  if (s.includes('GÜÇLÜ AL') || s === 'STRONG_BUY')
    return { color: 'var(--signal-strong-buy)', bg: 'rgba(16,185,129,.15)', border: 'rgba(16,185,129,.35)' }
  if (s === 'ALIM' || s === 'BUY')
    return { color: 'var(--signal-buy)', bg: 'rgba(132,204,22,.15)', border: 'rgba(132,204,22,.35)' }
  if (s === 'GÜÇLÜ KAÇIN' || s === 'STRONG_SELL')
    return { color: 'var(--signal-strong-sell)', bg: 'rgba(244,63,94,.15)', border: 'rgba(244,63,94,.35)' }
  if (s === 'KAÇIN' || s === 'SELL')
    return { color: 'var(--signal-sell)', bg: 'rgba(251,146,60,.15)', border: 'rgba(251,146,60,.35)' }
  return { color: 'var(--signal-neutral)', bg: 'rgba(148,163,184,.15)', border: 'rgba(148,163,184,.35)' }
}

const sizeMap = {
  sm: { fontSize: 'var(--text-xs)', padding: '0 var(--space-2)',  height: '20px' },
  md: { fontSize: 'var(--text-sm)', padding: '0 var(--space-3)',  height: '28px' },
}

export function SignalPill({ signal, size = 'sm', outlined }: SignalPillProps) {
  const c = getColor(signal)
  const sz = sizeMap[size]
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: sz.padding,
      height: sz.height,
      fontSize: sz.fontSize,
      fontWeight: 'var(--fw-bold)',
      color: c.color,
      background: outlined ? 'transparent' : c.bg,
      border: `1px solid ${c.border}`,
      borderRadius: 'var(--radius-sm)',
      whiteSpace: 'nowrap',
      letterSpacing: '0.02em',
    }}>
      {signal}
    </span>
  )
}
