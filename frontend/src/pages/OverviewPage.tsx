// =============================================================================
// SerInvest — Piyasa Genel Sayfası  (route: /)
// Ana kolon: Piyasa Nabzı · Hareket Edenler · Sektör · Isı Haritası · Liste
// Sağ sticky rail: AI Öne Çıkanlar · Son Haberler
// =============================================================================
import { useState, useEffect } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { EmptyState, Icon } from '../components/ui'
import { BistHeatmap } from '../components/finance'
import { SectorHeatmap, MarketMovers, MarketPulse, AiPicks, NewsRail } from '../components/dashboard'
import { fmt } from '../lib/format'
import { COMPANY_NAMES } from '../lib/companies'
import { useWatchlists } from '../lib/watchlists'
import { API } from '../lib/api'
import type { PriceData, PortfolioSummary } from '../lib/types'
import { AssetCard, AssetRow } from '../components/market/AssetCard'
import { DetailPanel } from '../components/market/DetailPanel'
import type { SharedData } from '../App'

type SortMode = 'default' | 'pct_desc' | 'pct_asc' | 'rsi' | 'volume'

export default function OverviewPage() {
  const { assets, oracle, news } = useOutletContext<SharedData>()

  const [selected, setSelected]         = useState<PriceData | null>(null)
  const [searchQuery, setSearchQuery]   = useState('')
  const [activeWatchlist, setActiveWatchlist] = useState<string | null>(null)
  const [newListName, setNewListName]   = useState('')
  const [showNewListInput, setShowNewListInput] = useState(false)
  const [sortMode, setSortMode]         = useState<SortMode>('default')
  const [portfolio, setPortfolio]       = useState<PortfolioSummary | null>(null)

  const [viewMode, setViewMode] = useState<'card' | 'list'>(() =>
    (localStorage.getItem('si_viewmode') as 'card' | 'list' | null) ?? 'list'
  )
  const switchView = (m: 'card' | 'list') => {
    setViewMode(m)
    localStorage.setItem('si_viewmode', m)
  }

  const { lists, createList, deleteList, toggleSymbol, isInList } = useWatchlists()

  useEffect(() => {
    fetch(`${API}/portfolio/summary`)
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setPortfolio(d))
      .catch(() => {})
  }, [])

  const bist      = assets.filter(a => a.assetType === 'BIST')
  const commodity = assets.filter(a => a.assetType === 'COMMODITY')
  const forex     = assets.filter(a => a.assetType === 'FOREX')

  const activeWlSymbols = activeWatchlist
    ? lists.find(l => l.id === activeWatchlist)?.symbols ?? []
    : null

  const applyFilters = (arr: PriceData[]) => {
    let r = activeWlSymbols ? arr.filter(a => activeWlSymbols.includes(a.symbol)) : arr
    const q = searchQuery.trim().toLowerCase()
    if (q) r = r.filter(a => a.symbol.toLowerCase().includes(q) || (COMPANY_NAMES[a.symbol] ?? '').toLowerCase().includes(q))
    return r
  }

  const applySort = (arr: PriceData[]) => {
    if (sortMode === 'default') return arr
    return [...arr].sort((a, b) => {
      const pctA = a.open && a.close ? (a.close - a.open) / a.open * 100 : 0
      const pctB = b.open && b.close ? (b.close - b.open) / b.open * 100 : 0
      if (sortMode === 'pct_desc') return pctB - pctA
      if (sortMode === 'pct_asc')  return pctA - pctB
      if (sortMode === 'rsi')      return (b.rsi ?? 50) - (a.rsi ?? 50)
      if (sortMode === 'volume')   return (b.volume ?? 0) - (a.volume ?? 0)
      return 0
    })
  }

  const fBist      = applySort(applyFilters(bist))
  const fCommodity = applySort(applyFilters(commodity))
  const fForex     = applySort(applyFilters(forex))

  const selectSymbol = (sym: string) => {
    const a = assets.find(x => x.symbol === sym)
    if (a) setSelected(prev => prev?.symbol === sym ? null : a)
  }

  const showDashboard = !searchQuery && activeWatchlist === null

  const StarAction = (a: PriceData, e: React.MouseEvent) => {
    e.stopPropagation()
    if (activeWatchlist) toggleSymbol(activeWatchlist, a.symbol)
    else if (lists.length === 0) createList('Favorilerim')
    else toggleSymbol(lists[0].id, a.symbol)
  }
  const isStarred = (a: PriceData) =>
    activeWatchlist ? isInList(activeWatchlist, a.symbol) : lists.some(l => l.symbols.includes(a.symbol))

  return (
    <div className="ov-layout">
      {/* ══════════════ ANA KOLON ══════════════ */}
      <div className="ov-main">

        {/* Dashboard bloğu — yalnızca arama/liste filtresi yokken */}
        {showDashboard && assets.length > 0 && (
          <>
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <MarketPulse assets={assets} />
            </div>
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <MarketMovers assets={assets} onSelect={selectSymbol} />
            </div>
            <SectorHeatmap assets={assets} onSelect={selectSymbol} />
          </>
        )}

        {/* Arama + Sırala + Görünüm */}
        <div style={{ marginBottom: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: 360 }}>
            <span style={{ position: 'absolute', left: '.75rem', top: '50%', transform: 'translateY(-50%)',
              color: 'var(--text-muted)', pointerEvents: 'none' }}>
              <Icon name="search" size={14} />
            </span>
            <input
              type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              placeholder="Hisse ara (örn. AKBNK, Garanti)..."
              style={{ width: '100%', padding: '.5rem 2rem .5rem 2.2rem',
                background: 'var(--bg-surface-2)', border: '1px solid var(--border-strong)',
                borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)',
                fontSize: 'var(--text-sm)', outline: 'none' }}
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')}
                style={{ position: 'absolute', right: '.5rem', top: '50%', transform: 'translateY(-50%)',
                  background: 'transparent', border: 'none', color: 'var(--text-muted)',
                  cursor: 'pointer', padding: '.2rem .4rem' }}>×</button>
            )}
          </div>

          {!searchQuery && (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {([
                { k: 'default' as SortMode, label: 'Varsayılan' },
                { k: 'pct_desc' as SortMode, label: '▲ %' },
                { k: 'pct_asc' as SortMode, label: '▼ %' },
                { k: 'rsi' as SortMode, label: 'RSI' },
                { k: 'volume' as SortMode, label: 'Hacim' },
              ]).map(({ k, label }) => (
                <button key={k} onClick={() => setSortMode(k)}
                  className={`fpill${sortMode === k ? ' on' : ''}`}
                  style={{ fontSize: 10, padding: '2px 8px' }}>{label}</button>
              ))}
            </div>
          )}

          <div className="view-toggle" style={{ marginLeft: 'auto' }}>
            <button className={`view-toggle-btn${viewMode === 'card' ? ' active' : ''}`}
              onClick={() => switchView('card')} title="Kart">⊞</button>
            <button className={`view-toggle-btn${viewMode === 'list' ? ' active' : ''}`}
              onClick={() => switchView('list')} title="Liste">≡</button>
          </div>
        </div>

        {/* İzleme Listeleri */}
        <div className="watchlist-bar" style={{ marginBottom: 'var(--space-3)' }}>
          <span className="watchlist-label">İzleme</span>
          <button className={`wl-chip${activeWatchlist === null ? ' active' : ''}`}
            onClick={() => setActiveWatchlist(null)}>
            Tümü <span style={{ fontSize: '.65rem', opacity: .7 }}>({assets.filter(a => a.assetType !== 'GLOBAL').length})</span>
          </button>
          {lists.map(l => (
            <button key={l.id} className={`wl-chip${activeWatchlist === l.id ? ' active' : ''}`}
              onClick={() => setActiveWatchlist(prev => prev === l.id ? null : l.id)}>
              ★ {l.name}
              <span style={{ fontSize: '.65rem', opacity: .7 }}> ({l.symbols.length})</span>
              <span className="wl-chip-del"
                onClick={e => { e.stopPropagation(); deleteList(l.id); if (activeWatchlist === l.id) setActiveWatchlist(null) }}
                title="Listeyi sil">✕</span>
            </button>
          ))}
          {showNewListInput ? (
            <form onSubmit={e => { e.preventDefault(); const n = newListName.trim(); if (n) { createList(n); setNewListName(''); setShowNewListInput(false) } }}
              style={{ display: 'flex', gap: '.35rem', alignItems: 'center' }} onClick={e => e.stopPropagation()}>
              <input autoFocus value={newListName} onChange={e => setNewListName(e.target.value)}
                placeholder="Liste adı..." onKeyDown={e => e.key === 'Escape' && setShowNewListInput(false)}
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)',
                  borderRadius: 999, padding: '.2rem .75rem', color: 'var(--text)', fontSize: '.76rem',
                  outline: 'none', width: 130 }} />
              <button type="submit" style={{ background: 'rgba(251,191,36,.2)', border: '1px solid rgba(251,191,36,.4)',
                borderRadius: 999, color: 'var(--accent)', fontSize: '.72rem', padding: '.2rem .65rem', cursor: 'pointer' }}>✓</button>
              <button type="button" onClick={() => setShowNewListInput(false)}
                style={{ background: 'transparent', border: '1px solid var(--border)',
                  borderRadius: 999, color: 'var(--text-muted)', fontSize: '.72rem', padding: '.2rem .65rem', cursor: 'pointer' }}>İptal</button>
            </form>
          ) : (
            <button className="wl-add-btn" onClick={() => setShowNewListInput(true)}>+ Yeni Liste</button>
          )}
        </div>

        {/* DetailPanel */}
        {selected && (
          <DetailPanel
            data={selected}
            availableSymbols={assets.filter(a => a.assetType !== 'GLOBAL').map(a => a.symbol).sort()}
          />
        )}

        {/* BistHeatmap */}
        {!activeWatchlist && !searchQuery && (
          <BistHeatmap
            assets={assets.map(a => ({ symbol: a.symbol, assetType: a.assetType, open: a.open, close: a.close, volume: a.volume }))}
            onSelect={sym => { const a = assets.find(x => x.symbol === sym); if (a) setSelected(prev => prev?.symbol === sym ? null : a) }}
          />
        )}

        {/* Boş durumlar */}
        {activeWatchlist && (activeWlSymbols?.length ?? 0) === 0 && (
          <EmptyState icon={<Icon name="list" size={28} />} title="Liste boş"
            message="Varlık kartlarındaki ☆ butonuna tıklayarak bu listeye hisse ekleyebilirsin." size="sm" />
        )}
        {searchQuery && fBist.length + fCommodity.length + fForex.length === 0 && (
          <EmptyState icon={<Icon name="search" size={28} />} title={`"${searchQuery}" için sonuç yok`}
            message="Sembol veya şirket adıyla dene (örn. AKBNK, Garanti)." size="sm" />
        )}

        {/* Hisse Listeleri */}
        {[
          { title: 'BIST Hisseleri', list: fBist },
          { title: 'Emtialar',       list: fCommodity },
          { title: 'Döviz',          list: fForex },
        ].map(({ title, list }) => list.length > 0 && (
          <div key={title} style={{ marginBottom: 'var(--space-5)' }}>
            <div className="section-head" style={{ marginBottom: viewMode === 'list' ? '.4rem' : '1rem' }}>
              <span className="section-title">{title}</span>
              <span style={{ fontSize: '.72rem', color: 'var(--text-muted)' }}>{list.length} varlık</span>
            </div>
            {viewMode === 'list' && (
              <div style={{ display: 'grid', gridTemplateColumns: '36px 1fr 110px 90px 90px 70px 30px',
                gap: '.75rem', padding: '.2rem 1rem .4rem',
                fontSize: '.65rem', fontWeight: 700, color: 'var(--text-muted)',
                textTransform: 'uppercase', letterSpacing: '.06em' }}>
                <div /><div>Sembol</div>
                <div style={{ textAlign: 'right' }}>Fiyat</div>
                <div style={{ textAlign: 'right' }}>Değişim</div>
                <div style={{ textAlign: 'center' }}>Sinyal</div>
                <div style={{ textAlign: 'right' }}>RSI</div>
                <div />
              </div>
            )}
            {viewMode === 'card' ? (
              <div className="asset-grid">
                {list.map(a => (
                  <AssetCard key={a.symbol} data={a}
                    selected={selected?.symbol === a.symbol}
                    onClick={() => setSelected(prev => prev?.symbol === a.symbol ? null : a)}
                    starred={isStarred(a)} onStar={e => StarAction(a, e)} />
                ))}
              </div>
            ) : (
              <div className="asset-list">
                {list.map(a => (
                  <AssetRow key={a.symbol} data={a}
                    selected={selected?.symbol === a.symbol}
                    onClick={() => setSelected(prev => prev?.symbol === a.symbol ? null : a)}
                    starred={isStarred(a)} onStar={e => StarAction(a, e)} />
                ))}
              </div>
            )}
          </div>
        ))}

        {/* Portföy özet satırı */}
        {portfolio && portfolio.openPositionCount > 0 && (
          <Link to="/portfolio" style={{ textDecoration: 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
              padding: 'var(--space-3) var(--space-4)', flexWrap: 'wrap',
              background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-md)', cursor: 'pointer' }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-default)')}>
              <Icon name="briefcase" size={14} style={{ color: 'var(--text-muted)' }} />
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontWeight: 'var(--fw-bold)' }}>Portföyüm</span>
              <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--fw-black)', color: 'var(--text-primary)' }}>
                {fmt(portfolio.totalCurrent, 0)} ₺
              </span>
              <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--fw-bold)',
                color: portfolio.unrealizedPnl >= 0 ? 'var(--profit)' : 'var(--loss)' }}>
                {portfolio.unrealizedPnl >= 0 ? '▲ +' : '▼ '}{fmt(Math.abs(portfolio.unrealizedPnl), 0)} ₺
                {' '}({portfolio.unrealizedPnlPct >= 0 ? '+' : ''}{(portfolio.unrealizedPnlPct * 100).toFixed(2)}%)
              </span>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                {portfolio.openPositionCount} pozisyon →
              </span>
            </div>
          </Link>
        )}

        {assets.length === 0 && (
          <div className="empty">
            <p>Henüz piyasa verisi yok.</p>
            <p style={{ marginTop: '.5rem', fontSize: '.8rem' }}>market-data-service başlatıldıktan ~5 dakika sonra görünecektir.</p>
          </div>
        )}
      </div>

      {/* ══════════════ SAĞ RAIL ══════════════ */}
      <aside className="ov-rail">
        <AiPicks oracle={oracle} onSelect={selectSymbol} />
        <NewsRail news={news} />
      </aside>
    </div>
  )
}
