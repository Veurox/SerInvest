// =============================================================================
// SerInvest — Action Button (ikon + başlık + açıklama)
// Admin/MLOps sekmelerindeki işlem butonları için.
// =============================================================================

import type { ReactNode } from 'react'

export function ActionBtn({ icon, label, desc, color, disabled, onClick }: {
  icon: ReactNode; label: string; desc: string; color: string
  disabled?: boolean; onClick: () => void
}) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
      gap: '.2rem', padding: '.85rem 1.1rem', borderRadius: '12px',
      border: `1px solid ${color}44`, background: `${color}11`,
      cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
      minWidth: '175px', flex: '1 1 175px', maxWidth: '240px',
      transition: 'all .15s',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', fontWeight: 800, color, fontSize: '.9rem' }}>
        <span>{icon}</span><span>{label}</span>
      </div>
      <div style={{ fontSize: '.68rem', color: '#94a3b8', textAlign: 'left', lineHeight: 1.4 }}>{desc}</div>
    </button>
  )
}

export default ActionBtn
