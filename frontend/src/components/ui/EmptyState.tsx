import type { ReactNode } from 'react'

interface EmptyStateProps {
  icon?: ReactNode | string
  title: string
  message?: string
  action?: ReactNode
  size?: 'sm' | 'md' | 'lg'
}

export function EmptyState({
  icon = '📭', title, message, action, size = 'md',
}: EmptyStateProps) {
  const padMap = { sm: 'var(--space-5)', md: 'var(--space-6) var(--space-5)', lg: 'var(--space-7) var(--space-5)' }
  const iconSize = { sm: '32px', md: '48px', lg: '64px' }
  return (
    <div style={{
      padding: padMap[size],
      textAlign: 'center',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      gap: 'var(--space-3)',
      color: 'var(--text-muted)',
    }}>
      <div style={{ fontSize: iconSize[size], lineHeight: 1, opacity: 0.7 }}>
        {icon}
      </div>
      <div>
        <div style={{
          fontSize: 'var(--text-md)',
          fontWeight: 'var(--fw-bold)',
          color: 'var(--text-secondary)',
          marginBottom: 'var(--space-1)',
        }}>{title}</div>
        {message && (
          <div style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--text-muted)',
            maxWidth: '420px',
            lineHeight: 'var(--lh-base)',
          }}>{message}</div>
        )}
      </div>
      {action && <div style={{ marginTop: 'var(--space-2)' }}>{action}</div>}
    </div>
  )
}
