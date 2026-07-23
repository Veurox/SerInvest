import type { HTMLAttributes } from 'react'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padded?: boolean
  interactive?: boolean
  glow?: 'profit' | 'loss' | 'accent' | 'none'
}

export function Card({
  padded = true, interactive, glow = 'none',
  style, children, ...props
}: CardProps) {
  const glowMap = {
    profit: { borderColor: 'var(--profit-border)', background: 'linear-gradient(135deg, var(--profit-bg), transparent)' },
    loss:   { borderColor: 'var(--loss-border)',   background: 'linear-gradient(135deg, var(--loss-bg), transparent)' },
    accent: { borderColor: 'var(--accent-border)', background: 'linear-gradient(135deg, var(--accent-bg), transparent)' },
    none:   {},
  }
  return (
    <div
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-md)',
        padding: padded ? 'var(--space-4) var(--space-5)' : 0,
        cursor: interactive ? 'pointer' : 'default',
        transition: 'all var(--transition-base)',
        ...glowMap[glow],
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  )
}

export function CardHeader({ title, subtitle, action }: {
  title: string; subtitle?: string; action?: React.ReactNode
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
      gap: 'var(--space-3)', marginBottom: 'var(--space-3)',
    }}>
      <div>
        <div style={{
          fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
          textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 'var(--fw-bold)',
        }}>{title}</div>
        {subtitle && <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginTop: 'var(--space-0-5)' }}>{subtitle}</div>}
      </div>
      {action && <div>{action}</div>}
    </div>
  )
}
