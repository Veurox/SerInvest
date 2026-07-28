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
  // En güçlü önce. DİKKAT: kalibrasyon sonrası tüm AL sinyalleri aynı olasılığı
  // taşıyabiliyor (isotonic, ham p 0.35 üstünü tek değere eşliyor) — o durumda
  // bu sıralama anlamsızdır ve aşağıda kullanıcıya açıkça söylenir.
  const sorted = [...filtered].sort((a, b) => b.confidence - a.confidence)

  // Sıralama gerçekten ayrıştırıyor mu? AL sinyallerinde kaç FARKLI güven var?
  const buySignals = oracle.filter(o => o.recommendation.includes('ALIM'))
  const distinctConf = new Set(buySignals.map(o => Math.round(o.confidence * 1000))).size
  const rankingIsFlat = buySignals.length >= 3 && distinctConf === 1
  // Not: kazanç/risk yüzdeleri (eski Fırsat Radarı'nın özgün katkısı) artık
  // OracleCard içinde hedef/stop değerlerinin altında gösteriliyor.

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

      {/* Sahte sıralama uyarısı — 07/2026 denetim bulgusu.
          Kalibrasyon sonrası tüm AL sinyalleri aynı olasılığı taşıyorsa
          "en iyi fırsat" sıralaması yanıltıcıdır; bunu gizlemek yerine söylüyoruz. */}
      {rankingIsFlat && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 9, marginBottom: 'var(--space-3)',
          padding: '10px 13px', borderRadius: 5, fontSize: 12.5, lineHeight: 1.55,
          background: 'var(--warning-bg)', border: '1px solid var(--warning-border)',
          color: 'var(--text-secondary)',
        }}>
          <span style={{ color: 'var(--warning)', fontWeight: 800 }}>!</span>
          <span>
            <b style={{ color: 'var(--warning)' }}>Bu liste sıralı değil.</b>{' '}
            Model {buySignals.length} sembolde alım diyor ama hepsine{' '}
            <b>aynı olasılığı (%{(buySignals[0].confidence * 100).toFixed(0)})</b> veriyor —
            aralarında hangisinin daha iyi olduğunu ayıramıyor. Kartların sırası rastgeledir,
            üsttekiler daha iyi değildir. Ayrıştırma, haber/rejim bilgisini kullanan
            meta-model olgunlaşınca gelecek.
          </span>
        </div>
      )}

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
