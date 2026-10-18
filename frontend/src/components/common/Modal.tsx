// =============================================================================
// SerInvest — Modal + Form Primitive'leri
// Modal kabuk, Field etiketi, ortak input/buton stilleri.
// =============================================================================
import React from 'react'

export function Modal({ children, onClose, title }: {
  children: React.ReactNode; onClose: () => void; title: string
}) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.85)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem',
      backdropFilter: 'blur(8px)' }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-strong)',
        borderRadius: 'var(--radius-lg)', padding: 'var(--space-5)',
        maxWidth: '520px', width: '100%', maxHeight: '90vh', overflowY: 'auto',
        boxShadow: 'var(--shadow-xl), var(--shadow-accent)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginBottom: 'var(--space-4)', paddingBottom: 'var(--space-3)',
          borderBottom: '1px solid var(--border-default)' }}>
          <h3 style={{ margin: 0, fontSize: 'var(--text-md)', fontWeight: 'var(--fw-black)', color: 'var(--text-primary)' }}>{title}</h3>
          <button onClick={onClose}
            style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border-strong)',
              color: 'var(--text-muted)', fontSize: 'var(--text-md)', cursor: 'pointer',
              borderRadius: 'var(--radius-sm)', width: '30px', height: '30px',
              display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <div style={{ fontSize: '.7rem', color: 'var(--text-muted)', textTransform: 'uppercase',
        letterSpacing: '.05em', marginBottom: '.3rem', fontWeight: 600 }}>{label}</div>
      {children}
    </label>
  )
}
