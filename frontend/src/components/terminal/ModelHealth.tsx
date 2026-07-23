// =============================================================================
// Terminal — Model Sağlığı (MLOps özet)
// /admin/status (WF metrikleri, champion yaşı) + /admin/drift (PSI + kalibrasyon).
// =============================================================================
import { useEffect, useState } from 'react'
import { ADMIN, adminFetch } from '../../lib/api'

interface AdminStatus {
  model_loaded: boolean; model_age_hours: number | null
  wf_accuracy: number | null; wf_buy_accuracy: number | null; wf_n_predictions: number | null
  champion?: { trained_at?: string; n_rows?: number; buy_threshold?: number }
}
interface DriftResp {
  status: string; message?: string
  drift?: { status: string; message?: string; n_live?: number }
  calibration?: { status: string; message?: string; ece?: number | null; n_evaluated?: number }
}

function dotFor(status?: string): string {
  if (!status || ['NO_DATA', 'COLLECTING'].includes(status)) return 't-dot--muted'
  if (status === 'OK') return 't-dot--ok'
  return 't-dot--warn'
}

export function ModelHealth() {
  const [st, setSt] = useState<AdminStatus | null>(null)
  const [dr, setDr] = useState<DriftResp | null>(null)

  useEffect(() => {
    let stop = false
    const load = () => {
      adminFetch(`${ADMIN}/status`).then(r => r.ok ? r.json() : null)
        .then(d => { if (!stop && d) setSt(d) }).catch(() => {})
      adminFetch(`${ADMIN}/drift`).then(r => r.ok ? r.json() : null)
        .then(d => { if (!stop && d) setDr(d) }).catch(() => {})
    }
    load()
    const t = setInterval(load, 180_000)
    return () => { stop = true; clearInterval(t) }
  }, [])

  const ageDays = st?.model_age_hours != null ? (st.model_age_hours / 24) : null

  return (
    <section className="t-panel t-area-health" aria-label="Model sağlığı">
      <div className="t-panel__head">
        <span className="t-panel__title">Model Sağlığı · MLOps</span>
        <span className="t-panel__meta">
          <span className={`t-dot ${st?.model_loaded ? 't-dot--ok' : 't-dot--warn'}`} />
          {st?.model_loaded ? 'Champion aktif' : 'Model yok'}
        </span>
      </div>
      <div className="t-panel__body">
        <dl className="t-kv t-num">
          <dt>WF yön doğruluğu</dt>
          <dd>{st?.wf_accuracy != null ? `%${(st.wf_accuracy * 100).toFixed(1)}` : '—'}</dd>

          <dt>WF AL-precision</dt>
          <dd style={{ fontWeight: 700 }}>{st?.wf_buy_accuracy != null ? `%${(st.wf_buy_accuracy * 100).toFixed(1)}` : '—'}</dd>

          <dt>OOS örneklem</dt>
          <dd>{st?.wf_n_predictions?.toLocaleString('tr-TR') ?? '—'}</dd>

          <dt>Champion yaşı</dt>
          <dd>{ageDays != null ? `${ageDays.toFixed(1)} gün` : '—'}</dd>

          <dt>Veri kayması (PSI)</dt>
          <dd title={dr?.drift?.message ?? ''}>
            <span className={`t-dot ${dotFor(dr?.drift?.status)}`} />
            {dr?.drift?.status === 'COLLECTING' ? `birikiyor (${dr.drift.n_live ?? 0})` : dr?.drift?.status ?? '—'}
          </dd>

          <dt>Kalibrasyon (ECE)</dt>
          <dd title={dr?.calibration?.message ?? ''}>
            <span className={`t-dot ${dotFor(dr?.calibration?.status)}`} />
            {dr?.calibration?.status === 'COLLECTING'
              ? `birikiyor (${dr.calibration.n_evaluated ?? 0}/30)`
              : dr?.calibration?.ece != null ? dr.calibration.ece.toFixed(3) : dr?.calibration?.status ?? '—'}
          </dd>
        </dl>

        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border-subtle)', fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          Öğrenme yalnızca korumalı promosyonla (Pazar 20:00, 3-pencere kuralı).
          Drift uyarısı otomatik retrain <b>tetiklemez</b>.
        </div>
      </div>
    </section>
  )
}
