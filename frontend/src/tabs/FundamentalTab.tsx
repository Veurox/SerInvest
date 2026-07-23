// =============================================================================
// SerInvest — Temel Analiz Sekmesi
// Sıralanabilir/filtrelenebilir temel analiz tablosu (F/K, ROE, FAVÖK vb.).
// =============================================================================
import { useState } from 'react'
import { EmptyState, Icon } from '../components/ui'
import type { FundamentalData } from '../lib/types'
import { COMPANY_NAMES } from '../lib/companies'

export function FundamentalTab({ data }: { data: FundamentalData[] }) {
  const [sortKey, setSortKey] = useState<keyof FundamentalData>('fundamentalScore')
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc')
  const [filter, setFilter]   = useState<'TÜM' | 'GÜÇLÜ' | 'NÖTR' | 'ZAYIF'>('TÜM')
  const [search, setSearch]   = useState('')

  if (data.length === 0) {
    return (
      <EmptyState
        icon={<Icon name="fundamental" size={28} />}
        title="Temel analiz verisi henüz yok"
        message="fundamental-service başlatıldıktan ~2 dakika sonra görünecektir."
      />
    )
  }

  const pct  = (v: number | null) => v == null ? '—' : `${(v * 100).toFixed(1)}%`
  const num  = (v: number | null, d = 2) => v == null ? '—' : v.toFixed(d)
  const mcap = (v: number | null) => {
    if (v == null) return '—'
    if (v >= 1e12) return `${(v / 1e12).toFixed(2)}T`
    if (v >= 1e9)  return `${(v / 1e9).toFixed(1)}B`
    if (v >= 1e6)  return `${(v / 1e6).toFixed(0)}M`
    return v.toFixed(0)
  }

  const scoreColor = (s: number) =>
    s >= 0.65 ? '#22c55e' : s >= 0.45 ? '#94a3b8' : '#ef4444'

  const toggle = (key: keyof FundamentalData) => {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const filtered = data.filter(d => {
    const passesFilter =
      filter === 'TÜM'   ? true :
      filter === 'GÜÇLÜ' ? d.fundamentalScore >= 0.60 :
      filter === 'ZAYIF' ? d.fundamentalScore <= 0.40 :
      d.fundamentalScore > 0.40 && d.fundamentalScore < 0.60
    if (!passesFilter) return false

    const q = search.trim().toLowerCase()
    if (!q) return true
    const symMatch  = d.symbol.toLowerCase().includes(q)
    const nameMatch = (d.companyName || COMPANY_NAMES[d.symbol] || '').toLowerCase().includes(q)
    return symMatch || nameMatch
  })

  const sorted = [...filtered].sort((a, b) => {
    const va = (a[sortKey] as number) ?? (sortDir === 'desc' ? -Infinity : Infinity)
    const vb = (b[sortKey] as number) ?? (sortDir === 'desc' ? -Infinity : Infinity)
    return sortDir === 'desc' ? vb - va : va - vb
  })

  const Th = ({ label, k }: { label: string; k: keyof FundamentalData }) => (
    <th onClick={() => toggle(k)} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
      {label} {sortKey === k ? (sortDir === 'desc' ? '▼' : '▲') : ''}
    </th>
  )

  return (
    <div>
      {/* Search Bar */}
      <div style={{ marginBottom: 'var(--space-3)', position: 'relative', maxWidth: '420px' }}>
        <span style={{
          position: 'absolute', left: 'var(--space-3)', top: '50%', transform: 'translateY(-50%)',
          color: 'var(--text-muted)', fontSize: 'var(--text-base)', pointerEvents: 'none',
      }}><Icon name="search" size={15} /></span>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Hisse veya şirket ara..."
          style={{
            width: '100%',
            padding: '.6rem 2.4rem .6rem 2.4rem',
            background: 'var(--bg-surface-2)',
            border: '1px solid var(--border-strong)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--text-primary)',
            fontSize: 'var(--text-sm)',
            outline: 'none',
          }}
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            style={{
              position: 'absolute', right: 'var(--space-2)', top: '50%', transform: 'translateY(-50%)',
              background: 'transparent', border: 'none', color: 'var(--text-muted)',
              fontSize: 'var(--text-base)', cursor: 'pointer', padding: '.25rem .5rem',
            }}
            title="Aramayı temizle"
          >×</button>
        )}
      </div>

      {/* Filtreler */}
      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginBottom: 'var(--space-4)' }}>
        {(['TÜM', 'GÜÇLÜ', 'NÖTR', 'ZAYIF'] as const).map(f => (
          <button key={f} className={`fpill${filter === f ? ' on' : ''}`} onClick={() => setFilter(f)}>
            {f === 'GÜÇLÜ' ? 'Güçlü (>60%)' : f === 'NÖTR' ? 'Nötr' : f === 'ZAYIF' ? 'Zayıf (<40%)' : 'TÜM'}
          </button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 'var(--text-xs)', color: 'var(--text-muted)', alignSelf: 'center' }}>
          {sorted.length} varlık {search && `(${search} araması)`}
        </span>
      </div>

      {/* Tablo */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{
          width: '100%', borderCollapse: 'collapse', fontSize: '.8rem',
        }}>
          <thead>
            <tr style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
              <th style={{ padding: '.5rem .75rem' }}>Sembol</th>
              <Th label="Temel Skor" k="fundamentalScore" />
              <Th label="F/K" k="peRatio" />
              <Th label="PD/DD" k="pbRatio" />
              <Th label="ROE" k="roe" />
              <Th label="FAVÖK Marjı" k="ebitdaMargin" />
              <Th label="Net Borç/FAVÖK" k="netDebtEbitda" />
              <Th label="Borç/Özkaynak" k="debtToEquity" />
              <Th label="Gelir Büyüme" k="revenueGrowth" />
              <Th label="Temettü" k="dividendYield" />
              <Th label="Piy. Değeri" k="marketCap" />
              <Th label="Beta" k="beta" />
              <th style={{ whiteSpace: 'nowrap' }}>52H Konum</th>
              <th>Son KAP</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(d => (
              <tr key={d.id} style={{ borderBottom: '1px solid var(--border)', transition: 'background .1s' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                  onMouseLeave={e => (e.currentTarget.style.background = '')}>
                <td style={{ padding: '.5rem .75rem', fontWeight: 700 }}>
                  {d.symbol}
                  {d.sector && <div style={{ fontSize: '.65rem', color: 'var(--text-muted)', fontWeight: 400 }}>{d.sector}</div>}
                </td>
                {/* Temel Skor */}
                <td style={{ padding: '.5rem .75rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                    <div style={{ width: '48px', height: '6px', background: 'var(--border)', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${d.fundamentalScore * 100}%`, background: scoreColor(d.fundamentalScore), borderRadius: '3px' }} />
                    </div>
                    <span style={{ color: scoreColor(d.fundamentalScore), fontWeight: 700 }}>
                      {(d.fundamentalScore * 100).toFixed(0)}%
                    </span>
                  </div>
                </td>
                <td style={{ padding: '.5rem .75rem', color: d.peRatio != null && d.peRatio < 15 ? '#22c55e' : d.peRatio != null && d.peRatio > 30 ? '#ef4444' : 'inherit' }}>
                  {num(d.peRatio, 1)}
                </td>
                <td style={{ padding: '.5rem .75rem', color: d.pbRatio != null && d.pbRatio < 1 ? '#22c55e' : 'inherit' }}>
                  {num(d.pbRatio, 2)}
                </td>
                <td style={{ padding: '.5rem .75rem', color: d.roe != null && d.roe > 0.15 ? '#22c55e' : d.roe != null && d.roe < 0 ? '#ef4444' : 'inherit' }}>
                  {pct(d.roe)}
                </td>
                {/* FAVÖK Marjı */}
                <td style={{ padding: '.5rem .75rem', color: d.ebitdaMargin != null && d.ebitdaMargin > 0.20 ? '#22c55e' : d.ebitdaMargin != null && d.ebitdaMargin < 0.05 ? '#ef4444' : 'inherit' }}>
                  {pct(d.ebitdaMargin)}
                </td>
                {/* Net Borç / FAVÖK */}
                <td style={{ padding: '.5rem .75rem', color: d.netDebtEbitda != null && d.netDebtEbitda < 0 ? '#22c55e' : d.netDebtEbitda != null && d.netDebtEbitda > 3 ? '#ef4444' : 'inherit' }}>
                  {d.netDebtEbitda != null ? `${d.netDebtEbitda.toFixed(1)}x` : '—'}
                </td>
                <td style={{ padding: '.5rem .75rem', color: d.debtToEquity != null && d.debtToEquity > 1.5 ? '#ef4444' : 'inherit' }}>
                  {num(d.debtToEquity, 2)}
                </td>
                <td style={{ padding: '.5rem .75rem', color: d.revenueGrowth != null && d.revenueGrowth > 0.1 ? '#22c55e' : d.revenueGrowth != null && d.revenueGrowth < 0 ? '#ef4444' : 'inherit' }}>
                  {pct(d.revenueGrowth)}
                </td>
                <td style={{ padding: '.5rem .75rem', color: d.dividendYield != null && d.dividendYield > 0.04 ? '#22c55e' : 'inherit' }}>
                  {pct(d.dividendYield)}
                </td>
                <td style={{ padding: '.5rem .75rem', color: 'var(--text-dim)' }}>
                  {mcap(d.marketCap)}
                </td>
                <td style={{ padding: '.5rem .75rem' }}>
                  {num(d.beta, 2)}
                </td>
                {/* 52 Haftalık Konum */}
                <td style={{ padding: '.5rem .75rem' }}>
                  {d.position52W != null ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '.35rem' }}>
                      <div style={{ width: '36px', height: '4px', background: 'var(--border)', borderRadius: '2px', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${d.position52W * 100}%`, background: d.position52W < 0.3 ? '#22c55e' : d.position52W > 0.7 ? '#ef4444' : '#94a3b8', borderRadius: '2px' }} />
                      </div>
                      <span style={{ fontSize: '.7rem', color: 'var(--text-muted)' }}>
                        {(d.position52W * 100).toFixed(0)}%
                      </span>
                    </div>
                  ) : '—'}
                </td>
                {/* KAP */}
                <td style={{ padding: '.5rem .75rem', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {d.lastKapTitle ? (
                    <span title={d.lastKapTitle} style={{ color: 'var(--text-muted)', fontSize: '.72rem' }}>
                      {d.lastKapTitle.substring(0, 35)}{d.lastKapTitle.length > 35 ? '…' : ''}
                    </span>
                  ) : <span style={{ color: 'var(--text-muted)', fontSize: '.72rem' }}>—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {sorted.length === 0 && (
          <EmptyState
            icon={<Icon name="search" size={28} />}
            title={search ? `"${search}" için sonuç yok` : 'Filtreyle eşleşen kayıt yok'}
            message="Filtreyi değiştir veya aramayı temizle."
            size="sm"
          />
        )}
      </div>

      <div style={{
        marginTop: 'var(--space-4)', fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
        borderTop: '1px solid var(--border-default)', paddingTop: 'var(--space-3)',
      }}>
        Temel veriler yfinance aracılığıyla 15 dk gecikmeli alınmaktadır. Yatırım kararı vermeden önce doğrulayınız. Bu bir yatırım tavsiyesi değildir.
      </div>
    </div>
  )
}

export default FundamentalTab
