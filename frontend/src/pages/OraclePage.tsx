// =============================================================================
// SerInvest — AI Tavsiye Sayfası  (route: /oracle)
// Saf teknik ml v3 (BIST-50, 10g) tavsiyeleri — long-only: GÜÇLÜ ALIM / ALIM / NÖTR.
// Özet KPI'lar + filtre + kart grid.
// =============================================================================
import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { PageHeader, KPI, EmptyState, Icon } from '../components/ui'
import { OracleCard } from '../components/market/OracleCard'
import type { SharedData } from '../App'
import { downloadCsv, fmt } from '../lib/format'

// Long-only sistem: SELL (KAÇIN) yok.
const FILTERS = ['TÜM', 'GÜÇLÜ ALIM', 'ALIM', 'NÖTR']

export default function OraclePage() {
  const { oracle } = useOutletContext<SharedData>()
  const [filter, setFilter] = useState<string>('TÜM')

  const strongBuy = oracle.filter(o => o.recommendation === 'GÜÇLÜ ALIM').length
  const buy       = oracle.filter(o => o.recommendation === 'ALIM').length
  const neutral   = oracle.filter(o => o.recommendation === 'NÖTR').length
  const buyAll    = strongBuy + buy
  const avgConf   = buyAll > 0
    ? oracle.filter(o => o.recommendation.includes('ALIM'))
        .reduce((s, o) => s + o.confidence, 0) / buyAll
    : 0

  const filtered = filter === 'TÜM' ? oracle : oracle.filter(o => o.recommendation === filter)
  // En güçlü önce
  const sorted = [...filtered].sort((a, b) => b.confidence - a.confidence)

  const handleDownload = () => {
    downloadCsv(
      ['Sembol', 'Tavsiye', 'Güven', 'Mevcut Fiyat', 'Hedef', 'Stop', 'R:R', 'Analiz Tarihi'],
      oracle.map(o => [
        o.symbol,
        o.recommendation,
        `${(o.confidence * 100).toFixed(1)}%`,
        fmt(o.priceAtAnalysis),
        fmt(o.shortTermTarget ?? null),
        fmt(o.shortTermStop ?? null),
        o.riskRewardRatio?.toFixed(2) ?? '—',
        o.analyzedAt ?? '',
      ]),
      `serinvest_oracle_${new Date().toISOString().slice(0, 10)}.csv`
    )
  }

  return (
    <div style={{ paddingTop: 'var(--space-2)' }}>
      <PageHeader
        icon={<Icon name="sparkle" size={20} />}
        title="AI Tavsiye"
        subtitle={<>BIST-50 · saf teknik model · 10 işlem-günü ufku <span className="tech-tag" style={{ marginLeft: 6 }}>● saf teknik</span></>}
        right={
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: 'var(--space-1)', flexWrap: 'wrap' }}>
              {FILTERS.map(f => (
                <button key={f} className={`fpill${filter === f ? ' on' : ''}`} onClick={() => setFilter(f)}>{f}</button>
              ))}
            </div>
            {oracle.length > 0 && (
              <button onClick={handleDownload} className="fpill" title="CSV olarak indir"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Icon name="download" size={12} /> CSV
              </button>
            )}
          </div>
        }
      />

      <div className="kpi-strip">
        <KPI label="Güçlü Alım" value={strongBuy} tone={strongBuy > 0 ? 'profit' : 'neutral'} icon={<Icon name="trending-up" size={14} />} />
        <KPI label="Alım" value={buy} tone={buy > 0 ? 'profit' : 'neutral'} icon="▲" />
        <KPI label="Nötr (izle)" value={neutral} tone="neutral" icon="●" />
        <KPI label="Ort. Alım Güveni" value={buyAll > 0 ? `%${(avgConf * 100).toFixed(0)}` : '—'} tone="accent" icon="◷" />
      </div>

      {sorted.length === 0 ? (
        <EmptyState
          icon={<Icon name={oracle.length === 0 ? 'clock' : 'search'} size={28} />}
          title={oracle.length === 0 ? 'Analiz bekleniyor' : 'Bu filtreye uygun sonuç yok'}
          message={oracle.length === 0
            ? 'Model ilk analiz turunu çalıştırıyor — birkaç dakika içinde gelecek.'
            : 'Düşüş rejiminde alım sinyali az olur; bu normaldir. Filtreyi "TÜM" yap.'}
          size="sm"
        />
      ) : (
        <div className="oracle-grid">
          {sorted.map(o => <OracleCard key={o.id} data={o} />)}
        </div>
      )}
    </div>
  )
}
