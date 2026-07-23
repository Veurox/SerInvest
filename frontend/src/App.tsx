// =============================================================================
// SerInvest — Layout (header + navigasyon + ortak veri)
// React Router ile sayfalara bölünmüş yapının kök layout'u.
// Ortak veri (assets/oracle/news/fundamentals/status) <Outlet context> ile geçer.
// =============================================================================
import { useEffect, useState, useCallback, useRef } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { CommandPalette, Icon } from './components/ui'
import type { Command, IconName } from './components/ui'
import { MacroTicker, DriftBadge } from './components/finance'
import { WatchlistSidebar } from './components/watchlist/WatchlistSidebar'
import { SymbolDrawer } from './components/watchlist/SymbolDrawer'
import { API, getAdminKey, adminFetch } from './lib/api'
import type {
  SystemStatus, PriceData, NewsSignal, OracleAnalysis, FundamentalData,
} from './lib/types'
import { StatusBanner } from './components/common/StatusBanner'
import { Logo } from './components/common/Logo'
import { isMarketOpen } from './lib/format'

// ── Outlet Context — sayfalar bu ortak veriyi useOutletContext ile alır ──────
export interface SharedData {
  assets: PriceData[]
  oracle: OracleAnalysis[]
  news: NewsSignal[]
  fundamentals: FundamentalData[]
  sysStatus: SystemStatus | null
  openChart: (symbol: string) => void   // sembolün grafik drawer'ını açar
}

// Route sırası — klavye kısayolları (1-8) bu sırayı kullanır.
const ROUTES = ['/', '/radar', '/oracle', '/portfolio', '/history', '/news', '/fundamental', '/mlops', '/model-portfoy', '/degerlendirme', '/dip-radar']

