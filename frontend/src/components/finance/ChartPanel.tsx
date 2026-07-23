import { useEffect, useMemo, useRef, useState } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────
type Timeframe = '1H' | '1D' | '1W' | '1M' | '3M' | '1Y' | '5Y'

interface ChartPoint {
  t: number
  o: number | null
  h: number | null
  l: number | null
  c: number
  v: number | null
}

interface ChartPayload {
  symbol: string
  tf: Timeframe
  yf?: string
  interval?: string
  period?: string
  points: ChartPoint[]
  first?: number | null
  last?: number | null
  change_pct?: number | null
  fetched_at?: number
  error?: string
}

const TIMEFRAMES: Timeframe[] = ['1H', '1D', '1W', '1M', '3M', '1Y', '5Y']

const TF_LABEL: Record<Timeframe, string> = {
  '1H': '1 Saat', '1D': '1 Gün', '1W': '1 Hafta', '1M': '1 Ay',
  '3M': '3 Ay',   '1Y': '1 Yıl', '5Y': '5 Yıl',
}

// Karşılaştırma serileri için ayırt edici renkler
const COMPARE_COLORS = [
  'var(--info)',
  'var(--accent-soft)',
  'var(--warning)',
  'var(--profit-soft)',
  'var(--loss-soft)',
]
const MAX_COMPARE = 4

