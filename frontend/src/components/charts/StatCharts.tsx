// =============================================================================
// SerInvest — İstatistik grafikleri (elle SVG, bağımlılıksız)
//
// Neden elle: bunlar fiyat grafiği DEĞİL, lightweight-charts'ın işi değil.
// Yalnız bu iki grafik için Recharts'ı (~100KB) tutmak mantıksızdı; ikisi de
// birkaç yüz satır SVG ile çiziliyor ve tasarım üzerinde tam kontrol veriyor.
//
// Ölçekleme tekniği: SVG yalnız GEOMETRİ taşır (preserveAspectRatio="none" ile
// yatayda serbest esner), eksen ve etiketler HTML olarak dışında durur. Böylece
// yazılar hiçbir genişlikte deforme olmaz — SVG içine yazı koymanın klasik
// sorunu budur.
// =============================================================================
import { useState } from 'react'

const VB_W = 1000          // viewBox genişliği (yatayda esner)
const AXIS_W = 34          // sol eksen etiket şeridi (HTML)

interface Tip { x: number; y: number; node: React.ReactNode }

function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null
  return (
    <div style={{
      position: 'absolute', left: `${tip.x}%`, top: tip.y, transform: 'translate(-50%, -100%)',
      pointerEvents: 'none', zIndex: 5, whiteSpace: 'nowrap',
      background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
      padding: '6px 9px', fontSize: 11.5, boxShadow: 'var(--shadow-md, 0 4px 12px rgba(0,0,0,.3))',
    }}>{tip.node}</div>
  )
}

// ── Lift çubukları: sıfır çizgili işaretli çubuk grafiği ────────────────────

export interface LiftBar {
  fold: number
  test: string
  liftPct: number
  base_rate: number
  buy_precision: number | null
  buy_signals: number
}

