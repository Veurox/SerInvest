import type { HTMLAttributes } from 'react'

type Tone = 'profit' | 'loss' | 'warning' | 'info' | 'accent' | 'neutral'
type Size = 'sm' | 'md'

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone
  size?: Size
  outlined?: boolean
}

const toneMap: Record<Tone, { color: string; bg: string; border: string }> = {
  profit:  { color: 'var(--profit)',  bg: 'var(--profit-bg)',  border: 'var(--profit-border)' },
  loss:    { color: 'var(--loss)',    bg: 'var(--loss-bg)',    border: 'var(--loss-border)' },
  warning: { color: 'var(--warning)', bg: 'var(--warning-bg)', border: 'var(--warning-border)' },
  info:    { color: 'var(--info)',    bg: 'var(--info-bg)',    border: 'var(--info-border)' },
  accent:  { color: 'var(--accent)',  bg: 'var(--accent-bg)',  border: 'var(--accent-border)' },
  neutral: { color: 'var(--text-secondary)', bg: 'var(--bg-glass)', border: 'var(--border-strong)' },
}

const sizeMap: Record<Size, { fontSize: string; padding: string; height: string }> = {
  sm: { fontSize: 'var(--text-xs)', padding: '0 var(--space-2)',   height: '20px' },
  md: { fontSize: 'var(--text-sm)', padding: '0 var(--space-3)',   height: '26px' },
}

export function Badge({
  tone = 'neutral', size = 'sm', outlined,
  children, style, ...props
}: BadgeProps) {
  const t = toneMap[tone]
  const sz = sizeMap[size]
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-1)',
        padding: sz.padding,
        height: sz.height,
        fontSize: sz.fontSize,
        fontWeight: 'var(--fw-bold)',
        color: t.color,
        background: outlined ? 'transparent' : t.bg,
        border: `1px solid ${t.border}`,
        borderRadius: 'var(--radius-sm)',
        whiteSpace: 'nowrap',
        ...style,
      }}
      {...props}
    >
      {children}
    </span>
  )
}
