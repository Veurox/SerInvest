// =============================================================================
// Terminal — Ana Grafik: Gerçek Fiyat vs AI Hedef/Stop Bariyerleri
//
// 08/2026: Recharts'tan lightweight-charts'a taşındı (docs/PLAN_2026-08.md Faz C).
// Kazanılan: mum grafiği, hacim alt paneli, crosshair ile OHLC okuması.
// Çizim işi components/charts/PriceChart.tsx'te — çoklu ızgara ile AYNI bileşen,
// ikisi zamanla ayrışmasın diye.
// =============================================================================
import { useEffect, useMemo, useState } from 'react'
import { API } from '../../lib/api'
import { useConfig } from '../../lib/useConfig'
import { PriceChart, type CrosshairInfo, type Overlay } from '../charts/PriceChart'
import type { Bar } from '../../lib/bars'
import type { OracleAnalysis } from '../../lib/types'

interface ChartPayload { symbol: string; points: Bar[]; error?: string }

interface Props {
  symbol: string
  analysis: OracleAnalysis | null
}

const TIMEFRAMES = ['1H', '1D', '1W', '1M', '3M', '1Y', '5Y'] as const
type TF = typeof TIMEFRAMES[number]
const TF_LABEL: Record<TF, string> = {
  '1H': '1S', '1D': '1G', '1W': '1H', '1M': '1A', '3M': '3A', '1Y': '1Y', '5Y': '5Y',
}

const px = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const vol = (v: number | null) => {
  if (v == null) return '—'
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`
  return String(Math.round(v))
}

export function TerminalChart({ symbol, analysis }: Props) {
  const cfg = useConfig()
  const [tf, setTf] = useState<TF>('3M')
  const [kind, setKind] = useState<'candle' | 'line'>('candle')
  const [bars, setBars] = useState<Bar[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [hover, setHover] = useState<CrosshairInfo | null>(null)

  useEffect(() => {
    let stop = false
    setLoading(true); setErr(null); setHover(null)
    fetch(`${API}/market/${encodeURIComponent(symbol)}/chart?tf=${tf}`)
      .then(r => r.json())
      .then((j: ChartPayload) => {
        if (stop) return
        if (j.error || !j.points?.length) { setErr(j.error || 'veri yok'); setBars([]) }
        else setBars(j.points)
      })
      .catch(e => { if (!stop) setErr(String(e)) })
      .finally(() => { if (!stop) setLoading(false) })
    return () => { stop = true }
  }, [symbol, tf])

  const isBuy  = !!analysis && analysis.recommendation.includes('ALIM')
  const target = isBuy ? analysis?.shortTermTarget ?? null : null
  const stopPx = isBuy ? analysis?.shortTermStop ?? null : null
  const entry  = analysis?.priceAtAnalysis ?? null

  const first = bars.length ? bars[0].c : null
  const last  = bars.length ? bars[bars.length - 1].c : null
  const chgPct = last != null && first ? ((last - first) / first) * 100 : null

  const overlays = useMemo<Overlay[]>(() => {
    const out: Overlay[] = []
    if (target != null) out.push({ price: target, color: 'var(--profit)', label: `HEDEF ${px.format(target)}` })
    if (stopPx != null) out.push({ price: stopPx, color: 'var(--loss)',   label: `STOP ${px.format(stopPx)}` })
    if (entry != null && isBuy) out.push({ price: entry, color: 'var(--text-disabled)', label: `ANALİZ ${px.format(entry)}` })
    return out
  }, [target, stopPx, entry, isBuy])

  return (
    <section className="t-panel t-area-chart" aria-label="Fiyat ve yapay zeka bariyer grafiği">
      <div className="t-panel__head">
        <span className="t-panel__title">
          {symbol} · Fiyat vs AI Bariyerleri
          {hover ? (
            <span className="t-ohlc">
              <i>A</i>{px.format(hover.o ?? 0)}
              <i>Y</i>{px.format(hover.h ?? 0)}
              <i>D</i>{px.format(hover.l ?? 0)}
              <i>K</i><b>{px.format(hover.c ?? 0)}</b>
              {hover.v != null && <><i>H</i>{vol(hover.v)}</>}
            </span>
          ) : chgPct != null && (
            <span className={`t-num ${chgPct >= 0 ? 't-up' : 't-down'}`}
                  style={{ marginLeft: 8, textTransform: 'none', letterSpacing: 0 }}>
              {chgPct >= 0 ? '+' : ''}{chgPct.toFixed(2)}%
            </span>
          )}
        </span>

        <span style={{ display: 'inline-flex', gap: 2, marginLeft: 'auto' }}>
          <button onClick={() => setKind(k => (k === 'candle' ? 'line' : 'candle'))}
                  title={kind === 'candle' ? 'Çizgiye geç' : 'Muma geç'}
                  style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 8px', cursor: 'pointer',
                    borderRadius: 2, border: '1px solid var(--border-default)',
                    background: 'transparent', color: 'var(--text-secondary)', marginRight: 6,
                  }}>
            {kind === 'candle' ? '▮ Mum' : '╱ Çizgi'}
          </button>
          {TIMEFRAMES.map(t => (
            <button key={t} onClick={() => setTf(t)}
              style={{
                fontSize: 10, fontWeight: 700, padding: '2px 8px', cursor: 'pointer',
                borderRadius: 2, border: '1px solid',
                borderColor: tf === t ? 'var(--accent-border)' : 'transparent',
                background: tf === t ? 'var(--accent-bg)' : 'transparent',
                color: tf === t ? 'var(--accent)' : 'var(--text-muted)',
              }}>{TF_LABEL[t]}</button>
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
        {bars.length > 0 && (
          <PriceChart
            bars={bars}
            kind={kind}
            overlays={overlays}
            onCrosshair={setHover}
            height={420}
          />
        )}
      </div>

      <div style={{ padding: '5px 10px', borderTop: '1px solid var(--border-subtle)',
                    fontSize: 10, color: 'var(--text-muted)', display: 'flex', gap: 14 }}>
        <span>{kind === 'candle' ? 'Mum' : 'Kapanış'} + hacim</span>
        {target != null && <span className="t-up">— — Hedef (TP = {cfg.model.tp_atr_mult}×ATR)</span>}
        {stopPx != null && <span className="t-down">— — Stop (SL = {cfg.model.sl_atr_mult}×ATR)</span>}
        <span style={{ marginLeft: 'auto' }}>{cfg.model.horizon_days}g triple-barrier · eğitimle aynı tanım</span>
      </div>
    </section>
  )
}
