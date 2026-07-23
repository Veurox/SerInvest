import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

type ToastType = 'success' | 'error' | 'warning' | 'info'

interface ToastItem {
  id: number
  type: ToastType
  message: string
  duration: number
}

interface ToastContextValue {
  show: (message: string, type?: ToastType, duration?: number) => void
  success: (message: string) => void
  error: (message: string) => void
  warning: (message: string) => void
  info: (message: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const COLORS: Record<ToastType, { bg: string; border: string; color: string; icon: string }> = {
  success: { bg: 'var(--profit-bg)',  border: 'var(--profit-border)',  color: 'var(--profit)',  icon: '✓' },
  error:   { bg: 'var(--loss-bg)',    border: 'var(--loss-border)',    color: 'var(--loss)',    icon: '✕' },
  warning: { bg: 'var(--warning-bg)', border: 'var(--warning-border)', color: 'var(--warning)', icon: '⚠' },
  info:    { bg: 'var(--info-bg)',    border: 'var(--info-border)',    color: 'var(--info)',    icon: 'ℹ' },
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const show = useCallback((message: string, type: ToastType = 'info', duration = 3500) => {
    const id = Date.now() + Math.random()
    setToasts(prev => [...prev, { id, type, message, duration }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, duration)
  }, [])

  const value: ToastContextValue = {
    show,
    success: (m) => show(m, 'success'),
    error:   (m) => show(m, 'error', 5000),
    warning: (m) => show(m, 'warning', 4000),
    info:    (m) => show(m, 'info'),
  }

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Toast container — ekranın sağ-üst köşesinde */}
      <div style={{
        position: 'fixed',
        top: 'var(--space-4)',
        right: 'var(--space-4)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
        zIndex: 9999,
        pointerEvents: 'none',
        maxWidth: '380px',
      }}>
        {toasts.map(t => {
          const c = COLORS[t.type]
          return (
            <div key={t.id} style={{
              padding: 'var(--space-3) var(--space-4)',
              background: 'var(--bg-surface)',
              border: `1px solid ${c.border}`,
              borderLeft: `4px solid ${c.color}`,
              borderRadius: 'var(--radius-md)',
              boxShadow: 'var(--shadow-lg)',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-3)',
              fontSize: 'var(--text-sm)',
              color: 'var(--text-primary)',
              pointerEvents: 'auto',
              animation: 'toast-slide-in 200ms ease-out',
              minWidth: '300px',
            }}>
              <span style={{
                fontSize: 'var(--text-md)',
                color: c.color,
                fontWeight: 'var(--fw-black)',
                flexShrink: 0,
              }}>{c.icon}</span>
              <span style={{ flex: 1 }}>{t.message}</span>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    // Provider yoksa no-op döndür (hata fırlatmasın)
    return {
      show: () => {}, success: () => {}, error: () => {}, warning: () => {}, info: () => {},
    }
  }
  return ctx
}