export function LiftBars({ data, height = 170 }: { data: LiftBar[]; height?: number }) {
  const [tip, setTip] = useState<Tip | null>(null)
  if (data.length === 0) return null

  const vals = data.map(d => d.liftPct)
  const lo = Math.min(0, ...vals)
  const hi = Math.max(0, ...vals)
  const pad = (hi - lo) * 0.12 || 1
  const yMin = lo - pad
  const yMax = hi + pad
  const span = yMax - yMin || 1

  const toY = (v: number) => ((yMax - v) / span) * height
  const zeroY = toY(0)

  const slot = VB_W / data.length
  const barW = Math.max(2, slot * 0.62)

  // Y ekseni: sıfır + uçlar, 3 etiket yeter (yoğunluk gürültü yapar)
  const ticks = [yMax, 0, yMin]

  return (
    <div style={{ position: 'relative', display: 'flex', gap: 4 }}>
      <div style={{ width: AXIS_W, height, position: 'relative', flex: '0 0 auto' }}>
        {ticks.map((t, i) => (
          <span key={i} style={{
            position: 'absolute', right: 0, top: toY(t), transform: 'translateY(-50%)',
            fontSize: 9.5, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums',
          }}>{t >= 0 ? '+' : ''}{t.toFixed(0)}p</span>
        ))}
      </div>

      <div style={{ position: 'relative', flex: '1 1 0%', minWidth: 0 }}>
        <svg viewBox={`0 0 ${VB_W} ${height}`} width="100%" height={height}
             preserveAspectRatio="none" role="img"
             aria-label={`${data.length} dönemin taban üstü farkı, puan`}>
          {ticks.map((t, i) => (
            <line key={i} x1={0} x2={VB_W} y1={toY(t)} y2={toY(t)}
                  stroke={t === 0 ? 'var(--border-strong)' : 'var(--border-subtle)'}
                  strokeWidth={t === 0 ? 1.5 : 1} vectorEffect="non-scaling-stroke" />
          ))}
          {data.map((d, i) => {
            const y = toY(d.liftPct)
            const x = i * slot + (slot - barW) / 2
            return (
              <rect key={d.fold} x={x} y={Math.min(y, zeroY)} width={barW}
                    height={Math.max(1, Math.abs(zeroY - y))}
                    fill={d.liftPct >= 0 ? 'var(--profit)' : 'var(--loss)'} opacity={0.85}
                    onMouseEnter={() => setTip({
                      x: ((i + 0.5) / data.length) * 100,
                      y: Math.min(y, zeroY) - 6,
                      node: (
                        <>
                          <div style={{ fontWeight: 700 }}>Dönem {d.fold}</div>
                          <div style={{ color: 'var(--text-muted)', fontSize: 10.5 }}>{d.test}</div>
                          <div style={{ marginTop: 3 }}>
                            AL isabeti <b>{d.buy_precision != null ? `%${(d.buy_precision * 100).toFixed(0)}` : '—'}</b>
                            {' '}· taban <b>%{(d.base_rate * 100).toFixed(0)}</b>
                          </div>
                          <div style={{ color: d.liftPct >= 0 ? 'var(--profit)' : 'var(--loss)', fontWeight: 700 }}>
                            fark {d.liftPct >= 0 ? '+' : ''}{d.liftPct} puan
                          </div>
                          <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>{d.buy_signals} AL sinyali</div>
                        </>
                      ),
                    })}
                    onMouseLeave={() => setTip(null)} />
            )
          })}
        </svg>
        <Tooltip tip={tip} />
        <div style={{ display: 'flex', marginTop: 3 }}>
          {data.map((d, i) => (
            <span key={d.fold} style={{
              flex: '1 1 0', textAlign: 'center', fontSize: 9,
              color: 'var(--text-muted)', overflow: 'hidden',
            }}>{i % 2 === 0 ? d.fold : ''}</span>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Kalibrasyon: iki seri, nokta + çizgi ────────────────────────────────────

export interface CalPoint { x: number; tahmin: number; gercek: number; n: number }

export function CalibrationLines({ data, height = 150 }: { data: CalPoint[]; height?: number }) {
  const [tip, setTip] = useState<Tip | null>(null)
  if (data.length === 0) return null

  const xs = data.map(d => d.x)
  const xMin = Math.min(...xs)
  const xMax = Math.max(...xs)
  const xSpan = xMax - xMin || 1
  const toX = (v: number) => ((v - xMin) / xSpan) * VB_W
  const toY = (v: number) => ((100 - v) / 100) * height    // yüzde ekseni 0-100 sabit

  const path = (key: 'tahmin' | 'gercek') =>
    data.map((d, i) => `${i === 0 ? 'M' : 'L'}${toX(d.x).toFixed(1)},${toY(d[key]).toFixed(1)}`).join(' ')

  const ticks = [100, 75, 50, 25, 0]

  return (
    <div>
      <div style={{ position: 'relative', display: 'flex', gap: 4 }}>
        <div style={{ width: AXIS_W, height, position: 'relative', flex: '0 0 auto' }}>
          {ticks.map(t => (
            <span key={t} style={{
              position: 'absolute', right: 0, top: toY(t), transform: 'translateY(-50%)',
              fontSize: 9.5, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums',
            }}>%{t}</span>
          ))}
        </div>

        <div style={{ position: 'relative', flex: '1 1 0%', minWidth: 0 }}>
          <svg viewBox={`0 0 ${VB_W} ${height}`} width="100%" height={height}
               preserveAspectRatio="none" role="img"
               aria-label="Kalibrasyon eğrisi: model tahmini ve gerçekleşen oran">
            {ticks.map(t => (
              <line key={t} x1={0} x2={VB_W} y1={toY(t)} y2={toY(t)}
                    stroke="var(--border-subtle)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            ))}
            <path d={path('tahmin')} fill="none" stroke="var(--info)" strokeWidth={2.5}
                  vectorEffect="non-scaling-stroke" />
            <path d={path('gercek')} fill="none" stroke="var(--accent)" strokeWidth={2.5}
                  vectorEffect="non-scaling-stroke" />
            {data.map((d, i) => (
              <g key={i}>
                <circle cx={toX(d.x)} cy={toY(d.tahmin)} r={3} fill="var(--info)" vectorEffect="non-scaling-stroke" />
                <circle cx={toX(d.x)} cy={toY(d.gercek)} r={3} fill="var(--accent)" vectorEffect="non-scaling-stroke" />
                {/* Görünmez geniş yakalama şeridi — nokta küçük, isabet zor */}
                <rect x={toX(d.x) - VB_W / (data.length * 2)} y={0}
                      width={VB_W / data.length} height={height} fill="transparent"
                      onMouseEnter={() => setTip({
                        x: ((d.x - xMin) / xSpan) * 100,
                        y: Math.min(toY(d.tahmin), toY(d.gercek)) - 6,
                        node: (
                          <>
                            <div style={{ color: 'var(--text-muted)', fontSize: 10.5 }}>ham skor ≈ %{d.x}</div>
                            <div style={{ color: 'var(--info)' }}>model dedi: <b>%{d.tahmin}</b></div>
                            <div style={{ color: 'var(--accent)' }}>gerçekte: <b>%{d.gercek}</b></div>
                            <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>{d.n} örnek</div>
                          </>
                        ),
                      })}
                      onMouseLeave={() => setTip(null)} />
              </g>
            ))}
          </svg>
          <Tooltip tip={tip} />
          <div style={{ display: 'flex', marginTop: 3 }}>
            {data.map((d, i) => (
              <span key={i} style={{ flex: '1 1 0', textAlign: 'center', fontSize: 9, color: 'var(--text-muted)' }}>
                %{d.x}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 14, marginTop: 6, fontSize: 10.5, color: 'var(--text-muted)' }}>
        <span><b style={{ color: 'var(--info)' }}>—</b> Model tahmini</span>
        <span><b style={{ color: 'var(--accent)' }}>—</b> Gerçekleşen</span>
      </div>
    </div>
  )
}
