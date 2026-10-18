// =============================================================================
// SerInvest — Model Sürümleri ve Geri Alma
// docs/SAGLAMLIK_PLANI.md Katman D1.
//
// Şampiyon her değiştiğinde eskisi arşivlenir. Terfi eden rakip canlıda kötü
// çıkarsa buradan eski modele dönülür. Geri almanın kendisi de geri alınabilir:
// dönüşten önce mevcut şampiyon da arşivlenir.
// =============================================================================
import { useEffect, useState } from 'react'
import { ADMIN, adminFetch } from '../../lib/api'
import { useToast } from '../ui/toastBaglam'

interface Version {
  version_id: string; archived_at: string; reason: string
  hash: string; size_bytes: number
  trained_at?: string | null; n_rows?: number | null
  date_max?: string | null; auc?: number | null
  restored_from?: string; available: boolean
}

const trDateTime = (iso?: string | null) =>
  !iso ? '—' : new Date(iso.length <= 10 ? iso + 'T00:00:00' : iso + 'Z')
    .toLocaleString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric',
                               hour: '2-digit', minute: '2-digit' })

export function ModelVersions() {
  const toast = useToast()
  const [vs, setVs] = useState<Version[]>([])
  const [cur, setCur] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  const load = () => adminFetch(`${ADMIN}/model-versions`)
    .then(r => r.ok ? r.json() : null)
    .then(j => { if (j) { setVs(j.versions ?? []); setCur(j.current_hash ?? null) } })
    .catch(() => {})

  useEffect(() => { load() }, [])

  const rollback = async (id: string) => {
    setBusy(id); setConfirmId(null)
    try {
      const r = await adminFetch(`${ADMIN}/model-rollback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version_id: id, confirm: true }),
      })
      const j = await r.json()
      if (!r.ok || j.error) toast.error(j.error ?? 'Geri alınamadı')
      else { toast.success(j.message ?? 'Model geri alındı'); load() }
    } catch { toast.error('Sunucuya ulaşılamadı') } finally { setBusy(null) }
  }

  const usable = vs.filter(v => v.available)

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 'var(--space-3)' }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                 padding: '10px 14px', background: 'transparent', border: 'none', textAlign: 'left',
                 color: 'var(--text-primary)', fontSize: 13, fontWeight: 700 }}>
        <span style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s',
                       color: 'var(--text-muted)' }}>▸</span>
        Model sürümleri ve geri alma
        <span style={{ fontWeight: 400, fontSize: 11.5, color: 'var(--text-muted)' }}>
          {usable.length === 0
            ? '· henüz arşiv yok'
            : `· ${usable.length} sürüme dönülebilir`}
        </span>
      </button>

      {open && (
        <div style={{ padding: '0 14px 12px', borderTop: '1px solid var(--border-subtle)' }}>
          <p style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.6, margin: '10px 0' }}>
            Şampiyon her değiştiğinde (terfi veya yeniden eğitim) eskisi arşivlenir.
            Terfi eden model canlıda kötü çıkarsa buradan eskisine dönebilirsin.
            <b> Geri alma kalıcı bir kayıp değildir</b> — dönüşten önce mevcut model de arşivlenir.
          </p>

          {vs.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '6px 0' }}>
              Henüz arşivlenmiş sürüm yok. İlk arşiv, model bir sonraki kez
              değiştiğinde (veya servis yeniden başladığında) oluşur.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {vs.map(v => {
                const isCurrent = cur != null && v.hash === cur
                return (
                  <div key={v.version_id} style={{
                    display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 10,
                    alignItems: 'center', padding: '8px 10px', borderRadius: 5,
                    border: '1px solid var(--border-subtle)',
                    background: isCurrent ? 'var(--info-bg)' : 'var(--bg-surface-2)',
                  }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)' }}>
                        {v.reason}
                        {isCurrent && <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 700,
                                                     color: 'var(--info)' }}>● şu an canlıda</span>}
                        {!v.available && <span style={{ marginLeft: 6, fontSize: 10.5,
                                                        color: 'var(--text-disabled)' }}>(dosya silinmiş)</span>}
                      </div>
                      <div style={{ fontSize: 10.5, color: 'var(--text-muted)',
                                    fontVariantNumeric: 'tabular-nums' }}>
                        {trDateTime(v.archived_at)}
                        {v.trained_at && <> · eğitim {trDateTime(v.trained_at)}</>}
                        {v.n_rows != null && <> · {v.n_rows.toLocaleString('tr-TR')} satır</>}
                        {v.auc != null && <> · AUC {v.auc.toFixed(3)}</>}
                        {' · '}<code style={{ fontSize: 10 }}>{v.hash}</code>
                      </div>
                    </div>

                    {v.available && !isCurrent && (
                      confirmId === v.version_id ? (
                        <span style={{ display: 'flex', gap: 6 }}>
                          <button onClick={() => rollback(v.version_id)} disabled={busy != null}
                            style={{ fontSize: 11.5, padding: '3px 10px', borderRadius: 4, fontWeight: 700,
                                     cursor: 'pointer', border: '1px solid var(--loss-border)',
                                     background: 'var(--loss-bg)', color: 'var(--loss)' }}>
                            Eminim, dön
                          </button>
                          <button onClick={() => setConfirmId(null)}
                            style={{ fontSize: 11.5, padding: '3px 8px', borderRadius: 4, cursor: 'pointer',
                                     border: '1px solid var(--border-default)',
                                     background: 'var(--bg-surface)', color: 'var(--text-secondary)' }}>
                            Vazgeç
                          </button>
                        </span>
                      ) : (
                        <button onClick={() => setConfirmId(v.version_id)} disabled={busy != null}
                          style={{ fontSize: 11.5, padding: '3px 10px', borderRadius: 4,
                                   cursor: busy ? 'wait' : 'pointer',
                                   border: '1px solid var(--border-default)',
                                   background: 'var(--bg-surface)', color: 'var(--text-secondary)' }}>
                          {busy === v.version_id ? 'Dönülüyor…' : 'Bu sürüme dön'}
                        </button>
                      )
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