export default function App() {
  const navigate = useNavigate()

  const [assets, setAssets]             = useState<PriceData[]>([])
  const [oracle, setOracle]             = useState<OracleAnalysis[]>([])
  const [news, setNews]                 = useState<NewsSignal[]>([])
  const [fundamentals, setFundamentals] = useState<FundamentalData[]>([])
  const [loading, setLoading]           = useState(true)
  const [startupMsg, setStartupMsg]     = useState('Sistem başlatılıyor...')
  const [lastUpdate, setLastUpdate]     = useState('')
  const [sysStatus, setSysStatus]       = useState<SystemStatus | null>(null)
  const [paletteOpen, setPaletteOpen]   = useState(false)
  const [marketOpen, setMarketOpen]     = useState(isMarketOpen())
  const seenOracleIds = useRef<Set<string>>(
    new Set(JSON.parse(localStorage.getItem('si_seen_oracle') ?? '[]') as string[])
  )

  // ── Sol izleme listesi paneli + sembol grafik drawer'ı ──────────────────────
  const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem('si_wl_open') !== '0')
  const [chartSymbol, setChartSymbol] = useState<string | null>(null)
  useEffect(() => { localStorage.setItem('si_wl_open', sidebarOpen ? '1' : '0') }, [sidebarOpen])

  // ── Tema (light / dark) ─────────────────────────────────────────────────
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    (localStorage.getItem('si_theme') as 'light' | 'dark' | null) ?? 'light'
  )
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('si_theme', theme)
  }, [theme])
  const toggleTheme = () => setTheme(t => t === 'light' ? 'dark' : 'light')

  // ── Klavye kısayolları ──────────────────────────────────────────────
  // 1-7: sayfa    Ctrl+K: arama    Ctrl+P: command palette
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase()
      const isTyping = tag === 'input' || tag === 'textarea' || tag === 'select'

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        setPaletteOpen(p => !p)
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        navigate('/')
        setTimeout(() => {
          document.querySelector<HTMLInputElement>('input[placeholder*="Hisse ara"]')?.focus()
        }, 50)
        return
      }
      if (isTyping) return

      const num = parseInt(e.key, 10)
      if (!isNaN(num) && num >= 1 && num <= ROUTES.length) {
        e.preventDefault()
        navigate(ROUTES[num - 1])
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [navigate])

  // ── Command Palette komutları ──────────────────────────────────────
  const adminCommand = async (path: string, name: string) => {
    try {
      const r = await fetch(`${API}/admin/oracle/${path}`, {
        method: 'POST',
        headers: { 'X-Admin-Key': getAdminKey() },
      })
      const j = await r.json()
      if (r.ok) alert(`✓ ${name}: ${j.message ?? 'Başlatıldı'}`)
      else      alert(`✗ ${name}: ${j.error ?? 'Hata'}`)
    } catch (e) {
      alert(`Hata: ${e}`)
    }
  }
  const commands: Command[] = [
    // ── Navigasyon ──
    { id: 'nav-overview',    group: 'Navigasyon', icon: <Icon name="overview" size={16} />, label: 'Piyasa Genel',    hint: '1', action: () => navigate('/') },
    { id: 'nav-radar',       group: 'Navigasyon', icon: <Icon name="target" size={16} />, label: 'Fırsat Radarı',    hint: '2',
      keywords: ['fırsat', 'radar', 'sinyal', 'öneri'], action: () => navigate('/radar') },
    { id: 'nav-oracle',      group: 'Navigasyon', icon: <Icon name="sparkle" size={16} />, label: 'AI Tavsiye',       hint: '3', action: () => navigate('/oracle') },
    { id: 'nav-portfolio',   group: 'Navigasyon', icon: <Icon name="briefcase" size={16} />, label: 'Portföyüm',        hint: '4', action: () => navigate('/portfolio') },
    { id: 'nav-history',     group: 'Navigasyon', icon: <Icon name="history" size={16} />, label: 'Tahmin Geçmişi',  hint: '5', action: () => navigate('/history') },
    { id: 'nav-news',        group: 'Navigasyon', icon: <Icon name="news" size={16} />, label: 'Haberler',         hint: '6', action: () => navigate('/news') },
    { id: 'nav-fundamental', group: 'Navigasyon', icon: <Icon name="fundamental" size={16} />, label: 'Temel Analiz',     hint: '7', action: () => navigate('/fundamental') },
    { id: 'nav-mlops',       group: 'Navigasyon', icon: <Icon name="mlops" size={16} />, label: 'ML Ops Konsolu',   hint: '8', action: () => navigate('/mlops') },
    { id: 'nav-model-portfoy', group: 'Navigasyon', icon: <Icon name="bot" size={16} />, label: 'Model Portföyü',  hint: '9',
      keywords: ['model', 'portföy', 'paper', 'otonom', 'sanal'], action: () => navigate('/model-portfoy') },
    { id: 'nav-evaluate',    group: 'Navigasyon', icon: <Icon name="search" size={16} />, label: 'Hisse Değerlendir',
      keywords: ['değerlendirme', 'analiz', 'hisse', 'teknik', 'inceleme'], action: () => navigate('/degerlendirme') },
    { id: 'nav-dip-radar',   group: 'Navigasyon', icon: <Icon name="trending-down" size={16} />, label: 'Dip Fırsat Radarı',
      keywords: ['dip', 'fırsat', 'düşüş', 'alım', 'destek', 'düşen'], action: () => navigate('/dip-radar') },
    { id: 'nav-admin',       group: 'Navigasyon', icon: <Icon name="settings" size={16} />, label: 'Yönetim',          action: () => navigate('/admin') },
    // ── Aksiyon ──
    { id: 'act-search',      group: 'Aksiyon', icon: <Icon name="search" size={16} />, label: 'Hisse ara', hint: 'Ctrl+K',
      keywords: ['arama', 'search'],
      action: () => { navigate('/'); setTimeout(() => document.querySelector<HTMLInputElement>('input[placeholder*="Hisse ara"]')?.focus(), 50) } },
    // ── Sistem ──
    { id: 'sys-retrain',     group: 'Sistem', icon: <Icon name="refresh" size={16} />, label: 'Modeli yeniden eğit',
      keywords: ['retrain', 'eğitim'],
      action: () => { if (confirm('Model yeniden eğitilsin mi? (1-5dk)')) adminCommand('retrain', 'Retrain') } },
    { id: 'sys-walkforward', group: 'Sistem', icon: <Icon name="trending-up" size={16} />, label: 'Walk-forward backtest başlat',
      keywords: ['backtest', 'wf'],
      action: () => { if (confirm('Walk-forward backtest başlatılsın mı? (15-30dk)')) adminCommand('walkforward', 'Walk-Forward') } },
    { id: 'sys-analyze',     group: 'Sistem', icon: <Icon name="zap" size={16} />, label: 'Anlık analiz döngüsü',
      keywords: ['cycle', 'tarama'],
      action: () => adminCommand('analyze-now', 'Analiz') },
    { id: 'sys-reset',       group: 'Sistem', icon: <Icon name="reset" size={16} />, label: 'Modeli sıfırla',
      keywords: ['reset', 'sıfırla'],
      action: () => { if (confirm('Mevcut model silinsin ve sıfırdan eğitilsin mi?')) adminCommand('reset-model', 'Reset') } },
  ]

  // ── Ortak veri fetch ────────────────────────────────────────────────
  const fetchAll = useCallback(async (): Promise<boolean> => {
    try {
      const [assetsRes, oracleRes, newsRes, statusRes, fundRes] = await Promise.allSettled([
        fetch(`${API}/market/overview`),
        fetch(`${API}/oracle/overview`),
        fetch(`${API}/signals/latest?limit=200`),
        fetch(`${API}/status`),
        fetch(`${API}/fundamental/overview`),
      ])

      let anyOk = false
      if (assetsRes.status === 'fulfilled' && assetsRes.value.ok) {
        setAssets(await assetsRes.value.json())
        setLastUpdate(new Date().toLocaleTimeString('tr-TR'))
        anyOk = true
      }
      if (oracleRes.status === 'fulfilled' && oracleRes.value.ok) {
        setOracle(await oracleRes.value.json()); anyOk = true
      }
      if (newsRes.status === 'fulfilled' && newsRes.value.ok) {
        setNews(await newsRes.value.json()); anyOk = true
      }
      if (statusRes.status === 'fulfilled' && statusRes.value.ok) {
        setSysStatus(await statusRes.value.json()); anyOk = true
      }
      if (fundRes.status === 'fulfilled' && fundRes.value.ok) {
        setFundamentals(await fundRes.value.json()); anyOk = true
      }
      return anyOk
    } catch { return false }
  }, [])

  // Browser bildirimi — yeni BUY oracle gelince tetikle
  const notifyOracle = useCallback((analysis: OracleAnalysis[]) => {
    if (typeof Notification === 'undefined') return
    const newBuys = analysis.filter(a =>
      (a.recommendation.includes('ALIM')) && !seenOracleIds.current.has(a.id)
    )
    if (newBuys.length === 0) return
    newBuys.forEach(a => seenOracleIds.current.add(a.id))
    localStorage.setItem('si_seen_oracle', JSON.stringify([...seenOracleIds.current]))
    if (Notification.permission !== 'granted') return
    newBuys.forEach(a => {
      new Notification(`Aurion — ${a.symbol}`, {
        body: `${a.recommendation} · Güven %${(a.confidence * 100).toFixed(0)}`,
        icon: '/favicon.ico',
        tag: `oracle-${a.id}`,
      })
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const tick = async () => {
      if (cancelled) return
      const open = isMarketOpen()
      setMarketOpen(open)
      await fetchAll()
      if (!cancelled) timer = setTimeout(tick, open ? 30_000 : 300_000)
    }

    const start = async () => {
      for (let attempt = 1; attempt <= 20; attempt++) {
        if (cancelled) return
        setStartupMsg(`Servisler başlatılıyor... (${attempt}/20)`)
        const ok = await fetchAll()
        if (ok) break
        if (attempt < 20) await new Promise(r => setTimeout(r, 4000))
      }
      if (!cancelled) {
        setLoading(false)
        const open = isMarketOpen()
        setMarketOpen(open)
        timer = setTimeout(tick, open ? 30_000 : 300_000)
      }
    }
    start()
    return () => { cancelled = true; if (timer) clearTimeout(timer) }
  }, [fetchAll])

  // Bildirim — oracle listesi değişince kontrol et
  useEffect(() => { if (oracle.length > 0) notifyOracle(oracle) }, [oracle, notifyOracle])

  const shared: SharedData = { assets, oracle, news, fundamentals, sysStatus, openChart: setChartSymbol }

  // NavLink ortak className üreteci
  const navClass = ({ isActive }: { isActive: boolean }) =>
    `tab-btn${isActive ? ' active' : ''}`

  return (
    <>
      <header className="app-header">
        <Logo />

        {/* Makro ticker — her sayfada sürekli görünür */}
        <div style={{ flex: 1, marginLeft: 'var(--space-5)', overflowX: 'auto' }}>
          <MacroTicker
            items={[
              {
                symbol: 'USDTRY', label: 'USD/TRY', decimals: 2,
                close: assets.find(a => a.symbol === 'USDTRY')?.close ?? null,
                open:  assets.find(a => a.symbol === 'USDTRY')?.open  ?? null,
              },
              {
                symbol: 'EURTRY', label: 'EUR/TRY', decimals: 2,
                close: assets.find(a => a.symbol === 'EURTRY')?.close ?? null,
                open:  assets.find(a => a.symbol === 'EURTRY')?.open  ?? null,
              },
              {
                symbol: 'XAUUSD', label: 'Altın', decimals: 2, unit: '$',
                close: assets.find(a => a.symbol === 'XAUUSD')?.close ?? null,
                open:  assets.find(a => a.symbol === 'XAUUSD')?.open  ?? null,
              },
              {
                symbol: 'BRENTOIL', label: 'Brent', decimals: 2, unit: '$',
                close: assets.find(a => a.symbol === 'BRENTOIL')?.close ?? null,
                open:  assets.find(a => a.symbol === 'BRENTOIL')?.open  ?? null,
              },
            ]}
          />
        </div>

        <div className="header-meta">
          {assets.length > 0 && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5,
              fontSize: 'var(--text-xs)', fontWeight: 'var(--fw-bold)',
              color: marketOpen ? 'var(--profit)' : 'var(--text-muted)' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                background: marketOpen ? 'var(--profit)' : 'var(--text-muted)',
                boxShadow: marketOpen ? '0 0 0 2px rgba(34,197,94,.25)' : 'none',
              }} />
              {marketOpen ? 'Piyasa Açık' : 'Piyasa Kapalı'}
            </span>
          )}
          {lastUpdate && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>{lastUpdate}</span>}
          {typeof Notification !== 'undefined' && Notification.permission === 'default' && (
            <button
              onClick={() => Notification.requestPermission()}
              title="Yeni BUY sinyalleri için bildirim aç"
              style={{ background: 'var(--accent-bg)', border: '1px solid var(--accent)', color: 'var(--accent)',
                fontSize: 'var(--text-xs)', padding: '2px 8px', borderRadius: 'var(--radius-sm)',
                cursor: 'pointer', fontWeight: 'var(--fw-bold)', whiteSpace: 'nowrap' }}>
              Bildirim Aç
            </button>
          )}
          <DriftBadge apiBase={API} adminFetch={adminFetch} compact />

          <button
            onClick={() => setSidebarOpen(o => !o)}
            title={sidebarOpen ? 'İzleme listesini gizle' : 'İzleme listesini göster'}
            aria-label="İzleme listesi"
            style={{
              background: sidebarOpen ? 'var(--accent-bg)' : 'var(--bg-surface-2)',
              border: `1px solid ${sidebarOpen ? 'var(--accent-border)' : 'var(--border-strong)'}`,
              color: sidebarOpen ? 'var(--accent)' : 'var(--text-secondary)',
              width: '32px', height: '28px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px',
              lineHeight: 1, padding: 0,
            }}
          >
            <Icon name="list" size={15} />
          </button>
          <button
            onClick={() => setPaletteOpen(true)}
            title="Komut paleti (Ctrl+P)"
            style={{
              background: 'var(--bg-surface-2)', border: '1px solid var(--border-strong)',
              color: 'var(--text-muted)', padding: '4px 10px', borderRadius: 'var(--radius-sm)',
              cursor: 'pointer', fontSize: 'var(--text-xs)', fontWeight: 'var(--fw-bold)',
              display: 'flex', alignItems: 'center', gap: '4px',
            }}
          >
            <span style={{ fontSize: '12px' }}>⌘</span> Ctrl+P
          </button>
          <button
            onClick={toggleTheme}
            title={theme === 'light' ? 'Karanlık temaya geç' : 'Aydınlık temaya geç'}
            aria-label="Tema değiştir"
            style={{
              background: 'var(--bg-surface-2)', border: '1px solid var(--border-strong)',
              color: 'var(--text-secondary)', width: '32px', height: '28px',
              borderRadius: 'var(--radius-sm)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '14px', lineHeight: 1, padding: 0,
              transition: 'background var(--transition-fast), color var(--transition-fast)',
            }}
          >
            <Icon name={theme === 'light' ? 'moon' : 'sun'} size={15} />
          </button>
        </div>
      </header>

      {/* Command Palette — global */}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        commands={commands}
      />

      <div className="app-body">
        {sidebarOpen && (
          <WatchlistSidebar
            assets={assets}
            onSelect={setChartSymbol}
            activeSymbol={chartSymbol}
            onCollapse={() => setSidebarOpen(false)}
          />
        )}
        <main className="main">
        <nav className="tabs">
          {([
            { to: '/',              end: true, icon: 'overview',    label: 'Piyasa Genel' },
            { to: '/terminal',      icon: 'mlops',                 label: 'Terminal' },
            { to: '/radar',         icon: 'target',                label: 'Fırsat Radarı' },
            { to: '/model-portfoy', icon: 'bot',                   label: 'Model Portföyü' },
            { to: '/oracle',        icon: 'sparkle',               label: 'AI Tavsiye',     badge: oracle.length },
            { to: '/portfolio',     icon: 'briefcase',             label: 'Portföyüm' },
            { to: '/history',       icon: 'history',               label: 'Tahmin Geçmişi' },
            { to: '/news',          icon: 'news',                  label: 'Haberler',       badge: news.length },
            { to: '/fundamental',   icon: 'fundamental',           label: 'Temel Analiz',   badge: fundamentals.length },
            { to: '/mlops',         icon: 'mlops',                 label: 'ML Ops' },
            { to: '/dip-radar',     icon: 'trending-down',         label: 'Dip Radarı' },
            { to: '/degerlendirme', icon: 'search',                label: 'Değerlendir' },
            { to: '/admin',         icon: 'settings',              label: 'Yönetim' },
          ] as { to: string; end?: boolean; icon: IconName; label: string; badge?: number }[]).map(n => (
            <NavLink key={n.to} to={n.to} end={n.end} className={navClass}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Icon name={n.icon} size={15} />
                {n.label}{n.badge ? ` (${n.badge})` : ''}
              </span>
            </NavLink>
          ))}
        </nav>

        {loading && (
          <div className="loading"><div className="spinner" /><span>{startupMsg}</span></div>
        )}

        {!loading && (
          <>
            <StatusBanner
              status={sysStatus}
              assetsReady={assets.length > 0}
              oracleReady={oracle.length > 0}
              newsReady={news.length > 0}
            />
            {/* Aktif route içeriği — ortak veri context ile geçer */}
            <Outlet context={shared} />
          </>
        )}
        </main>
      </div>

      {/* Panel gizliyken yeniden açma sekmesi */}
      {!sidebarOpen && (
        <button className="wl-reopen" onClick={() => setSidebarOpen(true)} title="İzleme listesini aç">
          İzleme
        </button>
      )}

      {/* Sembol grafik + değerler drawer'ı */}
      {chartSymbol && (
        <SymbolDrawer
          symbol={chartSymbol}
          asset={assets.find(a => a.symbol === chartSymbol)}
          oracle={oracle.find(o => o.symbol === chartSymbol)}
          availableSymbols={assets.filter(a => a.assetType !== 'GLOBAL').map(a => a.symbol).sort()}
          apiBase={API}
          onClose={() => setChartSymbol(null)}
        />
      )}
    </>
  )
}
