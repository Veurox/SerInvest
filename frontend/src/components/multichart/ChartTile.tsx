// =============================================================================
// SerInvest — Çoklu Grafik: tek hücre
//
// Bir sembolün sıkıştırılmış fiyat grafiği + başlıkta canlı fiyat/değişim ve
// (varsa) AI kararı. Grafik gövdesine tıklamak sembolün TAM detay panelini açar
// (App.tsx'teki SymbolDrawer — grafik, teknik göstergeler, AI hedef/stop).
//
// Tasarım notu: 8 hücre aynı anda açık olabildiği için hücre içi her piksel
// pahalı. Eksen etiketleri seyreltilmiş, ızgara yatayda tek çizgi, tooltip
// yalnızca imleç üzerindeyken. Hücre küçüldükçe eksenler otomatik gizlenir.
// =============================================================================
import { useEffect, useState } from 'react'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts'
import { API } from '../../lib/api'
import type { OracleAnalysis, PriceData } from '../../lib/types'
import { SymbolPicker } from './SymbolPicker'

export type TF = '1H' | '1D' | '1W' | '1M' | '3M' | '1Y' | '5Y'

interface ChartPoint { t: number; c: number }
interface ChartPayload { symbol: string; points: ChartPoint[]; error?: string }

interface Props {
  symbol: string
  tf: TF
  assets: PriceData[]
  analysis: OracleAnalysis | null
  /** Hücre sayısı — küçük hücrede eksenler gizlenir. */
  density: number
  active: boolean
  onActivate: () => void
  onOpenDetail: (symbol: string) => void
  onChangeSymbol: (symbol: string) => void
  onRemove: () => void
}

const px = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const tickFmt = (tf: TF) => (t: number) => {
  const d = new Date(t)
  if (tf === '1H' || tf === '1D') return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
  if (tf === '5Y') return d.toLocaleDateString('tr-TR', { month: 'short', year: '2-digit' })
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' })
}

