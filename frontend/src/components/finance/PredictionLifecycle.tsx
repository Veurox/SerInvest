// =============================================================================
// SerInvest — Tahmin Yaşam Döngüsü
// "Model tahmin edip bırakıyor mu?" sorusunun görsel cevabı.
//
// Her tahmin günü bir KOHORT: o gün kurulan bahisler, 10 işlem günlük
// triple-barrier penceresi kapandıktan (≈20 takvim günü) sonra topluca yargılanır.
//   • Olgunlaşma Hattı — "fırında ne var, ne zaman çıkacak"
//   • Ay Takvimi       — "geçmişte hangi gün ne kadar isabet"
// =============================================================================
import { useEffect, useMemo, useState } from 'react'
import { ADMIN, adminFetch } from '../../lib/api'

export interface CohortDay {
  date: string
  total: number; buy: number
  evaluated: number; pending: number
  up: number; down: number; neutral: number
  buy_correct: number; buy_decided: number
  hit_rate: number | null
  avg_return: number | null
  verdict_date: string
  verdict_at: string          // hüküm anı (ISO, dakika hassasiyeti)
  age_days: number; days_left: number; hours_left: number
  matured: boolean; progress: number
}

/** Kalan süre etiketi — 48 saatin altında saat, üstünde gün. */
function leftLabel(d: CohortDay): string {
  if (d.matured) return 'olgun'
  if (d.hours_left < 48) return `${d.hours_left.toFixed(d.hours_left < 10 ? 1 : 0)} saat`
  return `${d.days_left} gün`
}
interface CalendarPayload {
  horizon_days: number
  today: string
  days: CohortDay[]
  summary: {
    total: number; evaluated: number; pending: number; ripening: number
    matured_total: number; buy_decided: number; buy_correct: number
    hit_rate: number | null
    next_verdict: string | null; next_verdict_n: number
  }
  error?: string
}

const AY = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık']
const GUN = ['Pzt','Sal','Çar','Per','Cum','Cmt','Paz']

const dLabel = (iso: string) => {
  const d = new Date(iso + 'T00:00:00')
  return `${d.getDate()} ${AY[d.getMonth()].slice(0, 3)}`
}

/** İsabet oranına göre hücre tonu — yeşil (iyi) ↔ kırmızı (kötü). */
function hitTint(hit: number | null): { bg: string; fg: string } {
  if (hit == null) return { bg: 'transparent', fg: 'var(--text-secondary)' }
  if (hit >= 0.60) return { bg: 'var(--profit-bg)', fg: 'var(--profit)' }
  if (hit >= 0.45) return { bg: 'var(--warning-bg)', fg: 'var(--warning)' }
  return { bg: 'var(--loss-bg)', fg: 'var(--loss)' }
}

