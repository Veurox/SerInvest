// =============================================================================
// SerInvest — Zamanlanmış İşler
// "Bugünkü değerlendirme yapıldı mı? Pazar eğitimi çalıştı mı?" sorusunun
// tek bakışta cevabı. Bilgisayar kapalıyken kaçan işler açılışta telafi edilir;
// bu panel hem son çalışma zamanını hem telafi güvencesini gösterir.
// =============================================================================
import { useEffect, useState } from 'react'
import { ADMIN, adminFetch } from '../../lib/api'

interface Job {
  id: string; name: string; schedule: string; description: string
  last_run: string | null; age_hours: number | null
  overdue_after_hours: number | null
  status: 'ok' | 'overdue' | 'never' | 'manual'
  catchup: boolean
}
interface JobsResp { now: string; jobs: Job[]; note?: string; error?: string }

const STATE: Record<Job['status'], { icon: string; label: string; fg: string; bg: string; bd: string }> = {
  ok:      { icon: '✓', label: 'güncel',      fg: 'var(--profit)',     bg: 'var(--profit-bg)',  bd: 'var(--profit-border)' },
  overdue: { icon: '!', label: 'gecikmiş',    fg: 'var(--warning)',    bg: 'var(--warning-bg)', bd: 'var(--warning-border)' },
  never:   { icon: '–', label: 'hiç çalışmadı', fg: 'var(--loss)',     bg: 'var(--loss-bg)',    bd: 'var(--loss-border)' },
  manual:  { icon: '⋯', label: 'elle',        fg: 'var(--text-muted)', bg: 'var(--bg-surface-2)', bd: 'var(--border-default)' },
}

/** "2 saat önce" / "3 gün önce" — ham saat sayısı yerine okunur ifade. */
function agoLabel(h: number | null): string {
  if (h == null) return 'hiç çalışmadı'
  if (h < 1)  return `${Math.round(h * 60)} dakika önce`
  if (h < 48) return `${h.toFixed(h < 10 ? 1 : 0)} saat önce`
  return `${Math.round(h / 24)} gün önce`
}

export function JobStatus() {
  const [d, setD]     = useState<JobsResp | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const load = () =>
      adminFetch(`${ADMIN}/jobs`)
        .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
        .then((j: JobsResp) => j.error ? setErr(j.error) : (setD(j), setErr(null)))
        .catch(e => setErr(String(e)))
    load()
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [])

  if (err) return <div className="card" style={{ padding: 14, fontSize: 13, color: 'var(--text-muted)' }}>İş durumu alınamadı: {err}</div>
  if (!d)  return <div className="card" style={{ padding: 14, fontSize: 13, color: 'var(--text-muted)' }}>İş durumu yükleniyor…</div>

  const late = d.jobs.filter(j => j.status === 'overdue' || j.status === 'never').length

  return (
    <div className="card" style={{ padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em',
                       textTransform: 'uppercase', color: 'var(--text-muted)' }}>
          Zamanlanmış işler
        </span>
        <span style={{ fontSize: 12, color: late ? 'var(--warning)' : 'var(--profit)', fontWeight: 600 }}>
          {late === 0 ? '✓ hepsi güncel' : `! ${late} iş gecikmiş`}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(270px, 1fr))', gap: 8 }}>
        {d.jobs.map(j => {
          const s = STATE[j.status] ?? STATE.manual
          return (
            <div key={j.id} title={j.description}
                 style={{ padding: '9px 11px', borderRadius: 5,
                          background: s.bg, border: `1px solid ${s.bd}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ fontWeight: 800, color: s.fg, fontSize: 13 }}>{s.icon}</span>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{j.name}</span>
                <span style={{ marginLeft: 'auto', fontSize: 10.5, fontWeight: 700, color: s.fg }}>
                  {s.label}
                </span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 3,
                            fontVariantNumeric: 'tabular-nums' }}>
                Son çalışma: <b>{agoLabel(j.age_hours)}</b>
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 1 }}>
                Program: {j.schedule}
                {j.catchup && <span style={{ color: 'var(--profit)' }}> · kaçarsa telafi edilir</span>}
              </div>
            </div>
          )
        })}
      </div>

      {d.note && (
        <div style={{ marginTop: 9, paddingTop: 8, borderTop: '1px solid var(--border-subtle)',
                      fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1.55 }}>
          {d.note}
        </div>
      )}
    </div>
  )
}
