// =============================================================================
// Terminal — Duyarlılık Radarı (NLP korku/açgözlülük)
// /api/signals/aggregate: piyasa ruh hali göstergesi + varlık bazlı diverging
// sentiment barları + jeopolitik risk sayacı. 48 saat, zaman-decay ağırlıklı.
// =============================================================================
import { useEffect, useState } from 'react'
import { API } from '../../lib/api'

interface AggRow {
  entity: string
  assetType: string
  score: number          // decay-ağırlıklı sentiment [-1, +1]
  count: number
  geoCount: number
  noveltyScore: number   // yenilik×decay ağırlıklı (tekrar haber şişirmez)
  meanNovelty: number
  positiveEvents: number
  negativeEvents: number
}

const MARKET_ENTITIES = ['BIST100', 'GLOBAL']

function moodLabel(mood: number): { text: string; cls: string } {
  if (mood <= 25) return { text: 'AŞIRI KORKU', cls: 't-down' }
  if (mood <= 42) return { text: 'KORKU', cls: 't-down' }
  if (mood < 58)  return { text: 'NÖTR', cls: 't-flat' }
  if (mood < 75)  return { text: 'İYİMSER', cls: 't-up' }
  return { text: 'AÇGÖZLÜLÜK', cls: 't-up' }
}

export function SentimentRadar() {
  const [rows, setRows] = useState<AggRow[]>([])
  const [err, setErr] = useState(false)

  useEffect(() => {
    let stop = false
    const load = () =>
      fetch(`${API}/signals/aggregate?hours=48`)
        .then(r => r.ok ? r.json() : Promise.reject())
        .then((d: AggRow[]) => { if (!stop) { setRows(d); setErr(false) } })
        .catch(() => { if (!stop) setErr(true) })
    load()
    const t = setInterval(load, 120_000)
    return () => { stop = true; clearInterval(t) }
  }, [])

  // Piyasa ruh hali: BIST100+GLOBAL yenilik-ağırlıklı skor ortalaması → 0-100
  const marketRows = rows.filter(r => MARKET_ENTITIES.includes(r.entity))
  const rawMood = marketRows.length
    ? marketRows.reduce((s, r) => s + (r.noveltyScore || r.score), 0) / marketRows.length
    : 0
  const mood = Math.round(((rawMood + 1) / 2) * 100)
  const { text: moodText, cls: moodCls } = moodLabel(mood)
  const geoTotal = rows.reduce((s, r) => s + r.geoCount, 0)
  const newsTotal = rows.reduce((s, r) => s + r.count, 0)

  // En haber-yoğun varlıklar (piyasa geneli hariç, BIST öncelikli)
  const top = rows
    .filter(r => !MARKET_ENTITIES.includes(r.entity) && r.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)

  return (
    <section className="t-panel t-area-sentiment" aria-label="Piyasa duyarlılık radarı">
      <div className="t-panel__head">
        <span className="t-panel__title">Duyarlılık Radarı · 48s</span>
        <span className="t-panel__meta t-num">{newsTotal} haber · {geoTotal} jeopolitik</span>
      </div>
      <div className="t-panel__body">
        {err && <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Haber akışına ulaşılamadı.</div>}

        {/* Korku/Açgözlülük göstergesi */}
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
            <span style={{ fontSize: 10.5, color: 'var(--text-muted)', letterSpacing: '0.06em' }}>PİYASA RUH HALİ</span>
            <span className={`t-num ${moodCls}`} style={{ fontSize: 15, fontWeight: 800 }}>
              {mood} <span style={{ fontSize: 10, fontWeight: 700 }}>{moodText}</span>
            </span>
          </div>
          <div className="t-gauge" role="img" aria-label={`Piyasa ruh hali ${mood}/100 — ${moodText}`}>
            <div className="t-gauge__needle" style={{ left: `calc(${mood}% - 1px)` }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--text-disabled)', marginTop: 3 }}>
            <span>KORKU</span><span>NÖTR</span><span>AÇGÖZLÜLÜK</span>
          </div>
        </div>

        {/* Varlık bazlı diverging sentiment (yenilik-ağırlıklı) */}
        <div>
          {top.map(r => {
            const v = Math.max(-1, Math.min(1, r.noveltyScore || r.score))
            const half = Math.abs(v) * 50
            const pos = v >= 0
            return (
              <div key={r.entity} className="t-sentrow">
                <span style={{ fontWeight: 700, fontSize: 10.5, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {r.entity}
                  {r.geoCount > 0 && <span title="jeopolitik haber içeriyor" style={{ color: 'var(--loss)' }}> ⚑</span>}
                </span>
                <div className="t-sentbar">
                  <div className="t-sentbar__center" />
                  <div className="t-sentbar__fill" style={{
                    left: pos ? '50%' : `${50 - half}%`,
                    width: `${half}%`,
                    background: pos ? 'var(--profit-soft)' : 'var(--loss-soft)',
                  }} />
                </div>
                <span className={`t-num ${pos ? 't-up' : 't-down'}`} style={{ textAlign: 'right', fontSize: 11 }}>
                  {v >= 0 ? '+' : ''}{v.toFixed(2)}
                </span>
              </div>
            )
          })}
          {top.length === 0 && !err && (
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Varlık bazlı haber birikiyor…</div>
          )}
        </div>
      </div>
    </section>
  )
}
