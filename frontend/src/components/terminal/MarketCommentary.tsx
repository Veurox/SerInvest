// =============================================================================
// Terminal — Piyasa Yorumu (kural-bazlı yerel sentez, oracle /admin/commentary)
// Manşet + yön duruşu + konu paragrafları + sürücü/risk listeleri.
// Harici LLM yok: rejim + genişlik/hacim + haber olayları + AI sinyal özeti.
// =============================================================================
import { useEffect, useState } from 'react'
import { ADMIN, adminFetch } from '../../lib/api'

interface Commentary {
  generated_at: string
  headline: string
  stance: { direction: 'YUKARI' | 'YATAY' | 'AŞAĞI'; confidence: string; score: number; horizon: string }
  paragraphs: Array<{ topic: string; text: string }>
  drivers: string[]
  risks: string[]
  disclaimer: string
  error?: string
}

const DIR_STYLE: Record<string, { cls: string; icon: string }> = {
  'YUKARI': { cls: 't-up', icon: '▲' },
  'AŞAĞI':  { cls: 't-down', icon: '▼' },
  'YATAY':  { cls: 't-flat', icon: '◆' },
}

export function MarketCommentary() {
  const [data, setData] = useState<Commentary | null>(null)
  const [err, setErr] = useState(false)

  useEffect(() => {
    let stop = false
    const load = () =>
      adminFetch(`${ADMIN}/commentary`)
        .then(r => r.ok ? r.json() : Promise.reject())
        .then((d: Commentary) => { if (!stop) { d.error ? setErr(true) : setData(d); } })
        .catch(() => { if (!stop) setErr(true) })
    load()
    const t = setInterval(load, 5 * 60_000)
    return () => { stop = true; clearInterval(t) }
  }, [])

  const dir = data ? DIR_STYLE[data.stance.direction] ?? DIR_STYLE['YATAY'] : null

  return (
    <section className="t-panel t-area-commentary" aria-label="Otomatik piyasa yorumu">
      <div className="t-panel__head">
        <span className="t-panel__title">Piyasa Yorumu · Otomatik Sentez</span>
        <span className="t-panel__meta t-num">
          {data && new Date(data.generated_at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
          {data && <span style={{ marginLeft: 8, color: 'var(--text-disabled)' }}>ufuk: {data.stance.horizon}</span>}
        </span>
      </div>
      <div className="t-panel__body">
        {err && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Yorum motoruna ulaşılamadı.</div>}
        {!data && !err && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Yorum üretiliyor…</div>}
        {data && dir && (
          <>
            {/* Manşet + yön rozeti */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
              <span className={`t-num ${dir.cls}`}
                    style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.2, flexShrink: 0 }}
                    title={`Duruş skoru: ${data.stance.score}`}>
                {dir.icon} {data.stance.direction}
                <span style={{ display: 'block', fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textAlign: 'center' }}>
                  {data.stance.confidence.toUpperCase()} GÜVEN
                </span>
              </span>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600, lineHeight: 1.45, color: 'var(--text-primary)' }}>
                {data.headline}
              </p>
            </div>

            {/* Konu paragrafları — terminal yoğunluğunda çok kolonlu */}
            <div className="t-commentary__cols">
              {data.paragraphs.map(p => (
                <div key={p.topic} className="t-commentary__block">
                  <div className="t-commentary__topic">{p.topic}</div>
                  <p className="t-commentary__text">{p.text}</p>
                </div>
              ))}
            </div>

            {/* Sürücüler & Riskler */}
            {(data.drivers.length > 0 || data.risks.length > 0) && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 0', marginTop: 8 }}>
                {data.drivers.map((d, i) => <span key={`d${i}`} className="t-chip t-chip--pos">▲ {d}</span>)}
                {data.risks.map((r, i) => <span key={`r${i}`} className="t-chip t-chip--neg">▼ {r}</span>)}
              </div>
            )}

            <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px solid var(--border-subtle)',
                          fontSize: 9.5, color: 'var(--text-disabled)' }}>
              {data.disclaimer}
            </div>
          </>
        )}
      </div>
    </section>
  )
}
