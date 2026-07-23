import type { ReactNode } from 'react'

type Tone = 'profit' | 'loss' | 'warning' | 'info' | 'accent' | 'neutral'

interface KPIProps {
  label: string
  value: ReactNode               // string veya formatted JSX
  sub?: ReactNode
  tone?: Tone
  trend?: 'up' | 'down' | null
  icon?: ReactNode
  loading?: boolean
}

const toneColor: Record<Tone, string> = {
  profit:  'var(--profit)',
  loss:    'var(--loss)',
  warning: 'var(--warning)',
  info:    'var(--info)',
  accent:  'var(--accent)',
  neutral: 'var(--text-primary)',
}

export function KPI({ label, value, sub, tone = 'neutral', trend, icon, loading }: KPIProps) {
  const color = toneColor[tone]
  const trendIcon = trend === 'up' ? '▲' : trend === 'down' ? '▼' : null

  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4) var(--space-4)',
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-1)',
      minHeight: '88px',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 'var(--space-2)',
      }}>
        <div style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          fontWeight: 'var(--fw-bold)',
        }}>
          {label}
        </div>
        {icon && (
          <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
            {icon}
          </div>
        )}
      </div>

      <div style={{
        fontSize: 'var(--text-md)',
        fontWeight: 'var(--fw-black)',
        color,
        lineHeight: 'var(--lh-tight)',
        fontVariantNumeric: 'tabular-nums',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-1)',
      }}>
        {trendIcon && <span style={{ fontSize: 'var(--text-sm)' }}>{trendIcon}</span>}
        {loading ? <span className="skeleton" style={{ width: '60%', height: '20px' }} /> : value}
      </div>

      {sub && (
        <div style={{
          fontSize: 'var(--text-xs)',
          color: tone === 'neutral' ? 'var(--text-muted)' : color,
          opacity: tone === 'neutral' ? 1 : 0.85,
          fontVariantNumeric: 'tabular-nums',
        }}>
          {sub}
        </div>
      )}
    </div>
  )
}
