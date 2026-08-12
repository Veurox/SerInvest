import { useState, type ReactNode } from 'react'

interface TooltipProps {
  content: ReactNode
  children: ReactNode
  position?: 'top' | 'bottom' | 'left' | 'right'
  maxWidth?: number
  inline?: boolean
}

export function Tooltip({
  content, children, position = 'top', maxWidth = 240, inline,
}: TooltipProps) {
  const [show, setShow] = useState(false)

  const posStyle: Record<string, React.CSSProperties> = {
    top:    { bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: '8px' },
    bottom: { top: '100%',    left: '50%', transform: 'translateX(-50%)', marginTop: '8px' },
    left:   { right: '100%',  top: '50%',  transform: 'translateY(-50%)', marginRight: '8px' },
    right:  { left: '100%',   top: '50%',  transform: 'translateY(-50%)', marginLeft: '8px' },
  }

  return (
    <span
      style={{ position: 'relative', display: inline ? 'inline-block' : 'inline-flex', alignItems: 'center' }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onFocus={() => setShow(true)}
      onBlur={() => setShow(false)}
    >
      {children}
      {show && (
        <span style={{
          position: 'absolute',
          ...posStyle[position],
          zIndex: 1000,
          padding: 'var(--space-2) var(--space-3)',
          background: 'var(--bg-app)',
          border: '1px solid var(--border-strong)',
          borderRadius: 'var(--radius-sm)',
          boxShadow: 'var(--shadow-md)',
          fontSize: 'var(--text-xs)',
          color: 'var(--text-secondary)',
          lineHeight: 'var(--lh-base)',
          width: 'max-content',
          maxWidth,
          fontWeight: 'var(--fw-regular)',
          whiteSpace: 'normal',
          textAlign: 'left',
          pointerEvents: 'none',
        }}>
          {content}
        </span>
      )}
    </span>
  )
}
