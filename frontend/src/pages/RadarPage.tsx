// =============================================================================
// SerInvest — Fırsat Radarı  (route: /radar)
// Saf teknik ml v3 (BIST-50, 10g) ALIM sinyallerini güvene göre sıralar; her biri
// için net işlem planı: giriş / hedef / stop / pozisyon / R:R / potansiyel %.
// Long-only: yalnız ALIM (SELL yok).
// =============================================================================
import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { fmt, parseArr, recColor } from '../lib/format'
import { COMPANY_NAMES } from '../lib/companies'
import { CompanyLogo } from '../components/common/CompanyLogo'
import { PageHeader, KPI, Icon } from '../components/ui'
import type { OracleAnalysis } from '../lib/types'
import type { SharedData } from '../App'

// Yön: öneriden BUY çıkar (long-only — SELL üretilmez)
function dirOf(rec: string): 'BUY' | 'NEUTRAL' {
  if (rec.includes('ALIM')) return 'BUY'
  return 'NEUTRAL'
}

// Fırsat skoru (saf teknik): model güveni (P-yukarı) ana sinyal; R:R sabit 1.5
// olduğu için küçük sabit bonus. Eski füzyon-bileşen hemfikirliği KALDIRILDI.
function opportunityScore(o: OracleAnalysis): number {
  if (dirOf(o.recommendation) !== 'BUY') return -1
  let s = o.confidence
  if (o.riskRewardRatio != null && o.riskRewardRatio >= 1.5) s += 0.05
  return s
}

// Potansiyel kazanç/risk yüzdeleri (yönüne göre)
function tradePlan(o: OracleAnalysis) {
  const dir = dirOf(o.recommendation)
  const px  = o.priceAtAnalysis
  if (px == null || px <= 0) return null
  const tp = o.shortTermTarget
  const sl = o.shortTermStop
  // BUY: yukarı hedef; SELL: aşağı hedef (short kazancı)
  const gainPct = tp != null
    ? (dir === 'BUY' ? (tp - px) / px : (px - tp) / px)
    : null
  const riskPct = sl != null
    ? (dir === 'BUY' ? (px - sl) / px : (sl - px) / px)
    : null
  return { dir, px, tp, sl, gainPct, riskPct }
}