// ── Component ─────────────────────────────────────────────────────────────────
export function ChartPanel({
  symbol,
  apiBase,
  decimals = 2,
  availableSymbols = [],
}: {
  symbol: string
  apiBase: string
  decimals?: number
  availableSymbols?: string[]    // karşılaştırma için seçilebilir semboller
}) {
  const [tf, setTf]           = useState<Timeframe>('1D')
  const [data, setData]       = useState<ChartPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const [chartType, setChartType] = useState<'line' | 'candle'>('line')

  // Karşılaştırma
  const [compareList, setCompareList] = useState<string[]>([])
  const [compareData, setCompareData] = useState<Record<string, ChartPayload>>({})
  const [pickerOpen, setPickerOpen]   = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')

  const svgRef = useRef<SVGSVGElement>(null)

  const compareMode = compareList.length > 0

  // Sembol değişince karşılaştırma listesini sıfırla
  useEffect(() => { setCompareList([]); setCompareData({}); setPickerOpen(false) }, [symbol])
  // 5Y'de mum modu desteklenmez (çok sıkışık)
  useEffect(() => { if (tf === '5Y') setChartType('line') }, [tf])

  // Ana seri fetch
  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    fetch(`${apiBase}/market/${encodeURIComponent(symbol)}/chart?tf=${tf}`)
      .then(r => r.json())
      .then((j: ChartPayload) => {
        if (cancelled) return
        if (j.error) { setError(j.error); setData(null) }
        else setData(j)
      })
      .catch(e => { if (!cancelled) setError(String(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [symbol, tf, apiBase])

  // Karşılaştırma serileri fetch
  useEffect(() => {
    let cancelled = false
    const missing = compareList.filter(s => !compareData[`${s}_${tf}`])
    if (missing.length === 0) return
    Promise.all(missing.map(s =>
      fetch(`${apiBase}/market/${encodeURIComponent(s)}/chart?tf=${tf}`)
        .then(r => r.json())
        .then((j: ChartPayload) => ({ key: `${s}_${tf}`, payload: j }))
        .catch(() => null)
    )).then(results => {
      if (cancelled) return
      const next = { ...compareData }
      for (const r of results) if (r) next[r.key] = r.payload
      setCompareData(next)
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compareList, tf, apiBase])

  // TF değişince eski cache'i temizle
  useEffect(() => { setCompareData({}) }, [tf])

  const points = data?.points ?? []
  const hasData = points.length >= 2

  const compareSeries = useMemo(() => {
    return compareList
      .map(s => compareData[`${s}_${tf}`])
      .filter(Boolean)
      .filter(p => p.points && p.points.length >= 2)
  }, [compareList, compareData, tf])

  // ── Skala (normalize % mod) ─────────────────────────────────────────────────
  const W = 760, H = 280
  const PAD_L = compareMode ? 56 : 56, PAD_R = 12, PAD_T = 16, PAD_B = 28

  // Tüm serileri (ana + compare) normalize ederek tek skalada çiz
  const series = useMemo(() => {
    if (!hasData) return [] as Array<{
      symbol: string; color: string; isPrimary: boolean
      points: { t: number; raw: number; norm: number }[]
    }>
    const all = [
      { payload: data!, color: 'var(--info)', isPrimary: true },
      ...compareSeries.map((p, i) => ({
        payload: p, color: COMPARE_COLORS[(i + 1) % COMPARE_COLORS.length], isPrimary: false,
      })),
    ]
    return all.map(({ payload, color, isPrimary }) => {
      const first = payload.points[0]?.c ?? 1
      const norm = payload.points.map(pt => ({
        t: pt.t,
        raw: pt.c,
        norm: ((pt.c - first) / first) * 100,
      }))
      return { symbol: payload.symbol, color, isPrimary, points: norm }
    })
  }, [data, compareSeries, hasData])

  const { minVal, maxVal, xScale, yScale, t0, tN } = useMemo(() => {
    if (series.length === 0) return { minVal: 0, maxVal: 0, xScale: () => 0, yScale: () => 0, t0: 0, tN: 0 }
    const vals: number[] = []
    let t0 = Infinity, tN = -Infinity
    for (const s of series) {
      for (const p of s.points) {
        vals.push(compareMode ? p.norm : p.raw)
        if (p.t < t0) t0 = p.t
        if (p.t > tN) tN = p.t
      }
    }
    let lo = Math.min(...vals), hi = Math.max(...vals)
    if (lo === hi) { lo -= 0.5; hi += 0.5 }
    const pad = (hi - lo) * 0.08
    const minVal = lo - pad, maxVal = hi + pad
    const dx = (W - PAD_L - PAD_R) / Math.max(1, tN - t0)
    const dy = (H - PAD_T - PAD_B) / (maxVal - minVal || 1)
    return {
      minVal, maxVal, t0, tN,
      xScale: (t: number) => PAD_L + (t - t0) * dx,
      yScale: (v: number) => H - PAD_B - (v - minVal) * dy,
    }
  }, [series, compareMode])

  const yTicks = useMemo(() => {
    if (series.length === 0) return [] as number[]
    const n = 4
    const step = (maxVal - minVal) / n
    return Array.from({ length: n + 1 }, (_, i) => minVal + step * i)
  }, [minVal, maxVal, series])

  // ── Mum grafik ön-hesabı ────────────────────────────────────────────────────
  const VPAD = 54   // hacim paneli yüksekliği (px)
  const candleScale = useMemo(() => {
    if (!hasData || chartType !== 'candle' || compareMode) return null
    const pts = points.filter(p => p.l != null && p.h != null && p.o != null)
    if (pts.length < 2) return null
    const lo0 = Math.min(...pts.map(p => p.l!))
    const hi0 = Math.max(...pts.map(p => p.h!))
    const margin = Math.max((hi0 - lo0) * 0.05, hi0 * 0.005)
    const lo = lo0 - margin, hi = hi0 + margin
    const priceH = H - PAD_T - PAD_B - VPAD - 8
    const yPrice = (v: number) => PAD_T + priceH * (1 - (v - lo) / (hi - lo))
    const maxVol = Math.max(...points.map(p => p.v ?? 0), 1)
    const volBase = H - PAD_B
    const yVol = (v: number) => volBase - Math.max(1, ((v / maxVol) * (VPAD - 6)))
    const n = points.length
    const slotW = (W - PAD_L - PAD_R) / Math.max(n, 1)
    const barW = Math.max(1, Math.min(10, slotW * 0.72))
    const xFor = (i: number) => PAD_L + (i + 0.5) * slotW
    const ticks = Array.from({ length: 5 }, (_, k) => lo + (hi - lo) * (k / 4))
    return { lo, hi, priceH, yPrice, maxVol, volBase, yVol, slotW, barW, xFor, ticks, n }
  }, [hasData, chartType, compareMode, points])

  const xLabels = useMemo(() => {
    if (!hasData) return [] as { t: number; label: string }[]
    const fmtT = (ms: number) => {
      const d = new Date(ms)
      if (tf === '1H' || tf === '1D') return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
      if (tf === '1W' || tf === '1M') return d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' })
      return d.toLocaleDateString('tr-TR', { month: 'short', year: '2-digit' })
    }
    return [
      { t: t0, label: fmtT(t0) },
      { t: (t0 + tN) / 2, label: fmtT((t0 + tN) / 2) },
      { t: tN, label: fmtT(tN) },
    ]
  }, [tf, t0, tN, hasData])

  // ── Hover ───────────────────────────────────────────────────────────────────
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!hasData || !svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const xRel = ((e.clientX - rect.left) / rect.width) * W
    if (xRel < PAD_L || xRel > W - PAD_R) { setHoverIdx(null); return }
    if (chartType === 'candle' && candleScale) {
      // Mum modu: indeks tabanlı
      const idx = Math.round((xRel - PAD_L) / candleScale.slotW - 0.5)
      setHoverIdx(Math.max(0, Math.min(points.length - 1, idx)))
    } else {
      let best = 0, bestDist = Infinity
      for (let i = 0; i < points.length; i++) {
        const d = Math.abs(xScale(points[i].t) - xRel)
        if (d < bestDist) { bestDist = d; best = i }
      }
      setHoverIdx(best)
    }
  }

  const hoverPoint = hoverIdx != null ? points[hoverIdx] : null
  const lastPoint  = hasData ? points[points.length - 1] : null

  const primaryColor = (data?.change_pct ?? 0) >= 0 ? 'var(--profit)' : 'var(--loss)'
  const fillColor    = (data?.change_pct ?? 0) >= 0 ? 'var(--profit-bg)' : 'var(--loss-bg)'

  const fmt = (n: number | null | undefined, dec = decimals) =>
    n == null ? '—' : n.toLocaleString('tr-TR', { minimumFractionDigits: dec, maximumFractionDigits: dec })

  const fmtY = (v: number) => compareMode ? `${v >= 0 ? '+' : ''}${v.toFixed(1)}%` : fmt(v)

  // Picker'da gösterilecek aday semboller
  const pickerCandidates = availableSymbols
    .filter(s => s !== symbol && !compareList.includes(s))
    .filter(s => pickerQuery === '' || s.toLowerCase().includes(pickerQuery.toLowerCase()))
    .slice(0, 24)

  return (
    <div style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-md)', padding: 'var(--space-4)',
      marginTop: 'var(--space-4)',
    }}>
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    flexWrap: 'wrap', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
        <div>
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)',
                        textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700 }}>
            {symbol} — Grafik {compareMode && <span style={{ color: 'var(--accent)' }}>(% karşılaştırma)</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)', marginTop: 4 }}>
            <span style={{ fontSize: 'var(--text-xl)', fontWeight: 800, color: 'var(--text-primary)' }}>
              {fmt(hoverPoint?.c ?? lastPoint?.c)}
            </span>
            {data?.change_pct != null && (
              <span style={{
                fontSize: 'var(--text-base)', fontWeight: 700,
                color: data.change_pct >= 0 ? 'var(--profit)' : 'var(--loss)',
              }}>
                {data.change_pct >= 0 ? '+' : ''}{data.change_pct.toFixed(2)}%
                <span style={{ color: 'var(--text-muted)', fontWeight: 500, marginLeft: 6 }}>
                  ({TF_LABEL[tf]})
                </span>
              </span>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* Grafik tipi toggle (sadece tekli seri modunda) */}
          {!compareMode && tf !== '5Y' && (
            <div style={{ display: 'flex', background: 'var(--bg-surface-2)',
                          padding: 3, borderRadius: 'var(--radius-sm)', gap: 2 }}>
              {(['line', 'candle'] as const).map(ct => (
                <button key={ct} onClick={() => setChartType(ct)} style={{
                  background: chartType === ct ? 'var(--bg-surface)' : 'transparent',
                  color: chartType === ct ? 'var(--text-primary)' : 'var(--text-muted)',
                  border: 'none', cursor: 'pointer',
                  padding: '5px 10px', borderRadius: 'var(--radius-xs)',
                  fontSize: 'var(--text-xs)', fontWeight: 700,
                  boxShadow: chartType === ct ? 'var(--shadow-xs)' : 'none',
                }}>
                  {ct === 'line' ? '╱ Çizgi' : '▮ Mum'}
                </button>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 4, background: 'var(--bg-surface-2)',
                        padding: 4, borderRadius: 'var(--radius-sm)' }}>
            {TIMEFRAMES.map(t => (
              <button
                key={t}
                onClick={() => setTf(t)}
                style={{
                  background: t === tf ? 'var(--bg-surface)' : 'transparent',
                  color:      t === tf ? 'var(--text-primary)' : 'var(--text-muted)',
                  border: 'none', cursor: 'pointer',
                  padding: '6px 12px', borderRadius: 'var(--radius-xs)',
                  fontSize: 'var(--text-xs)', fontWeight: 700,
                  boxShadow: t === tf ? 'var(--shadow-xs)' : 'none',
                }}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Karşılaştırma chip bar ─────────────────────────────────────────── */}
      {availableSymbols.length > 0 && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap',
                      marginBottom: 'var(--space-3)' }}>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
                         textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700 }}>
            Karşılaştır:
          </span>
          {/* Ana sembol chip */}
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '3px 10px', borderRadius: 'var(--radius-full)',
            background: 'var(--info-bg)', color: 'var(--info)',
            border: '1px solid var(--info-border)',
            fontSize: 'var(--text-xs)', fontWeight: 700,
          }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--info)' }} />
            {symbol}
          </span>
          {compareList.map((s, i) => {
            const c = COMPARE_COLORS[(i + 1) % COMPARE_COLORS.length]
            return (
              <span key={s} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '3px 10px', borderRadius: 'var(--radius-full)',
                background: 'var(--bg-surface-2)', border: '1px solid var(--border-default)',
                fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--text-primary)',
              }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: c }} />
                {s}
                <button
                  onClick={() => setCompareList(list => list.filter(x => x !== s))}
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer',
                           color: 'var(--text-muted)', fontSize: 14, lineHeight: 1, padding: 0 }}
                  title="Kaldır"
                >×</button>
              </span>
            )
          })}
          {compareList.length < MAX_COMPARE && (
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setPickerOpen(o => !o)}
                style={{
                  padding: '3px 10px', borderRadius: 'var(--radius-full)',
                  border: '1px dashed var(--border-strong)',
                  background: 'transparent', color: 'var(--text-muted)',
                  fontSize: 'var(--text-xs)', fontWeight: 600, cursor: 'pointer',
                }}
              >
                + Sembol ekle
              </button>
              {pickerOpen && (
                <>
                  <div onClick={() => setPickerOpen(false)}
                       style={{ position: 'fixed', inset: 0, zIndex: 90 }} />
                  <div style={{
                    position: 'absolute', top: 'calc(100% + 6px)', left: 0,
                    background: 'var(--bg-surface)', border: '1px solid var(--border-strong)',
                    borderRadius: 'var(--radius-sm)', padding: 6,
                    width: 240, maxHeight: 280, overflowY: 'auto',
                    boxShadow: 'var(--shadow-md)', zIndex: 100,
                  }}>
                    <input
                      autoFocus
                      placeholder="Ara…"
                      value={pickerQuery}
                      onChange={e => setPickerQuery(e.target.value)}
                      style={{
                        width: '100%', padding: '6px 8px', marginBottom: 6,
                        background: 'var(--bg-surface-2)', border: '1px solid var(--border-default)',
                        borderRadius: 'var(--radius-xs)', color: 'var(--text-primary)',
                        fontSize: 'var(--text-xs)', outline: 'none',
                      }}
                    />
                    {pickerCandidates.length === 0 ? (
                      <div style={{ padding: 8, color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>
                        Sonuç yok
                      </div>
                    ) : pickerCandidates.map(s => (
                      <button
                        key={s}
                        onClick={() => {
                          setCompareList(list => [...list, s])
                          setPickerQuery('')
                          setPickerOpen(false)
                        }}
                        style={{
                          display: 'block', width: '100%', textAlign: 'left',
                          padding: '5px 8px', border: 'none',
                          background: 'transparent', cursor: 'pointer',
                          color: 'var(--text-primary)', fontSize: 'var(--text-xs)', fontWeight: 600,
                          borderRadius: 'var(--radius-xs)',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--tint-2)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── SVG ─────────────────────────────────────────────────────────────── */}
      <div style={{ position: 'relative', width: '100%' }}>
        {loading && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex',
                        alignItems: 'center', justifyContent: 'center',
                        color: 'var(--text-muted)', fontSize: 'var(--text-sm)',
                        background: 'var(--tint-1)', borderRadius: 'var(--radius-sm)', zIndex: 2 }}>
            Yükleniyor…
          </div>
        )}
        {error && !loading && (
          <div style={{ padding: 'var(--space-5)', textAlign: 'center',
                        color: 'var(--loss)', fontSize: 'var(--text-sm)' }}>
            ⚠ {error}
          </div>
        )}
        {!hasData && !loading && !error && (
          <div style={{ padding: 'var(--space-5)', textAlign: 'center',
                        color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
            Bu zaman aralığı için veri bulunamadı.
          </div>
        )}

        {hasData && (
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            style={{ width: '100%', height: 'auto', display: 'block', cursor: 'crosshair' }}
            onMouseMove={onMove}
            onMouseLeave={() => setHoverIdx(null)}
          >
            {/* Y-grid — sadece çizgi / karşılaştırma modunda */}
            {(chartType === 'line' || compareMode) && yTicks.map((t, i) => (
              <g key={i}>
                <line x1={PAD_L} x2={W - PAD_R} y1={yScale(t)} y2={yScale(t)}
                      stroke="var(--border-subtle)" strokeWidth={1} />
                <text x={PAD_L - 8} y={yScale(t)} fontSize={11} dy={4}
                      textAnchor="end" fill="var(--text-muted)">
                  {fmtY(t)}
                </text>
              </g>
            ))}

            {/* X-labels */}
            {xLabels.map((xl, i) => (
              <text key={i} x={xScale(xl.t)} y={H - 8} fontSize={11}
                    textAnchor={i === 0 ? 'start' : i === xLabels.length - 1 ? 'end' : 'middle'}
                    fill="var(--text-muted)">
                {xl.label}
              </text>
            ))}

            {/* Series */}
            {/* ── Çizgi modu ─────────────────────────────────────────────── */}
            {!compareMode && hasData && chartType === 'line' && (() => {
              const baseY = H - PAD_B
              const linePath = points.map((p, i) =>
                `${i === 0 ? 'M' : 'L'}${xScale(p.t).toFixed(2)},${yScale(p.c).toFixed(2)}`
              ).join(' ')
              const areaPath = `M${xScale(points[0].t).toFixed(2)},${baseY} ` +
                points.map(p => `L${xScale(p.t).toFixed(2)},${yScale(p.c).toFixed(2)}`).join(' ') +
                ` L${xScale(points[points.length - 1].t).toFixed(2)},${baseY} Z`
              return (
                <>
                  <path d={areaPath} fill={fillColor} stroke="none" />
                  <path d={linePath} fill="none" stroke={primaryColor} strokeWidth={2}
                        strokeLinejoin="round" strokeLinecap="round" />
                </>
              )
            })()}

            {/* ── Mum + Hacim modu ─────────────────────────────────────── */}
            {!compareMode && hasData && chartType === 'candle' && candleScale && (() => {
              const cs = candleScale
              return (
                <>
                  {/* Mum y-grid */}
                  {cs.ticks.map((tick, i) => (
                    <g key={i}>
                      <line x1={PAD_L} x2={W - PAD_R} y1={cs.yPrice(tick)} y2={cs.yPrice(tick)}
                            stroke="var(--border-subtle)" strokeWidth={1} />
                      <text x={PAD_L - 6} y={cs.yPrice(tick)} fontSize={10} dy={4}
                            textAnchor="end" fill="var(--text-muted)">
                        {tick.toLocaleString('tr-TR', { maximumFractionDigits: 2 })}
                      </text>
                    </g>
                  ))}

                  {/* Hacim paneli ayırıcı */}
                  <line x1={PAD_L} x2={W - PAD_R} y1={cs.volBase - VPAD - 2} y2={cs.volBase - VPAD - 2}
                        stroke="var(--border-subtle)" strokeWidth={1} strokeDasharray="3 3" />

                  {points.map((p, i) => {
                    if (p.o == null || p.h == null || p.l == null) return null
                    const up    = p.c >= p.o
                    const col   = up ? 'var(--profit)' : 'var(--loss)'
                    const cx    = cs.xFor(i)
                    const bodyT = cs.yPrice(Math.max(p.c, p.o))
                    const bodyB = cs.yPrice(Math.min(p.c, p.o))
                    const bodyH = Math.max(1, bodyB - bodyT)
                    return (
                      <g key={i}>
                        {/* Fitil */}
                        <line x1={cx} x2={cx} y1={cs.yPrice(p.h)} y2={cs.yPrice(p.l)}
                              stroke={col} strokeWidth={1} />
                        {/* Gövde */}
                        <rect x={cx - cs.barW / 2} y={bodyT} width={cs.barW} height={bodyH}
                              fill={up ? col : col} stroke={col} strokeWidth={0.5}
                              fillOpacity={up ? 0.85 : 1} />
                        {/* Hacim */}
                        {p.v != null && p.v > 0 && (
                          <rect x={cx - cs.barW / 2} y={cs.yVol(p.v)}
                                width={cs.barW} height={cs.volBase - cs.yVol(p.v)}
                                fill={col} fillOpacity={0.4} />
                        )}
                      </g>
                    )
                  })}
                </>
              )
            })()}

            {compareMode && series.map(s => {
              const path = s.points.map((p, i) =>
                `${i === 0 ? 'M' : 'L'}${xScale(p.t).toFixed(2)},${yScale(p.norm).toFixed(2)}`
              ).join(' ')
              return (
                <path key={s.symbol} d={path} fill="none" stroke={s.color}
                      strokeWidth={s.isPrimary ? 2.5 : 2}
                      strokeLinejoin="round" strokeLinecap="round" />
              )
            })}

            {/* % mod sıfır çizgisi */}
            {compareMode && minVal < 0 && maxVal > 0 && (
              <line x1={PAD_L} x2={W - PAD_R} y1={yScale(0)} y2={yScale(0)}
                    stroke="var(--text-muted)" strokeDasharray="4 4" strokeWidth={1} opacity={0.5} />
            )}

            {/* Hover crosshair */}
            {hoverPoint && (() => {
              const hx = (chartType === 'candle' && candleScale && hoverIdx != null)
                ? candleScale.xFor(hoverIdx)
                : xScale(hoverPoint.t)
              const hy = (chartType === 'candle' && candleScale)
                ? candleScale.yPrice(hoverPoint.c)
                : yScale(hoverPoint.c)
              return (
                <g>
                  <line x1={hx} x2={hx} y1={PAD_T} y2={H - PAD_B}
                        stroke="var(--text-muted)" strokeDasharray="3 3" strokeWidth={1} />
                  {compareMode
                    ? series.map(s => {
                        const pt = s.points.find(p => p.t === hoverPoint.t) ||
                                   s.points.reduce((b, p) => Math.abs(p.t - hoverPoint.t) < Math.abs(b.t - hoverPoint.t) ? p : b, s.points[0])
                        return <circle key={s.symbol} cx={xScale(pt.t)} cy={yScale(pt.norm)} r={4}
                                       fill={s.color} stroke="var(--bg-surface)" strokeWidth={2} />
                      })
                    : <circle cx={hx} cy={hy} r={4}
                              fill={primaryColor} stroke="var(--bg-surface)" strokeWidth={2} />}
                </g>
              )
            })()}
          </svg>
        )}
      </div>

      {/* ── Hover footer ────────────────────────────────────────────────────── */}
      {hasData && hoverPoint && !compareMode && (
        <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap',
                      marginTop: 'var(--space-2)', fontSize: 'var(--text-xs)',
                      color: 'var(--text-secondary)' }}>
          <span>
            <span style={{ color: 'var(--text-muted)' }}>Tarih: </span>
            {new Date(hoverPoint.t).toLocaleString('tr-TR')}
          </span>
          {hoverPoint.o != null && <span><span style={{ color: 'var(--text-muted)' }}>A: </span>{fmt(hoverPoint.o)}</span>}
          {hoverPoint.h != null && <span><span style={{ color: 'var(--text-muted)' }}>Y: </span>{fmt(hoverPoint.h)}</span>}
          {hoverPoint.l != null && <span><span style={{ color: 'var(--text-muted)' }}>D: </span>{fmt(hoverPoint.l)}</span>}
          <span><span style={{ color: 'var(--text-muted)' }}>K: </span>{fmt(hoverPoint.c)}</span>
          {hoverPoint.v != null && hoverPoint.v > 0 && (
            <span><span style={{ color: 'var(--text-muted)' }}>Hcm: </span>
              {hoverPoint.v.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}
            </span>
          )}
        </div>
      )}

      {/* Karşılaştırma modunda mini özet */}
      {hasData && compareMode && (
        <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap',
                      marginTop: 'var(--space-2)', fontSize: 'var(--text-xs)' }}>
          {series.map(s => {
            const last = s.points[s.points.length - 1]?.norm ?? 0
            return (
              <span key={s.symbol} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color }} />
                <span style={{ color: 'var(--text-secondary)', fontWeight: 700 }}>{s.symbol}</span>
                <span style={{ color: last >= 0 ? 'var(--profit)' : 'var(--loss)', fontWeight: 700 }}>
                  {last >= 0 ? '+' : ''}{last.toFixed(2)}%
                </span>
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default ChartPanel
