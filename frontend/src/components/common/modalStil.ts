// =============================================================================
// SerInvest — form ve düğme stil yardımcıları (Modal ile birlikte kullanılır)
// Modal.tsx'ten ayrıldı (18.10.2026): bileşen dosyası yalnız bileşen dışa
// açarsa hızlı yenileme (HMR) güvenilir çalışır.
// =============================================================================
import type React from 'react'

export const inputStyle = (): React.CSSProperties => ({
  width: '100%', padding: '.6rem .8rem', fontSize: 'var(--text-sm)',
  background: 'var(--bg-surface-2)', border: '1px solid var(--border-strong)',
  color: 'var(--text-primary)', borderRadius: 'var(--radius-sm)', outline: 'none',
  colorScheme: 'dark',
})

export const btnStyle = (variant: 'primary' | 'danger' | 'ghost'): React.CSSProperties => {
  const base: React.CSSProperties = {
    padding: '.55rem 1.1rem', fontSize: '.85rem', fontWeight: 700,
    border: 'none', borderRadius: '6px', cursor: 'pointer',
  }
  if (variant === 'primary') return { ...base, background: '#22c55e', color: '#fff' }
  if (variant === 'danger')  return { ...base, background: '#ef4444', color: '#fff' }
  return { ...base, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text)' }
}