export function PredictionLifecycle({ onPickDay }: { onPickDay?: (date: string) => void }) {
  const [data, setData]   = useState<CalendarPayload | null>(null)
  const [err, setErr]     = useState<string | null>(null)
  const [busy, setBusy]   = useState(false)
  const [msg, setMsg]     = useState('')
  const [monthOff, setMonthOff] = useState(0)   // 0 = içinde bulunulan ay
  const [sel, setSel]     = useState<string | null>(null)

  const load = () =>
    adminFetch(`${ADMIN}/prediction-calendar`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((d: CalendarPayload) => { d.error ? setErr(d.error) : (setData(d), setErr(null)) })
      .catch(e => setErr(String(e)))

  useEffect(() => {
    load()
    const t = setInterval(load, 120_000)
    return () => clearInterval(t)
  }, [])

  const evaluateNow = async () => {
    setBusy(true); setMsg('Olgun tahminler yargılanıyor… (geçmiş fiyatlar indiriliyor)')
    try {
      const r = await adminFetch(`${ADMIN}/evaluate-now`, { method: 'POST' })
      const j = await r.json()
      if (!r.ok) { setMsg(j.error || 'Başlatılamadı'); setBusy(false); return }
      // Sonuç arka planda yazılır — özet değişene dek yokla
      const before = data?.summary.evaluated ?? 0
      let tries = 0
      const poll = setInterval(async () => {
        tries++
        await load()
        const cur = (await adminFetch(`${ADMIN}/prediction-calendar`).then(r => r.json()).catch(() => null))?.summary?.evaluated ?? before
        if (cur > before || tries > 30) {
          clearInterval(poll); setBusy(false)
          setMsg(cur > before ? `✓ ${cur - before} tahmin yargılandı` : 'Değerlendirilecek olgun tahmin bulunamadı')
          setTimeout(() => setMsg(''), 6000)
        }
      }, 10_000)
    } catch (e) { setMsg(String(e)); setBusy(false) }
  }

  const byDate = useMemo(() => {
    const m = new Map<string, CohortDay>()
    data?.days.forEach(d => m.set(d.date, d))
    return m
  }, [data])

  // Takvim ızgarası — Pazartesi başlangıçlı
  const grid = useMemo(() => {
    const base = data ? new Date(data.today + 'T00:00:00') : new Date()
    const cur = new Date(base.getFullYear(), base.getMonth() + monthOff, 1)
    const first = new Date(cur)
    const lead = (first.getDay() + 6) % 7            // Pzt=0
    const cells: (string | null)[] = Array(lead).fill(null)
    const dim = new Date(cur.getFullYear(), cur.getMonth() + 1, 0).getDate()
    for (let i = 1; i <= dim; i++) {
      const d = new Date(cur.getFullYear(), cur.getMonth(), i)
      cells.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`)
    }
    while (cells.length % 7) cells.push(null)
    return { cells, title: `${AY[cur.getMonth()]} ${cur.getFullYear()}` }
  }, [data, monthOff])

  if (err) return (
    <div className="card" style={{ padding: 14, fontSize: 13, color: 'var(--text-muted)' }}>
      Tahmin takvimi alınamadı: {err}
    </div>
  )
  if (!data) return (
    <div className="card" style={{ padding: 14, fontSize: 13, color: 'var(--text-muted)' }}>
      Tahmin yaşam döngüsü yükleniyor…
    </div>
  )

  const s = data.summary
  const ripening = data.days.filter(d => !d.matured).slice(-8)
  const selected = sel ? byDate.get(sel) : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* ── Boru hattı özeti ─────────────────────────────────────────────── */}
      <div className="card" style={{ padding: '12px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
          <strong style={{ fontSize: 14 }}>Tahmin Yaşam Döngüsü</strong>
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
            Her tahmin {data.horizon_days} takvim günü sonra (10 işlem günü) triple-barrier ile yargılanır
          </span>
          <button onClick={evaluateNow} disabled={busy}
            style={{
              marginLeft: 'auto', fontSize: 12, fontWeight: 600, padding: '5px 12px',
              borderRadius: 4, cursor: busy ? 'wait' : 'pointer',
              border: '1px solid var(--accent-border)', background: 'var(--accent-bg)',
              color: 'var(--accent)', opacity: busy ? 0.65 : 1,
            }}>
            {busy ? 'Değerlendiriliyor…' : 'Şimdi değerlendir'}
          </button>
        </div>

        {msg && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>{msg}</div>}

        {/* Huni: kuruldu → fırında → olgun → hüküm */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[
            { k: 'Kuruldu',   v: s.total,          c: 'var(--text-primary)', h: 'toplam tahmin' },
            { k: 'Fırında',   v: s.ripening,       c: 'var(--info)',         h: 'henüz olgunlaşmadı' },
            { k: 'Olgun',     v: s.matured_total,  c: 'var(--accent)',       h: 'yargılanabilir yaşta' },
            { k: 'Yargılandı', v: s.evaluated,     c: 'var(--text-primary)', h: 'hüküm yazıldı' },
            { k: 'İsabet',    v: s.hit_rate != null ? `%${(s.hit_rate * 100).toFixed(0)}` : '—',
              c: s.hit_rate != null && s.hit_rate >= 0.5 ? 'var(--profit)' : 'var(--loss)',
              h: `AL sinyalinde kesin hüküm: ${s.buy_correct}/${s.buy_decided}` },
          ].map(x => (
            <div key={x.k} title={x.h} style={{
              flex: '1 1 110px', minWidth: 100, padding: '7px 10px', borderRadius: 4,
              background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)',
            }}>
              <div style={{ fontSize: 10, letterSpacing: '.06em', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{x.k}</div>
              <div style={{ fontSize: 19, fontWeight: 800, color: x.c, fontVariantNumeric: 'tabular-nums' }}>{x.v}</div>
            </div>
          ))}
        </div>

        {s.next_verdict && (
          <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--text-muted)' }}>
            Sıradaki hasat: <b style={{ color: 'var(--text-secondary)' }}>{dLabel(s.next_verdict)}</b> — {s.next_verdict_n} tahmin
          </div>
        )}
      </div>

      {/* ── Olgunlaşma hattı ─────────────────────────────────────────────── */}
      {ripening.length > 0 && (
        <div className="card" style={{ padding: '12px 14px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase',
                        color: 'var(--text-muted)', marginBottom: 8 }}>
            Olgunlaşma Hattı — fırındakiler
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {ripening.map(d => (
              <div key={d.date} onClick={() => { setSel(d.date); onPickDay?.(d.date) }}
                   style={{ display: 'grid', gridTemplateColumns: '58px 34px 1fr 82px', gap: 8,
                            alignItems: 'center', fontSize: 12, cursor: 'pointer' }}>
                <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>{dLabel(d.date)}</span>
                <span style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{d.total}</span>
                <div style={{ height: 9, borderRadius: 3, background: 'var(--bg-surface-3)', overflow: 'hidden' }}>
                  <div style={{ width: `${d.progress * 100}%`, height: '100%', borderRadius: 3,
                                background: 'linear-gradient(90deg, var(--info), var(--accent))',
                                transition: 'width .5s ease' }} />
                </div>
                <span title={`hüküm: ${d.verdict_at.replace('T', ' ')} UTC`}
                      style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {leftLabel(d)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Ay takvimi ───────────────────────────────────────────────────── */}
      <div className="card" style={{ padding: '12px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
            Tahmin Takvimi
          </span>
          <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 4, alignItems: 'center' }}>
            <button onClick={() => setMonthOff(o => o - 1)} style={navBtn}>‹</button>
            <span style={{ fontSize: 12.5, fontWeight: 700, minWidth: 108, textAlign: 'center' }}>{grid.title}</span>
            <button onClick={() => setMonthOff(o => o + 1)} style={navBtn}>›</button>
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
          {GUN.map(g => (
            <div key={g} style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.06em',
                                  color: 'var(--text-disabled)', textAlign: 'center', paddingBottom: 2 }}>{g}</div>
          ))}
          {grid.cells.map((iso, i) => {
            if (!iso) return <div key={`e${i}`} />
            const c = byDate.get(iso)
            const isToday = iso === data.today
            const tint = hitTint(c?.hit_rate ?? null)
            return (
              <div key={iso}
                   onClick={() => c && (setSel(iso), onPickDay?.(iso))}
                   title={c ? `${c.total} tahmin · hüküm ${dLabel(c.verdict_date)}` : ''}
                   style={{
                     minHeight: 58, padding: '4px 5px', borderRadius: 4,
                     border: `1px solid ${sel === iso ? 'var(--accent)' : isToday ? 'var(--border-strong)' : 'var(--border-subtle)'}`,
                     background: c ? tint.bg : 'transparent',
                     cursor: c ? 'pointer' : 'default',
                     opacity: c ? 1 : 0.45,
                     display: 'flex', flexDirection: 'column', gap: 2,
                   }}>
                <span style={{ fontSize: 10, fontWeight: isToday ? 800 : 600,
                               color: isToday ? 'var(--accent)' : 'var(--text-muted)' }}>
                  {Number(iso.slice(8, 10))}
                </span>
                {c && (
                  <>
                    <span style={{ fontSize: 14, fontWeight: 800, lineHeight: 1,
                                   color: tint.fg, fontVariantNumeric: 'tabular-nums' }}>
                      {c.total}
                    </span>
                    <span style={{ fontSize: 9.5, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                      {c.hit_rate != null
                        ? `✓${(c.hit_rate * 100).toFixed(0)}%`
                        : c.matured ? 'olgun' : c.hours_left < 48 ? `⏳${c.hours_left.toFixed(0)}sa` : `⏳${c.days_left}g`}
                    </span>
                  </>
                )}
              </div>
            )
          })}
        </div>

        {/* Seçili gün özeti */}
        {selected && (
          <div style={{ marginTop: 10, padding: '9px 11px', borderRadius: 4,
                        background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', fontSize: 12 }}>
            <b>{dLabel(selected.date)}</b> — {selected.total} tahmin ({selected.buy} AL sinyali) ·
            hüküm günü <b>{dLabel(selected.verdict_date)}</b>
            {selected.evaluated > 0 ? (
              <div style={{ marginTop: 4, color: 'var(--text-secondary)' }}>
                Yargılandı: {selected.evaluated} · <span className="t-up">hedefe değdi {selected.up}</span> ·{' '}
                <span className="t-down">stopa değdi {selected.down}</span> · kararsız {selected.neutral}
                {selected.hit_rate != null && <> · AL isabeti <b>%{(selected.hit_rate * 100).toFixed(0)}</b></>}
                {selected.avg_return != null && <> · ort. getiri <b>{(selected.avg_return * 100).toFixed(2)}%</b></>}
              </div>
            ) : (
              <div style={{ marginTop: 4, color: 'var(--text-muted)' }}>
                Henüz yargılanmadı — {selected.matured
                  ? 'olgunlaştı, ilk değerlendirme turunda yargılanacak'
                  : <>olgunlaşmasına <b>{leftLabel(selected)}</b> var (hüküm: {selected.verdict_at.replace('T', ' ')} UTC)</>}
              </div>
            )}
          </div>
        )}

        <div style={{ marginTop: 8, fontSize: 10, color: 'var(--text-disabled)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <span>Renk = o günün AL isabeti</span>
          <span style={{ color: 'var(--profit)' }}>■ ≥%60</span>
          <span style={{ color: 'var(--warning)' }}>■ %45-60</span>
          <span style={{ color: 'var(--loss)' }}>■ &lt;%45</span>
          <span>⏳ = hükme kalan gün</span>
        </div>
      </div>
    </div>
  )
}

const navBtn: React.CSSProperties = {
  fontSize: 14, lineHeight: 1, padding: '2px 8px', cursor: 'pointer', borderRadius: 3,
  border: '1px solid var(--border-default)', background: 'var(--bg-surface-2)', color: 'var(--text-secondary)',
}
