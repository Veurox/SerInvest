import { forwardRef, type InputHTMLAttributes, type SelectHTMLAttributes } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  leftIcon?: React.ReactNode
  rightIcon?: React.ReactNode
  fullWidth?: boolean
}

export const Input = forwardRef<HTMLInputElement, InputProps>(({
  leftIcon, rightIcon, fullWidth = true, style, ...props
}, ref) => (
  <div style={{ position: 'relative', width: fullWidth ? '100%' : 'auto' }}>
    {leftIcon && (
      <span style={{
        position: 'absolute', left: 'var(--space-3)', top: '50%', transform: 'translateY(-50%)',
        color: 'var(--text-muted)', fontSize: 'var(--text-base)', pointerEvents: 'none',
        display: 'flex', alignItems: 'center',
      }}>{leftIcon}</span>
    )}
    <input
      ref={ref}
      style={{
        width: '100%',
        padding: leftIcon
          ? 'var(--space-2-5, 10px) var(--space-3) var(--space-2-5, 10px) var(--space-7)'
          : 'var(--space-2-5, 10px) var(--space-3)',
        paddingLeft: leftIcon ? '40px' : 'var(--space-3)',
        paddingRight: rightIcon ? '40px' : 'var(--space-3)',
        fontSize: 'var(--text-sm)',
        background: 'var(--bg-surface-2)',
        border: '1px solid var(--border-strong)',
        color: 'var(--text-primary)',
        borderRadius: 'var(--radius-sm)',
        outline: 'none',
        transition: 'border-color var(--transition-fast)',
        colorScheme: 'dark',
        height: '36px',
        ...style,
      }}
      {...props}
    />
    {rightIcon && (
      <span style={{
        position: 'absolute', right: 'var(--space-2)', top: '50%', transform: 'translateY(-50%)',
        color: 'var(--text-muted)', fontSize: 'var(--text-base)',
      }}>{rightIcon}</span>
    )}
  </div>
))
Input.displayName = 'Input'

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  fullWidth?: boolean
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(({
  fullWidth = true, style, children, ...props
}, ref) => (
  <select
    ref={ref}
    style={{
      width: fullWidth ? '100%' : 'auto',
      padding: '0 var(--space-3)',
      fontSize: 'var(--text-sm)',
      background: 'var(--bg-surface-2)',
      border: '1px solid var(--border-strong)',
      color: 'var(--text-primary)',
      borderRadius: 'var(--radius-sm)',
      outline: 'none',
      colorScheme: 'dark',
      height: '36px',
      cursor: 'pointer',
      ...style,
    }}
    {...props}
  >
    {children}
  </select>
))
Select.displayName = 'Select'