export function ChartTile({
  symbol, tf, assets, analysis, density, active,
  onActivate, onOpenDetail, onChangeSymbol, onRemove,
}: Props) {
  const [points, setPoints] = useState<ChartPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)

  useEffect(() => {
    let stop = false
    setLoading(true); setErr(null)
    fetch(`${API}/market/${encodeURIComponent(symbol)}/chart?tf=${tf}`)
      .then(r => r.json())
      .then((j: ChartPayload) => {
        if (stop) return
        if (j.error || !j.points?.length) { setErr(j.error || 'veri yok'); setPoints([]) }
        else setPoints(j.points.filter(p => p.c != null).sort((a, b) => a.t - b.t))
      })
      .catch(e => { if (!stop) setErr(String(e)) })
      .finally(() => { if (!stop) setLoading(false) })
    return () => { stop = true }
  }, [symbol, tf])

  // Değişim: seçili aralığın ilk-son farkı (gün içi açılış değil — grafikle tutarlı)
  const first = points.length ? points[0].c : null
  const last  = points.length ? points[points.length - 1].c : null
  const chgPct = last != null && first ? ((last - first) / first) * 100 : null
  const up = (chgPct ?? 0) >= 0
  const lineColor = chgPct == null ? 'var(--info)' : up ? 'var(--profit)' : 'var(--loss)'

  const isBuy  = !!analysis && analysis.recommendation.includes('ALIM')
  const target = isBuy ? analysis?.shortTermTarget ?? null : null
  const stopPx = isBuy ? analysis?.shortTermStop ?? null : null

  // Yoğunluk arttıkça kroma azalır: 6-8 hücrede eksenler okunmuyor, gizlenir.
  const showAxes = density <= 4
  const showY    = density <= 6

  const gradId = `mcFill_${symbol.replace(/[^A-Za-z0-9]/g, '')}_${density}`

  return (
    <div className={`mc-tile${active ? ' mc-tile--active' : ''}`} onMouseDown={onActivate}>
      <div className="mc-tile__head">
        <button className="mc-sym" onClick={e => { e.stopPropagation(); setPicking(v => !v) }}
                title="Sembolü değiştir">
          {symbol}
        </button>

        <span className="mc-px">{last != null ? px.format(last) : '—'}</span>
        {chgPct != null && (
          // DİKKAT: bu yüzde SEÇİLİ ARALIĞIN değişimi (grafikle tutarlı olsun diye),
          // borsa terminallerindeki alışılmış "günlük değişim" DEĞİL. Karışmasın
          // diye aralık etiketi yanında; dar hücrede etiket gizlenir, başlık kalır.
          <span className="mc-chg" style={{ color: up ? 'var(--profit)' : 'var(--loss)' }}
                title={`${symbol} · seçili aralık (${tf}) değişimi`}>
            {up ? '+' : ''}{chgPct.toFixed(2)}%
            <span className="mc-chg__tf">{tf}</span>
          </span>
        )}

        {analysis && (
          <span className="mc-badge" style={{
            color: isBuy ? 'var(--profit)' : 'var(--text-muted)',
            borderColor: isBuy ? 'var(--profit-border)' : 'var(--border-default)',
            background: isBuy ? 'var(--profit-bg)' : 'transparent',
          }}>
            {analysis.recommendation}
          </span>
        )}

        <button className="mc-tile__close" onClick={e => { e.stopPropagation(); onRemove() }}
                title="Hücreyi kaldır" aria-label={`${symbol} hücresini kaldır`}>×</button>

        {picking && (
          <SymbolPicker
            assets={assets}
            onPick={s => { onChangeSymbol(s); setPicking(false) }}
            onClose={() => setPicking(false)}
          />
        )}
      </div>

      <div className="mc-tile__body"
           onClick={() => onOpenDetail(symbol)}
           role="button" tabIndex={0}
           onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenDetail(symbol) } }}
           aria-label={`${symbol} detaylarını aç`}>
        {(loading || err) && (
          <div className="mc-tile__msg">{loading ? 'yükleniyor…' : `veri yok (${err})`}</div>
        )}

        {points.length > 0 && (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 6, right: showY ? 4 : 2, bottom: 2, left: 2 }}>
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={lineColor} stopOpacity={0.24} />
                  <stop offset="100%" stopColor={lineColor} stopOpacity={0.02} />
                </linearGradient>
              </defs>

              <CartesianGrid stroke="var(--border-subtle)" vertical={false} />

              <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']}
                     hide={!showAxes} tickFormatter={tickFmt(tf)} minTickGap={44}
                     tick={{ fontSize: 9, fill: 'var(--text-muted)' }}
                     axisLine={{ stroke: 'var(--border-default)' }} tickLine={false} />

              <YAxis domain={['dataMin', 'dataMax']} orientation="right" width={46}
                     hide={!showY} tickFormatter={(v: number) => px.format(v)}
                     tick={{ fontSize: 9, fill: 'var(--text-muted)' }}
                     axisLine={false} tickLine={false} />

              <Tooltip
                cursor={{ stroke: 'var(--border-strong)', strokeDasharray: '3 3' }}
                content={({ active: on, payload }) => {
                  if (!on || !payload?.length) return null
                  const p = payload[0].payload as ChartPoint
                  return (
                    <div style={{
                      background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
                      padding: '4px 8px', fontSize: 11,
                    }}>
                      <div style={{ color: 'var(--text-muted)', fontSize: 9.5 }}>
                        {new Date(p.t).toLocaleString('tr-TR', {
                          day: '2-digit', month: 'short',
                          ...(tf === '1H' || tf === '1D' ? { hour: '2-digit', minute: '2-digit' } : {}),
                        })}
                      </div>
                      <div style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                        {px.format(p.c)}
                      </div>
                    </div>
                  )
                }}
              />

              <Area type="monotone" dataKey="c" stroke={lineColor} strokeWidth={1.4}
                    fill={`url(#${gradId})`} dot={false} isAnimationActive={false}
                    activeDot={{ r: 2.5, fill: lineColor, stroke: 'var(--bg-surface)', strokeWidth: 1.5 }} />

              {/* AI bariyerleri — yalnız yeterli alan varsa, etiketsiz (yer yok) */}
              {showY && target != null && (
                <ReferenceLine y={target} stroke="var(--profit)" strokeDasharray="4 3" strokeWidth={1} />
              )}
              {showY && stopPx != null && (
                <ReferenceLine y={stopPx} stroke="var(--loss)" strokeDasharray="4 3" strokeWidth={1} />
              )}
            </AreaChart>
          </ResponsiveContainer>
        )}

        <span className="mc-tile__hint">detay için tıkla</span>
      </div>
    </div>
  )
}
