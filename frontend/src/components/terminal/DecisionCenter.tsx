// =============================================================================
// Terminal — Yapay Zeka Karar Merkezi
// Seçili sembolün son Oracle kararı: öneri + kalibre güven + sürücüler/riskler.
// Altta AL sinyali listesi (güven sıralı) — tık → sembol seçimi + grafik.
// =============================================================================
import { useMemo } from 'react'
import type { OracleAnalysis } from '../../lib/types'

interface Props {
  oracle: OracleAnalysis[]
  selected: string
  onSelect: (symbol: string) => void
}

const px = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function parseJsonList(s: string): string[] {
  try {
    const v = JSON.parse(s)
    return Array.isArray(v) ? v.map(String) : []
  } catch { return [] }
}

/** Sembol başına EN YENİ analiz. */
export function latestBySymbol(oracle: OracleAnalysis[]): Map<string, OracleAnalysis> {
  const m = new Map<string, OracleAnalysis>()
  for (const o of oracle) {
    const prev = m.get(o.symbol)
    if (!prev || o.analyzedAt > prev.analyzedAt) m.set(o.symbol, o)
  }
  return m
}

export function DecisionCenter({ oracle, selected, onSelect }: Props) {
  const latest = useMemo(() => latestBySymbol(oracle), [oracle])
  const cur = latest.get(selected) ?? null

  const buys = useMemo(() =>
    [...latest.values()]
      .filter(o => o.recommendation.includes('ALIM'))
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 6),
    [latest])

  const isBuy = !!cur && cur.recommendation.includes('ALIM')
  const badgeCls = isBuy ? 't-decision__badge--buy'
    : cur?.recommendation === 'SAT' ? 't-decision__badge--sell' : 't-decision__badge--neutral'

  const drivers = cur ? parseJsonList(cur.keyDrivers).slice(0, 3) : []
  const risks   = cur ? parseJsonList(cur.risks).slice(0, 2) : []
  const confPct = cur ? Math.round(cur.confidence * 100) : 0

  return (
    <section className="t-panel t-area-decision" aria-label="Yapay zeka karar merkezi">
      <div className="t-panel__head">
        <span className="t-panel__title">AI Karar Merkezi</span>
        <span className="t-panel__meta t-num">
          {cur ? (() => {
            // analyzedAt bazen zaten Z/offset içerir — çift eklemek Invalid Date üretir
            const iso = /[zZ]$|[+-]\d\d:?\d\d$/.test(cur.analyzedAt) ? cur.analyzedAt : cur.analyzedAt + 'Z'
            const d = new Date(iso)
            return isNaN(d.getTime()) ? '' : d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
          })() : ''}
        </span>
      </div>

      <div className="t-panel__body" style={{ paddingBottom: 4 }}>
        {!cur ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '12px 0' }}>
            {selected} için analiz bekleniyor…
          </div>
        ) : (
          <>
            <div className="t-decision__rec">
              <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: '0.02em' }}>{cur.symbol}</span>
              <span className={`t-decision__badge ${badgeCls}`}>{cur.recommendation}</span>
              <span className="t-num" style={{ marginLeft: 'auto', fontSize: 14 }}>
                {cur.priceAtAnalysis != null ? `₺${px.format(cur.priceAtAnalysis)}` : ''}
              </span>
            </div>

            {/* Kalibre güven — dürüst olasılık (Faz 2) */}
            <div style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: 'var(--text-muted)' }}>
                <span>KALİBRE GÜVEN (10 GÜN)</span>
                <span className="t-num" style={{ color: 'var(--text-primary)', fontWeight: 700 }}>%{confPct}</span>
              </div>
              <div className="t-confbar">
                <div className="t-confbar__fill" style={{ width: `${Math.min(100, confPct)}%` }} />
              </div>
            </div>

            {/* Hedef / Stop / R:R — eğitimle aynı triple-barrier tanımı */}
            {isBuy && (
              <div style={{ display: 'flex', gap: 14, fontSize: 12, marginBottom: 8 }} className="t-num">
                <span>H: <b className="t-up">{cur.shortTermTarget != null ? px.format(cur.shortTermTarget) : '—'}</b></span>
                <span>S: <b className="t-down">{cur.shortTermStop != null ? px.format(cur.shortTermStop) : '—'}</b></span>
                <span>R:R <b>{cur.riskRewardRatio ?? '—'}</b></span>
                {cur.positionSizePct != null && cur.positionSizePct > 0 && (
                  <span>Boyut <b>%{(cur.positionSizePct * 100).toFixed(1)}</b></span>
                )}
              </div>
            )}

            <div style={{ marginBottom: 2 }}>
              {drivers.map((d, i) => <span key={`d${i}`} className="t-chip t-chip--pos">▲ {d}</span>)}
              {risks.map((r, i) => <span key={`r${i}`} className="t-chip t-chip--neg">▼ {r}</span>)}
            </div>
          </>
        )}
      </div>

      {/* AL sinyalleri — güven sıralı hızlı erişim */}
      <div className="t-panel__head" style={{ borderTop: '1px solid var(--border-subtle)' }}>
        <span className="t-panel__title">Aktif AL Sinyalleri</span>
        <span className="t-panel__meta">{buys.length}</span>
      </div>
      <div className="t-siglist">
        {buys.length === 0 && (
          <div style={{ padding: '8px 10px', fontSize: 11.5, color: 'var(--text-muted)' }}>
            Aktif AL sinyali yok — model NÖTR modda.
          </div>
        )}
        {buys.map(o => (
          <div key={o.symbol}
               className={`t-sigrow ${o.symbol === selected ? 't-sigrow--active' : ''}`}
               onClick={() => onSelect(o.symbol)}>
            <span style={{ fontWeight: 700 }}>{o.symbol}</span>
            <span style={{ color: 'var(--text-muted)', fontSize: 10.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {o.recommendation}
            </span>
            <span className="t-num" style={{ textAlign: 'right' }}>
              {o.priceAtAnalysis != null ? px.format(o.priceAtAnalysis) : '—'}
            </span>
            <span className="t-num t-up" style={{ textAlign: 'right', fontWeight: 700 }}>
              %{Math.round(o.confidence * 100)}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}
