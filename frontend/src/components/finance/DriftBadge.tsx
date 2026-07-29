import { useEffect, useState } from 'react'

interface DriftPayload {
  // Faz 4 (07/2026) PSI formatı: OK | WATCH | DRIFT | COLLECTING | NO_DATA | ERROR
  // Eski format: OK | WARN | DRIFT | UNKNOWN — ikisi de desteklenir.
  status: string
  score?: number | null        // eski format: Z-score skoru (ortalama |z|)
  n_high_z?: number            // |z|>2 feature sayısı
  n_features?: number
  n_recent_rows?: number
  model_age_hours?: number | null
  top_drifted?: Array<{
    feature: string
    z_score?: number           // eski format: z-score
    drift_pct?: number         // daha eski format: %
    train_mean?: number
    curr_mean?: number
  }>
  thresholds?: { warn: number; drift: number; high_z?: number }
  metric?: string              // 'z_score' eski formatta
  computed_at?: string
  message?: string
  error?: string
  // Faz 4 PSI raporu (iç içe)
  drift?: {
    status: string
    message?: string
    n_live?: number
    n_live_days?: number        // bağımsız gün sayısı (asıl bağlayıcı kısıt)
    min_rows?: number
    min_days?: number
    top_drifted?: Array<{ feature: string; psi: number; status: string }>
  }
  calibration?: { status: string; message?: string; ece?: number | null }
}

type StyleKey = 'OK' | 'WARN' | 'DRIFT' | 'UNKNOWN' | 'COLLECTING'
const STYLE: Record<StyleKey, { color: string; bg: string; border: string; label: string; icon: string }> = {
  OK:         { color: 'var(--profit)',  bg: 'var(--profit-bg)',  border: 'var(--profit-border)',  label: 'Model Sağlıklı', icon: '✓' },
  WARN:       { color: 'var(--warning)', bg: 'var(--warning-bg)', border: 'var(--warning-border)', label: 'Hafif Drift',    icon: '!' },
  DRIFT:      { color: 'var(--loss)',    bg: 'var(--loss-bg)',    border: 'var(--loss-border)',    label: 'Drift Tespit',   icon: '⚠' },
  COLLECTING: { color: 'var(--text-muted)', bg: 'var(--tint-2)', border: 'var(--border-default)', label: 'Veri Birikiyor', icon: '◔' },
  UNKNOWN:    { color: 'var(--text-muted)', bg: 'var(--tint-2)', border: 'var(--border-default)', label: 'Drift Bilinmiyor', icon: '?' },
}

/** Eski (OK/WARN/DRIFT/UNKNOWN) ve yeni PSI (WATCH/COLLECTING/NO_DATA/ERROR) durumlarını stile eşler. */
function normalizeStatus(raw: string | undefined): StyleKey {
  switch (raw) {
    case 'OK': return 'OK'
    case 'DRIFT': return 'DRIFT'
    case 'WARN':
    case 'WATCH': return 'WARN'
    case 'COLLECTING': return 'COLLECTING'
    default: return 'UNKNOWN'
  }
}

