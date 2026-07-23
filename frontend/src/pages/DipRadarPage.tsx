// =============================================================================
// SerInvest — Dip Fırsat Radarı  (route: /dip-radar)
// Düşüşteki BIST hisselerini 5 uzman kapısıyla tarar, fırsat skoru verir.
// Kural-tabanlı yardımcı (ML değil): "şu hisseye bak" der, "al" demez.
// =============================================================================
import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { PageHeader, EmptyState, Icon, KPI } from '../components/ui'
import { CompanyLogo } from '../components/common/CompanyLogo'
import { fmt } from '../lib/format'
import { COMPANY_NAMES } from '../lib/companies'
import { API } from '../lib/api'
import { scoreDip, isDipCandidate, type DipScore, type ChartPoint } from '../lib/dipDetector'
import type { PriceData } from '../lib/types'
import type { SharedData } from '../App'

interface Result { asset: PriceData; dip: DipScore }

// Eşzamanlılık sınırlı havuz
async function pool<T>(items: T[], worker: (t: T) => Promise<void>, size = 5) {
  let i = 0
  const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await worker(items[idx]) }
  })
  await Promise.all(runners)
}

const scoreColor = (s: number) =>
  s >= 5 ? 'var(--profit)' : s === 4 ? 'var(--profit)' : s === 3 ? 'var(--warning)' : 'var(--text-muted)'

