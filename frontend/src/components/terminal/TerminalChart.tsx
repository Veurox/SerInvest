// =============================================================================
// Terminal — Ana Grafik: Gerçek Fiyat vs AI Hedef/Stop Bariyerleri
// Tek eksen, tek seri (kapanış) + Oracle'ın triple-barrier seviyeleri referans
// çizgisi olarak. Crosshair tooltip; grid geri planda (dataviz disiplinine uygun).
// =============================================================================
import { useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer, ComposedChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts'
import { API } from '../../lib/api'
import type { OracleAnalysis } from '../../lib/types'

interface ChartPoint { t: number; c: number }
interface ChartPayload { symbol: string; points: ChartPoint[]; error?: string }

interface Props {
  symbol: string
  analysis: OracleAnalysis | null
}

const TIMEFRAMES = ['1M', '3M', '1Y'] as const
type TF = typeof TIMEFRAMES[number]

const px = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
// t = epoch MİLİSANİYE (market-data chart API'si)
const dt = (t: number) => new Date(t).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' })

export function TerminalChart({ symbol, analysis }: Props) {
  const [tf, setTf] = useState<TF>('3M')
  const [points, setPoints] = useState<ChartPoint[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let stop = false
    setLoading(true); setErr(null)
    fetch(`${API}/market/${encodeURIComponent(symbol)}/chart?tf=${tf}`)
      .then(r => r.json())
      .then((j: ChartPayload) => {
        if (stop) return
        if (j.error || !j.points?.length) { setErr(j.error || 'veri yok'); setPoints([]) }
        // Kronolojik garanti — API sırasına güvenme (eksen sayısal/zaman ölçekli)
        else setPoints(j.points.filter(p => p.c != null).sort((a, b) => a.t - b.t))
      })
      .catch(e => { if (!stop) setErr(String(e)) })
      .finally(() => { if (!stop) setLoading(false) })
    return () => { stop = true }
  }, [symbol, tf])

  const isBuy = !!analysis && analysis.recommendation.includes('ALIM')
  const target = isBuy ? analysis?.shortTermTarget ?? null : null
  const stopPx = isBuy ? analysis?.shortTermStop ?? null : null
  const entry  = analysis?.priceAtAnalysis ?? null

  const last = points.length ? points[points.length - 1].c : null
  const first = points.length ? points[0].c : null
  const chgPct = last != null && first ? ((last - first) / first) * 100 : null

  // Y ekseni: seri + bariyer seviyelerini kapsasın, %2 nefes payı
  const yDomain = useMemo((): [number, number] | undefined => {
    if (!points.length) return undefined
    const vals = points.map(p => p.c)
    if (target != null) vals.push(target)
    if (stopPx != null) vals.push(stopPx)
    const lo = Math.min(...vals), hi = Math.max(...vals)
    const pad = (hi - lo) * 0.04 || hi * 0.01
    return [lo - pad, hi + pad]
  }, [points, target, stopPx])

  return (
    <section className="t-panel t-area-chart" aria-label="Fiyat ve yapay zeka bariyer grafiği">
      <div className="t-panel__head">
        <span className="t-panel__title">
          {symbol} · Fiyat vs AI Bariyerleri
          {chgPct != null && (
            <span className={`t-num ${chgPct >= 0 ? 't-up' : 't-down'}`} style={{ marginLeft: 8, textTransform: 'none', letterSpacing: 0 }}>
              {chgPct >= 0 ? '+' : ''}{chgPct.toFixed(2)}%
            </span>
          )}
        </span>
        <span style={{ display: 'inline-flex', gap: 2 }}>
          {TIMEFRAMES.map(t => (
            <button key={t} onClick={() => setTf(t)}
              style={{
                fontSize: 10, fontWeight: 700, padding: '2px 8px', cursor: 'pointer',
                borderRadius: 2, border: '1px solid',
                borderColor: tf === t ? 'var(--accent-border)' : 'transparent',
                background: tf === t ? 'var(--accent-bg)' : 'transparent',
                color: tf === t ? 'var(--accent)' : 'var(--text-muted)',
              }}>{t}</button>
          ))}
        </span>
      </div>

      <div className="t-panel__body t-panel__body--flush" style={{ minHeight: 380, position: 'relative' }}>
        {(loading || err) && (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
                        fontSize: 12, color: 'var(--text-muted)', zIndex: 1 }}>
            {loading ? 'Grafik yükleniyor…' : `Grafik alınamadı (${err})`}
          </div>
        )}
        {points.length > 0 && (
          <ResponsiveContainer width="100%" height={420}>
            <ComposedChart data={points} margin={{ top: 14, right: 58, bottom: 4, left: 4 }}>
              <defs>
                <linearGradient id="tPriceFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--info)" stopOpacity={0.22} />
                  <stop offset="100%" stopColor="var(--info)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--border-subtle)" vertical={false} />
              <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']}
                     tickFormatter={dt} minTickGap={48}
                     tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                     axisLine={{ stroke: 'var(--border-default)' }} tickLine={false} />
              <YAxis domain={yDomain} orientation="right" width={54}
                     tickFormatter={(v: number) => px.format(v)}
                     tick={{ fontSize: 10, fill: 'var(--text-muted)', fontFamily: 'var(--t-mono)' }}
                     axisLine={false} tickLine={false} />
              <Tooltip
                cursor={{ stroke: 'var(--border-strong)', strokeDasharray: '3 3' }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const p = payload[0].payload as ChartPoint
                  return (
                    <div style={{
                      background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
                      borderRadius: 3, padding: '6px 10px', fontSize: 11.5, boxShadow: 'var(--shadow-md, 0 4px 12px rgba(0,0,0,.25))',
                    }}>
                      <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>
                        {new Date(p.t).toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' })}
                      </div>
                      <div className="t-num" style={{ fontWeight: 700, fontSize: 13 }}>₺{px.format(p.c)}</div>
                    </div>
                  )
                }}
              />
              {/* Kapanış serisi — tek seri, legend gerekmez (başlık adlandırıyor) */}
              <Area type="monotone" dataKey="c" stroke="var(--info)" strokeWidth={2}
                    fill="url(#tPriceFill)" dot={false} isAnimationActive={false}
                    activeDot={{ r: 3.5, fill: 'var(--info)', stroke: 'var(--bg-surface)', strokeWidth: 2 }} />

              {/* Oracle triple-barrier seviyeleri (eğitimle aynı tanım) */}
              {target != null && (
                <ReferenceLine y={target} stroke="var(--profit)" strokeDasharray="5 3" strokeWidth={1.5}
                  label={{ value: `HEDEF ${px.format(target)}`, position: 'insideTopRight',
                           fontSize: 9.5, fontWeight: 700, fill: 'var(--profit)' }} />
              )}
              {stopPx != null && (
                <ReferenceLine y={stopPx} stroke="var(--loss)" strokeDasharray="5 3" strokeWidth={1.5}
                  label={{ value: `STOP ${px.format(stopPx)}`, position: 'insideBottomRight',
                           fontSize: 9.5, fontWeight: 700, fill: 'var(--loss)' }} />
              )}
              {entry != null && isBuy && (
                <ReferenceLine y={entry} stroke="var(--text-disabled)" strokeDasharray="2 4" strokeWidth={1}
                  label={{ value: `ANALİZ ${px.format(entry)}`, position: 'insideRight',
                           fontSize: 9, fill: 'var(--text-muted)' }} />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      <div style={{ padding: '5px 10px', borderTop: '1px solid var(--border-subtle)',
                    fontSize: 10, color: 'var(--text-muted)', display: 'flex', gap: 14 }}>
        <span><span className="t-dot" style={{ background: 'var(--info)' }} /> Kapanış</span>
        {target != null && <span className="t-up">— — Hedef (TP = 3×ATR)</span>}
        {stopPx != null && <span className="t-down">— — Stop (SL = 2×ATR)</span>}
        <span style={{ marginLeft: 'auto' }}>10g triple-barrier · eğitimle aynı tanım</span>
      </div>
    </section>
  )
}