export default function RadarPage() {
  const { oracle } = useOutletContext<SharedData>()
  const [minConf, setMinConf] = useState(0.55)

  // Filtrele (NÖTR hariç + min güven) → skorla → sırala
  const ranked = oracle
    .filter(o => dirOf(o.recommendation) !== 'NEUTRAL' && o.confidence >= minConf)
    .map(o => ({ o, score: opportunityScore(o) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)

  const buyCount  = oracle.filter(o => o.recommendation === 'ALIM').length
  const strongBuy = oracle.filter(o => o.recommendation === 'GÜÇLÜ ALIM').length
  const topConf   = ranked.length > 0 ? ranked[0].o.confidence : 0

  return (
    <div style={{ paddingTop: 'var(--space-2)' }}>
      <PageHeader
        icon={<Icon name="target" size={20} />}
        title="Fırsat Radarı"
        subtitle={<>BIST-50 · saf teknik · 10 işlem-günü · long-only <span className="tech-tag" style={{ marginLeft: 6 }}>● saf teknik</span></>}
        right={
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontWeight: 'var(--fw-bold)', marginRight: 4 }}>MİN GÜVEN</span>
            {[0.55, 0.60, 0.65, 0.70].map(c => (
              <button key={c} className={`fpill${minConf === c ? ' on' : ''}`} onClick={() => setMinConf(c)}>
                %{(c * 100).toFixed(0)}
              </button>
            ))}
          </div>
        }
      />

      <div className="kpi-strip">
        <KPI label="Güçlü Alım" value={strongBuy} tone={strongBuy > 0 ? 'profit' : 'neutral'} icon={<Icon name="trending-up" size={14} />} />
        <KPI label="Alım" value={buyCount} tone={buyCount > 0 ? 'profit' : 'neutral'} icon="▲" />
        <KPI label="Radarda (filtreli)" value={ranked.length} tone="accent" icon={<Icon name="target" size={14} />} />
        <KPI label="En Yüksek Güven" value={topConf > 0 ? `%${(topConf * 100).toFixed(0)}` : '—'} tone="info" icon="◷" />
      </div>

      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginBottom: 'var(--space-4)', lineHeight: 1.5 }}>
        Yatırım tavsiyesi değildir — her işlemde stop-loss kullanın. Hedef/stop 10g triple-barrier (TP 3×ATR / SL 2×ATR, R:R 1.5).
      </div>

      {/* Boş durum */}
      {ranked.length === 0 && (
        <div className="empty">
          <p>Şu an %{(minConf * 100).toFixed(0)} güven üzeri net sinyal yok.</p>
          <p style={{ marginTop: '.5rem', fontSize: '.8rem' }}>
            Filtreyi düşür veya bir sonraki analiz döngüsünü bekle (her 30 dk).
          </p>
        </div>
      )}

      {/* Fırsat kartları */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '1rem' }}>
        {ranked.map(({ o, score }, idx) => {
          const col  = recColor(o.recommendation)
          const plan = tradePlan(o)
          const drivers = parseArr(o.keyDrivers).slice(0, 2)
          const conf = Math.round(o.confidence * 100)

          return (
            <div key={o.id} style={{
              border: `1px solid ${col.border}`, background: col.bg,
              borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)',
              display: 'flex', flexDirection: 'column', gap: 'var(--space-3)',
              position: 'relative',
            }}>
              {/* Sıra rozeti */}
              <div style={{
                position: 'absolute', top: '-10px', left: '-10px',
                width: '28px', height: '28px', borderRadius: '50%',
                background: 'var(--accent)', color: 'var(--bg-app)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 800, fontSize: '.8rem', boxShadow: 'var(--shadow-md)',
              }}>{idx + 1}</div>

              {/* Üst: logo + sembol + öneri */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                <CompanyLogo symbol={o.symbol} size={36} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 'var(--fw-black)', fontSize: 'var(--text-md)' }}>{o.symbol}</div>
                  {COMPANY_NAMES[o.symbol] && (
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {COMPANY_NAMES[o.symbol]}
                    </div>
                  )}
                </div>
                <span style={{
                  padding: '.25rem .6rem', borderRadius: 'var(--radius-full)',
                  background: col.color + '22', color: col.color,
                  fontWeight: 800, fontSize: '.72rem', whiteSpace: 'nowrap',
                }}>{o.recommendation}</span>
              </div>

              {/* Güven barı */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.68rem',
                  color: 'var(--text-muted)', marginBottom: '.2rem' }}>
                  <span>Model Güveni</span><span style={{ color: col.color, fontWeight: 700 }}>%{conf}</span>
                </div>
                <div style={{ height: '5px', background: 'var(--border)', borderRadius: '3px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${conf}%`, background: col.color, borderRadius: '3px' }} />
                </div>
              </div>

              {/* İşlem planı */}
              {plan && (
                <div style={{
                  display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)',
                  background: 'var(--bg-glass)', borderRadius: 'var(--radius-sm)',
                  padding: 'var(--space-3)', fontSize: 'var(--text-xs)',
                }}>
                  <PlanCell label="Giriş" value={`${fmt(plan.px)} ₺`} />
                  <PlanCell label="Pozisyon"
                    value={o.positionSizePct != null && o.positionSizePct > 0
                      ? `%${(o.positionSizePct * 100).toFixed(1)}` : '—'} />
                  <PlanCell label={plan.dir === 'BUY' ? 'Hedef' : 'Hedef (aşağı)'}
                    value={plan.tp != null ? `${fmt(plan.tp)} ₺` : '—'}
                    sub={plan.gainPct != null ? `+%${(plan.gainPct * 100).toFixed(1)}` : undefined}
                    subColor="var(--profit)" />
                  <PlanCell label="Stop"
                    value={plan.sl != null ? `${fmt(plan.sl)} ₺` : '—'}
                    sub={plan.riskPct != null ? `-%${(plan.riskPct * 100).toFixed(1)}` : undefined}
                    subColor="var(--loss)" />
                </div>
              )}

              {/* R:R + skor + bileşenler */}
              <div style={{ display: 'flex', gap: 'var(--space-3)', fontSize: 'var(--text-xs)',
                color: 'var(--text-secondary)', flexWrap: 'wrap', alignItems: 'center' }}>
                {o.riskRewardRatio != null && (
                  <span>R:R <strong style={{
                    color: o.riskRewardRatio >= 1.5 ? 'var(--profit)' : 'var(--warning)',
                  }}>{o.riskRewardRatio.toFixed(2)}</strong></span>
                )}
                <span>Fırsat <strong style={{ color: 'var(--accent)' }}>{(score * 100).toFixed(0)}</strong></span>
                {o.regime && <span style={{ color: 'var(--text-muted)' }}>Rejim: {o.regime}</span>}
              </div>

              {/* Top driver'lar */}
              {drivers.length > 0 && (
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--space-2)' }}>
                  {drivers.map((d, i) => (
                    <div key={i} style={{ fontSize: '.72rem', color: 'var(--text-dim)', marginBottom: '.15rem' }}>
                      • {d}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function PlanCell({ label, value, sub, subColor }: {
  label: string; value: string; sub?: string; subColor?: string
}) {
  return (
    <div>
      <div style={{ color: 'var(--text-muted)', fontSize: '10px', textTransform: 'uppercase',
        letterSpacing: '.04em', marginBottom: '2px' }}>{label}</div>
      <div style={{ fontWeight: 'var(--fw-bold)', fontVariantNumeric: 'tabular-nums' }}>
        {value}
        {sub && <span style={{ color: subColor, marginLeft: '.3rem', fontSize: '.9em' }}>{sub}</span>}
      </div>
    </div>
  )
}