export default function DipRadarPage() {
  const { assets, openChart } = useOutletContext<SharedData>()
  const [scanning, setScanning] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [results, setResults] = useState<Result[]>([])
  const [scanned, setScanned] = useState(false)

  const scan = async () => {
    setScanning(true); setScanned(false); setResults([])
    const candidates = assets.filter(isDipCandidate)
    setProgress({ done: 0, total: candidates.length })
    const found: Result[] = []
    let done = 0

    await pool(candidates, async (a) => {
      try {
        const r = await fetch(`${API}/market/${encodeURIComponent(a.symbol)}/chart?tf=1Y`)
        if (r.ok) {
          const data = await r.json()
          const points: ChartPoint[] = data.points ?? []
          const dip = scoreDip(points, a)
          if (dip && dip.score >= 3) found.push({ asset: a, dip })
        }
      } catch { /* sembolü atla */ }
      done++; setProgress({ done, total: candidates.length })
    }, 5)

    found.sort((x, y) => y.dip.score - x.dip.score || y.dip.pullbackPct - x.dip.pullbackPct)
    setResults(found)
    setScanning(false)
    setScanned(true)
  }

  const strong = results.filter(r => r.dip.score >= 4).length

  return (
    <div style={{ paddingTop: 'var(--space-2)' }}>
      <PageHeader
        icon={<Icon name="trending-down" size={20} />}
        title="Dip Fırsat Radarı"
        subtitle={<>Yükseliş trendinde düşüşe geçen hisseleri 5 uzman kapısıyla tarar <span className="tech-tag" style={{ marginLeft: 6 }}>● kural-tabanlı</span></>}
        right={
          <button className="fpill on" onClick={scan} disabled={scanning}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 12px' }}>
            <Icon name="refresh" size={13} /> {scanning ? `Taranıyor ${progress.done}/${progress.total}` : 'Tara'}
          </button>
        }
      />

      {/* Uyarı */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: 'var(--space-3) var(--space-4)',
        background: 'var(--warning-bg)', border: '1px solid var(--warning-border)', borderRadius: 'var(--radius-md)',
        marginBottom: 'var(--space-4)', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
        <Icon name="alert" size={14} style={{ color: 'var(--warning)', marginTop: 1, flexShrink: 0 }} />
        <span>Bu bir <strong>kural-tabanlı yardımcıdır</strong>, garanti vermez. Yüksek skor olasılığı artırır ama dönüş teyidi ve <strong>stop her zaman şarttır</strong>. Skor = 5 kapıdan kaçının geçtiği.</span>
      </div>

      {/* Skor açıklaması */}
      {scanned && results.length > 0 && (
        <div className="kpi-strip" style={{ marginBottom: 'var(--space-4)' }}>
          <KPI label="Fırsat Adayı" value={results.length} tone="neutral" icon={<Icon name="target" size={14} />} />
          <KPI label="Güçlü (4-5/5)" value={strong} tone={strong > 0 ? 'profit' : 'neutral'} icon="★" />
          <KPI label="Taranan Hisse" value={progress.total} tone="info" icon={<Icon name="search" size={14} />} />
        </div>
      )}

      {/* İlk durum */}
      {!scanned && !scanning && (
        <EmptyState icon={<Icon name="trending-down" size={28} />} title="Taramaya hazır"
          message="“Tara” ile yükseliş trendindeki düşüşe geçmiş BIST hisseleri 5 kapıdan geçirilir: Trend · Destek · Uyumsuzluk · Hacim doruğu · Dönüş mumu."
          size="sm" />
      )}

      {/* Sonuç yok */}
      {scanned && results.length === 0 && (
        <EmptyState icon={<Icon name="search" size={28} />} title="Şu an nitelikli dip fırsatı yok"
          message="Hiçbir hisse 3+/5 kapı geçmedi. Düşüş rejiminde bu normaldir — fırsat, dönüş sinyalleri hizalandığında doğar."
          size="sm" />
      )}

      {/* Sonuç kartları */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))', gap: 'var(--space-3)' }}>
        {results.map(({ asset, dip }) => {
          const dec = 2
          return (
            <div key={asset.symbol}
              onClick={() => openChart(asset.symbol)}
              title={`${asset.symbol} grafiğini aç`}
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)', cursor: 'pointer',
              transition: 'border-color var(--transition-fast), transform var(--transition-fast)' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.transform = 'translateY(-2px)' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-default)'; e.currentTarget.style.transform = 'translateY(0)' }}>
              {/* Başlık */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 'var(--space-3)' }}>
                <CompanyLogo symbol={asset.symbol} size={32} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 'var(--text-md)', fontWeight: 'var(--fw-black)' }}>{asset.symbol}</div>
                  {COMPANY_NAMES[asset.symbol] && (
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {COMPANY_NAMES[asset.symbol]}
                    </div>
                  )}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--fw-black)', color: scoreColor(dip.score), lineHeight: 1 }}>
                    {dip.score}<span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>/5</span>
                  </div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: scoreColor(dip.score), textTransform: 'uppercase', letterSpacing: '.03em' }}>{dip.label}</div>
                </div>
              </div>

              {/* Fiyat + pullback */}
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 'var(--space-3)' }}>
                <span style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--fw-bold)', fontVariantNumeric: 'tabular-nums' }}>{fmt(dip.entry, dec)}</span>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--loss)', fontWeight: 700 }}>
                  ▼ tepeden %{(dip.pullbackPct * 100).toFixed(1)}
                </span>
              </div>

              {/* 5 kapı */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 'var(--space-3)' }}>
                {dip.gates.map(g => (
                  <span key={g.id} title={g.detail}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 700,
                      padding: '2px 7px', borderRadius: 'var(--radius-full)', cursor: 'help',
                      background: g.pass ? 'var(--profit-bg)' : 'var(--bg-surface-2)',
                      color: g.pass ? 'var(--profit)' : 'var(--text-disabled)',
                      border: `1px solid ${g.pass ? 'var(--profit-border, transparent)' : 'var(--border-subtle)'}` }}>
                    {g.pass ? '✓' : '✗'} {g.name}
                  </span>
                ))}
              </div>

              {/* Stop / Hedef / R:R */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                {[
                  { k: 'Stop', v: fmt(dip.stop, dec), c: 'var(--loss)' },
                  { k: 'Hedef (2R)', v: fmt(dip.target, dec), c: 'var(--profit)' },
                  { k: 'R:R', v: dip.rr.toFixed(1), c: 'var(--text-primary)' },
                ].map(({ k, v, c }) => (
                  <div key={k} style={{ background: 'var(--bg-surface-2)', borderRadius: 'var(--radius-sm)', padding: '6px 8px' }}>
                    <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.03em', fontWeight: 700 }}>{k}</div>
                    <div style={{ fontSize: 'var(--text-sm)', fontWeight: 800, color: c, fontVariantNumeric: 'tabular-nums' }}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
