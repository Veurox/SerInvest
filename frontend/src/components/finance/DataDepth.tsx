// =============================================================================
// SerInvest — Veri Derinliği
// docs/PLAN_2026-08.md Faz B.
//
// "Alternatif veri ne zaman kullanılabilir?" sorusunun tek bakışta cevabı.
// 08/2026 ölçümü: haber ~37 gün, temel 17 gün — bu derinlikte geriye dönük
// doğrulama YAPILAMAZ. Bu yüzden haber/temel özellikler modele girmiyor ve
// meta-labeling kapalı. Burada beklenen şey iş değil, ZAMAN.
//
// Kayıt SAYISI bilinçli olarak öne çıkarılmıyor: yanıltıcı. 10.448 haber kaydı
// vardı ama 73 güne yayılmıştı. Ölçüt gün sayısı.
// =============================================================================
import { useEffect, useState } from 'react'
import { ADMIN, adminFetch } from '../../lib/api'

interface Source {
  name: string; days: number; rows: number | null
  target: number; ready: boolean; pct: number; note: string
}

export function DataDepth() {
  const [d, setD] = useState<{ target_days: number; sources: Source[] } | null>(null)

  useEffect(() => {
    adminFetch(`${ADMIN}/data-depth`)
      .then(r => r.ok ? r.json() : null)
      .then(j => j && !j.error && setD(j))
      .catch(() => {})
  }, [])

  if (!d?.sources?.length) return null

  return (
    <div className="card" style={{ padding: '14px 16px', marginBottom: 'var(--space-3)' }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em',
                    textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4 }}>
        Veri derinliği
      </div>
      <p style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.6, margin: '0 0 12px' }}>
        Haber ve temel veri modele <b>henüz girmiyor</b> çünkü geriye dönük
        doğrulama için yeterli gün yok. Burada beklenen şey iş değil,{' '}
        <b>zaman</b> — hedef {d.target_days} gün.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {d.sources.map(s => (
          <div key={s.name}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 3 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)' }}>
                {s.name}
              </span>
              <span style={{ fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                             color: s.ready ? 'var(--profit)' : 'var(--text-primary)' }}>
                {s.days}/{s.target} gün
              </span>
              {s.ready && <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--profit)' }}>HAZIR</span>}
              {s.rows != null && (
                <span style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--text-disabled)',
                               fontVariantNumeric: 'tabular-nums' }}>
                  {s.rows.toLocaleString('tr-TR')} kayıt
                </span>
              )}
            </div>
            <div style={{ height: 5, background: 'var(--bg-surface-3)', overflow: 'hidden' }}>
              <div style={{ width: `${s.pct * 100}%`, height: '100%',
                            background: s.ready ? 'var(--profit)' : 'var(--accent)' }} />
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.45 }}>
              {s.note}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
