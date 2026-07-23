import { forwardRef, type ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'icon'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  leftIcon?: React.ReactNode
  rightIcon?: React.ReactNode
}

const sizeMap: Record<Size, { padding: string; fontSize: string; height: string }> = {
  sm: { padding: '0 var(--space-3)',  fontSize: 'var(--text-xs)',   height: '28px' },
  md: { padding: '0 var(--space-4)',  fontSize: 'var(--text-sm)',   height: '36px' },
  lg: { padding: '0 var(--space-5)',  fontSize: 'var(--text-base)', height: '44px' },
}

const variantStyle: Record<Variant, React.CSSProperties> = {
  primary: {
    background: 'var(--accent)',
    color: '#0a0f1e',
    border: '1px solid var(--accent)',
  },
  secondary: {
    background: 'var(--bg-surface-2)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border-strong)',
  },
  danger: {
    background: 'var(--loss)',
    color: '#fff',
    border: '1px solid var(--loss)',
  },
  ghost: {
    background: 'transparent',
    color: 'var(--text-primary)',
    border: '1px solid var(--border-default)',
  },
  icon: {
    background: 'transparent',
    color: 'var(--text-muted)',
    border: '1px solid var(--border-default)',
    padding: 0,
    aspectRatio: '1',
  },
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({
  variant = 'secondary', size = 'md',
  loading, leftIcon, rightIcon, children, style, disabled, ...props
}, ref) => {
  const sz = sizeMap[size]
  const vStyle = variantStyle[variant]
  const isDisabled = disabled || loading
  return (
    <button
      ref={ref}
      disabled={isDisabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--space-2)',
        padding: variant === 'icon' ? 0 : sz.padding,
        height: sz.height,
        minWidth: variant === 'icon' ? sz.height : undefined,
        fontSize: sz.fontSize,
        fontWeight: 'var(--fw-bold)',
        borderRadius: 'var(--radius-sm)',
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        transition: 'all var(--transition-fast)',
        opacity: isDisabled ? 0.5 : 1,
        whiteSpace: 'nowrap',
        ...vStyle,
        ...style,
      }}
      {...props}
    >
      {loading ? <span className="spinner-sm" /> : leftIcon}
      {children}
      {rightIcon}
    </button>
  )
})
Button.displayName = 'Button'