export function DriftBadge({
  apiBase,
  adminFetch,
  compact = false,
}: {
  apiBase: string
  adminFetch: (url: string, init?: RequestInit) => Promise<Response>
  compact?: boolean
}) {
  const [data, setData]   = useState<DriftPayload | null>(null)
  const [open, setOpen]   = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = () => {
      adminFetch(`${apiBase}/admin/oracle/drift`)
        .then(r => r.json())
        .then((j: DriftPayload) => { if (!cancelled) setData(j) })
        .catch(e => { if (!cancelled) setError(String(e)) })
    }
    load()
    const id = setInterval(load, 60_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [apiBase, adminFetch])

  if (error || !data) return null
  const status = normalizeStatus(data.status)
  const s = STYLE[status] ?? STYLE.UNKNOWN
  const isZScore = data.metric === 'z_score'
  // Z-score formatı: "1.42σ" — yorumlanabilir (1σ = normal varyasyon, 2σ = anlamlı kayma)
  // Eski rölatif formatı (%) hâlâ destekleniyor (geriye uyum için)
  // COLLECTING'te BAĞLAYICI kısıt gösterilir: satır kapısı dolmuş olsa da gün
  // kapısı dolmadıysa gün yazılır (07/2026: "600/200" tamamlanmış izlenimi veriyordu).
  const dInfo = data.drift
  const scoreTxt = data.score != null
    ? (isZScore ? `${data.score.toFixed(2)}σ` : `${(data.score * 100).toFixed(1)}%`)
    : status === 'COLLECTING' && dInfo
      ? (dInfo.min_days != null && (dInfo.n_live_days ?? 0) < dInfo.min_days
          ? `${dInfo.n_live_days ?? 0}/${dInfo.min_days} gün`
          : dInfo.min_rows != null && (dInfo.n_live ?? 0) < dInfo.min_rows
            ? `${dInfo.n_live ?? 0}/${dInfo.min_rows} satır`
            : '…')
      : '—'

  // Faz 4 PSI raporundaki top_drifted'ı eski görünüm formatına köprüle
  const topDrifted = data.top_drifted
    ?? data.drift?.top_drifted?.map(f => ({ feature: f.feature, z_score: undefined, drift_pct: f.psi * 100 }))
    ?? []

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setOpen(o => !o)}
        title="Model dağılım kayma (drift) durumu"
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: compact ? '3px 8px' : '4px 10px',
          background: s.bg, border: `1px solid ${s.border}`, color: s.color,
          borderRadius: 'var(--radius-full)', cursor: 'pointer',
          fontSize: 'var(--text-xs)', fontWeight: 700,
          lineHeight: 1.1,
        }}
      >
        <span>{s.icon}</span>
        {!compact && <span>{s.label}</span>}
        <span style={{ opacity: 0.85 }}>{scoreTxt}</span>
      </button>

      {open && (
        <>
          {/* dış tıklama kapatma */}
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 90 }} />
          <div style={{
            position: 'absolute', top: 'calc(100% + 6px)', right: 0,
            background: 'var(--bg-surface)', border: '1px solid var(--border-strong)',
            borderRadius: 'var(--radius-md)', padding: 'var(--space-4)',
            minWidth: 320, boxShadow: 'var(--shadow-lg)', zIndex: 100,
            color: 'var(--text-primary)', fontSize: 'var(--text-sm)',
          }}>
            <div style={{ fontWeight: 700, marginBottom: 8, color: s.color }}>
              {s.icon} {s.label} — Skor {scoreTxt}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 10, rowGap: 4,
                          fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginBottom: 10 }}>
              {data.n_features != null && (<><span style={{ color: 'var(--text-muted)' }}>Feature:</span><span>{data.n_features}</span></>)}
              {data.n_recent_rows != null && (<><span style={{ color: 'var(--text-muted)' }}>Son satır:</span><span>{data.n_recent_rows}</span></>)}
              {data.model_age_hours != null && (<><span style={{ color: 'var(--text-muted)' }}>Model yaşı:</span><span>{data.model_age_hours} sa</span></>)}
              {data.thresholds && (
                <><span style={{ color: 'var(--text-muted)' }}>Eşik:</span>
                  <span>
                    {isZScore
                      ? `uyarı ${data.thresholds.warn}σ, kritik ${data.thresholds.drift}σ`
                      : `uyarı %${data.thresholds.warn * 100}, kritik %${data.thresholds.drift * 100}`}
                  </span></>
              )}
              {isZScore && data.n_high_z != null && (
                <><span style={{ color: 'var(--text-muted)' }}>|z|&gt;2:</span>
                  <span>{data.n_high_z} feature</span></>
              )}
            </div>

            {topDrifted.length > 0 ? (
              <>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
                              textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700, marginBottom: 6 }}>
                  En çok kayan feature
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {topDrifted.map(f => {
                    // Yeni format: z_score (σ olarak); eski format: drift_pct (% olarak)
                    const useZ = f.z_score != null
                    const val = useZ ? f.z_score! : (f.drift_pct ?? 0)
                    const warnLvl  = useZ ? 1.0 : 10
                    const critLvl  = useZ ? 2.0 : 20
                    const display  = useZ ? `${val.toFixed(2)}σ` : `${val.toFixed(1)}%`
                    return (
                      <div key={f.feature} style={{ display: 'flex', justifyContent: 'space-between',
                                                    fontSize: 'var(--text-xs)', fontFamily: 'monospace' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>{f.feature}</span>
                        <span style={{ color: val > critLvl ? 'var(--loss)'
                                            : val > warnLvl ? 'var(--warning)'
                                                            : 'var(--text-muted)',
                                       fontWeight: 700 }}>
                          {display}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </>
            ) : (
              data.message && <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>{data.message}</div>
            )}

            {data.computed_at && (
              <div style={{ marginTop: 10, fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                {new Date(data.computed_at).toLocaleString('tr-TR')}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default DriftBadge
