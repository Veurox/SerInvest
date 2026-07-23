// =============================================================================
// SerInvest — Admin API Anahtarı Girişi
// Yönetim işlemleri için X-Admin-Key. localStorage > docker .env sırası.
// =============================================================================
import { useState } from 'react'

// Feature importance grafiklerinde grup renkleri (Admin + MLOps ortak kullanır).
export const GROUP_COLORS: Record<string, string> = {
  'Cross-Asset': '#818cf8', 'Momentum': '#f59e0b', '52H-Pozisyon': '#22c55e',
  'Return': '#34d399',      'Hacim': '#60a5fa',    'Trend': '#a78bfa',
  'Bollinger': '#f472b6',   'Volatilite': '#fb923c', 'Mum': '#94a3b8', 'Diğer': '#64748b',
}

export function AdminKeyInput({ onSaved }: { onSaved: () => void }) {
  const envKey = (import.meta.env.VITE_ADMIN_API_KEY as string | undefined) ?? ''
  const lsKey  = localStorage.getItem('si_admin_key') ?? ''
  const [key, setKey] = useState(lsKey)
  const [show, setShow] = useState(false)

  const lsSet  = lsKey.length > 0
  const envSet = envKey.length > 0
  const hasKey = lsSet || envSet
  const source = lsSet ? 'tarayıcı' : envSet ? 'docker .env' : 'yok'

  const save = () => {
    if (key) localStorage.setItem('si_admin_key', key)
    else localStorage.removeItem('si_admin_key')
    onSaved()
  }
  const clear = () => {
    setKey('')
    localStorage.removeItem('si_admin_key')
    onSaved()
  }

  return (
    <div style={{
      background: 'var(--surface)', border: `1px solid ${hasKey ? 'rgba(34,197,94,.25)' : 'rgba(239,68,68,.4)'}`,
      borderRadius: '10px', padding: '.85rem 1.1rem',
      display: 'flex', alignItems: 'center', gap: '.75rem', flexWrap: 'wrap',
    }}>
      <span style={{ fontSize: '1rem' }}>{hasKey ? '🔓' : '🔒'}</span>
      <div style={{ flex: 1, minWidth: '200px' }}>
        <div style={{ fontSize: '.8rem', fontWeight: 700, color: hasKey ? '#22c55e' : '#ef4444' }}>
          Admin API Anahtarı {hasKey ? `— Aktif (${source})` : '— Gerekli'}
        </div>
        <div style={{ fontSize: '.7rem', color: 'var(--text-muted)', marginTop: '.15rem' }}>
          {hasKey
            ? lsSet
              ? 'Tarayıcıdaki anahtar kullanılıyor — docker .env değerini geçersiz kılar.'
              : 'docker-compose .env dosyasındaki ADMIN_API_KEY otomatik kullanılıyor. Manuel değişiklik gerekmiyor.'
            : 'Yönetim işlemleri için .env dosyasındaki ADMIN_API_KEY değerini girin.'}
        </div>
      </div>
      <input
        type={show ? 'text' : 'password'}
        value={key}
        onChange={e => setKey(e.target.value)}
        placeholder={envSet ? '(geçersiz kılmak için anahtar girin)' : 'X-Admin-Key...'}
        style={{
          background: 'var(--surface-2)', border: '1px solid var(--border)',
          borderRadius: '6px', padding: '.4rem .65rem',
          color: 'var(--text)', fontSize: '.78rem',
          fontFamily: 'monospace', minWidth: '220px', outline: 'none',
        }}
      />
      <button onClick={() => setShow(s => !s)} style={{
        background: 'transparent', border: '1px solid var(--border)', borderRadius: '6px',
        padding: '.4rem .65rem', color: 'var(--text-muted)', fontSize: '.72rem', cursor: 'pointer',
      }}>{show ? 'Gizle' : 'Göster'}</button>
      <button onClick={save} style={{
        background: 'rgba(34,197,94,.15)', border: '1px solid rgba(34,197,94,.4)', borderRadius: '6px',
        padding: '.4rem .9rem', color: '#22c55e', fontSize: '.78rem', fontWeight: 700, cursor: 'pointer',
      }}>Kaydet</button>
      {lsSet && (
        <button onClick={clear} style={{
          background: 'transparent', border: '1px solid rgba(239,68,68,.3)', borderRadius: '6px',
          padding: '.4rem .65rem', color: '#ef4444', fontSize: '.72rem', cursor: 'pointer',
        }}>Temizle</button>
      )}
    </div>
  )
}

export default AdminKeyInput
