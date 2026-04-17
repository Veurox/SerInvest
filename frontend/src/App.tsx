import { useEffect, useState, useCallback } from 'react'

const API = 'http://localhost:8080/api'

// ── Sistem Durumu Tipi ────────────────────────────────────────────────────────
interface SystemStatus {
  db: string; redis: string
  market_data_service: string; tracked_assets: number
  analyst_engine: string;      news_signals: number
  oracle_service: string;      oracle_analyses: number
  last_price_update?: string;  last_oracle_update?: string
  ready: boolean
}

interface SysLog {
  level: string; message: string; timestamp: string; accuracy: number
}

interface EvaluationRecord {
  timestamp: string; symbol: string; predicted: string; confidence: number
  close: number; target: number; eval1d: string; eval5d: string; eval20d: string
}

// ── Tipler ────────────────────────────────────────────────────────────────────
interface PriceData {
  id: string; symbol: string; assetType: string
  close: number | null; open: number | null; high: number | null; low: number | null; volume: number | null
  rsi: number | null; macdLine: number | null; macdSignal: number | null; macdHistogram: number | null
  bbUpper: number | null; bbMiddle: number | null; bbLower: number | null
  ema9: number | null; ema20: number | null; ema50: number | null; ema200: number | null
  signal: 'BUY' | 'SELL' | 'NEUTRAL'; signalStrength: number; recordedAt: string
}

interface NewsSignal {
  id: string; entity: string; source: string; assetType: string
  sentimentLabel: string; sentimentScore: number; isGeopolitical: boolean
  headline: string; summary: string; url: string; createdAt: string
}

interface OracleAnalysis {
  id: string; symbol: string; assetType: string; priceAtAnalysis: number | null
  recommendation: string; confidence: number
  shortTermBias: string; shortTermTarget: number | null; shortTermStop: number | null
  longTermBias: string; longTermTarget: number | null
  reasoning: string; keyDrivers: string; risks: string; watchPoints: string
  technicalScore: number; newsScore: number; macroScore: number
  fundamentalScore: number   // Faz 2
  analyzedAt: string
}

interface FundamentalData {
  id: string; symbol: string; assetType: string
  companyName: string; sector: string
  peRatio: number | null; forwardPe: number | null; pbRatio: number | null
  roe: number | null; eps: number | null; forwardEps: number | null
  // FAVÖK / Operasyonel Karlılık (Faz 3)
  ebitda: number | null; ebitdaMargin: number | null; netDebtEbitda: number | null
  tcmbRatePct: number | null
  debtToEquity: number | null; beta: number | null
  revenueGrowth: number | null; earningsGrowth: number | null
  dividendYield: number | null; marketCap: number | null; position52W: number | null
  fundamentalScore: number
  lastKapTitle: string; lastKapDate: string
  updatedAt: string
}

// ── Yardımcılar ───────────────────────────────────────────────────────────────
const fmt = (n: number | null, dec = 2) =>
  n == null ? '—' : n.toLocaleString('tr-TR', { minimumFractionDigits: dec, maximumFractionDigits: dec })

const parseArr = (s: string): string[] => {
  try { return JSON.parse(s) } catch { return [] }
}

const recColor = (r: string) => {
  if (r.includes('GÜÇLÜ ALIM'))  return { bg: 'rgba(34,197,94,.15)', color: '#22c55e', border: 'rgba(34,197,94,.35)' }
  if (r.includes('ALIM'))        return { bg: 'rgba(34,197,94,.08)', color: '#86efac', border: 'rgba(34,197,94,.2)' }
  if (r.includes('GÜÇLÜ KAÇIN')) return { bg: 'rgba(239,68,68,.15)', color: '#ef4444', border: 'rgba(239,68,68,.35)' }
  if (r.includes('KAÇIN'))       return { bg: 'rgba(239,68,68,.08)', color: '#fca5a5', border: 'rgba(239,68,68,.2)' }
  return { bg: 'rgba(148,163,184,.08)', color: '#94a3b8', border: 'rgba(148,163,184,.2)' }
}

const biasIcon = (b: string) =>
  b === 'YÜKSELİŞ' ? '↑' : b === 'DÜŞÜŞ' ? '↓' : '→'

const biasColor = (b: string) =>
  b === 'YÜKSELİŞ' ? '#22c55e' : b === 'DÜŞÜŞ' ? '#ef4444' : '#94a3b8'

// ── Sistem Durumu Paneli ─────────────────────────────────────────────────────
function StatusBanner({
  status, assetsReady, oracleReady, newsReady,
}: {
  status: SystemStatus | null
  assetsReady: boolean
  oracleReady: boolean
  newsReady: boolean
}) {
  // Her şey hazırsa hiçbir şey gösterme
  if (assetsReady && oracleReady) return null

  // Status API'den gelen detay (yoksa veri durumundan çıkar)
  const dbOk        = status ? status.db === 'ok'                             : true
  const marketState = status ? status.market_data_service                     : (assetsReady ? 'ok' : 'waiting')
  const newsState   = status ? status.analyst_engine                          : (newsReady   ? 'ok' : 'waiting')
  const oracleState = status ? status.oracle_service                          : (oracleReady ? 'ok' : 'training')

  const rows: [string, string][] = [
    ['Veritabanı',    dbOk ? 'ok' : 'error'],
    ['Piyasa Verisi', marketState],
    ['Haber Motoru',  newsState],
    ['AI Oracle (ML)', oracleState],
  ]

  const Dot = ({ s }: { s: string }) => {
    const color = s === 'ok' ? '#22c55e' : s === 'error' ? '#ef4444' : '#fbbf24'
    const label = s === 'ok' ? 'Hazır' : s === 'error' ? 'Hata' : s === 'training' ? 'Eğitim...' : 'Bekleniyor'
    return <span style={{ color, fontWeight: 700 }}>● {label}</span>
  }

  return (
    <div style={{
      background: 'rgba(251,191,36,.07)', border: '1px solid rgba(251,191,36,.25)',
      borderRadius: '10px', padding: '.875rem 1.25rem', marginBottom: '1.5rem',
    }}>
      <div style={{ fontSize: '.8rem', fontWeight: 700, color: '#fbbf24', marginBottom: '.75rem', letterSpacing: '.05em' }}>
        ⏳ SİSTEM BAŞLATILIYOR
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: '.5rem' }}>
        {rows.map(([label, s]) => (
          <div key={label} style={{ fontSize: '.82rem', color: 'var(--text-dim)', display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
            <span>{label}</span><Dot s={s} />
          </div>
        ))}
      </div>

      {/* Oracle eğitim mesajı */}
      {!oracleReady && (
        <div style={{ marginTop: '.875rem', borderTop: '1px solid rgba(255,255,255,.07)', paddingTop: '.875rem', fontSize: '.8rem', color: 'var(--text-muted)', lineHeight: 1.7 }}>
          🧠 <strong style={{ color: '#fbbf24' }}>Oracle modeli ilk kez eğitiliyor</strong> —
          30 sembol × 2 yıl tarihsel veri indiriliyor. Bu işlem <strong style={{ color: 'var(--text)' }}>~10–15 dakika</strong> sürer ve yalnızca bir kez yapılır.<br />
          Terminalde takip etmek için:&nbsp;
          <code style={{ background: 'rgba(255,255,255,.08)', padding: '.15rem .5rem', borderRadius: '5px', fontSize: '.78rem' }}>
            docker logs serinvest-oracle -f
          </code>
        </div>
      )}

      {/* Piyasa verisi bekleniyor */}
      {!assetsReady && oracleReady && (
        <div style={{ marginTop: '.875rem', borderTop: '1px solid rgba(255,255,255,.07)', paddingTop: '.875rem', fontSize: '.8rem', color: 'var(--text-muted)' }}>
          📊 Piyasa verisi bekleniyor — market-data-service ilk çalıştırmada ~2–3 dakika sürer.
        </div>
      )}
    </div>
  )
}

// ── Piyasa Kartı ─────────────────────────────────────────────────────────────
function AssetCard({ data, selected, onClick }: { data: PriceData; selected: boolean; onClick: () => void }) {
  const change = data.close != null && data.open != null ? data.close - data.open : null
  const changePct = change != null && data.open ? (change / data.open) * 100 : null
  const chClass = change == null ? 'change-neu' : change >= 0 ? 'change-pos' : 'change-neg'
  const badgeCls = { BIST: 'badge-bist', COMMODITY: 'badge-commodity', FOREX: 'badge-forex' }[data.assetType] ?? 'badge-general'

  return (
    <div className={`asset-card${selected ? ' selected' : ''}`} onClick={onClick}>
      <div className="asset-card-top">
        <span className="asset-symbol">{data.symbol}</span>
        <span className={`asset-type-badge ${badgeCls}`}>{data.assetType}</span>
      </div>
      <div className="asset-price">{fmt(data.close, data.assetType === 'FOREX' ? 4 : 2)}</div>
      <div className={`asset-change ${chClass}`}>
        {change != null && <span>{change >= 0 ? '+' : ''}{fmt(change)}</span>}
        {changePct != null && <span>({changePct >= 0 ? '+' : ''}{fmt(changePct, 1)}%)</span>}
      </div>
      <div className="signal-row">
        <span className={`signal-pill ${data.signal === 'BUY' ? 'signal-buy' : data.signal === 'SELL' ? 'signal-sell' : 'signal-neutral'}`}>
          {data.signal}
        </span>
        <span className="rsi-label">RSI {data.rsi != null ? fmt(data.rsi, 1) : '—'}</span>
      </div>
    </div>
  )
}

// ── İndikatör Detay ──────────────────────────────────────────────────────────
function DetailPanel({ data }: { data: PriceData }) {
  const strength = Math.round(data.signalStrength * 100)
  const ind = (label: string, value: number | null, dec = 2, colorFn?: (v: number) => string) => (
    <div className="ind-box">
      <div className="ind-label">{label}</div>
      <div className={`ind-value ${value != null && colorFn ? '' : 'ind-val-dim'}`}
           style={value != null && colorFn ? { color: colorFn(value) } : {}}>
        {fmt(value, dec)}
      </div>
    </div>
  )

  return (
    <div className="detail-panel">
      <div className="detail-header">
        <span className="detail-symbol">{data.symbol}</span>
        <span className="detail-price">{fmt(data.close, data.assetType === 'FOREX' ? 4 : 2)}</span>
        <span className={`signal-pill ${data.signal === 'BUY' ? 'signal-buy' : data.signal === 'SELL' ? 'signal-sell' : 'signal-neutral'}`}>
          {data.signal}
        </span>
      </div>
      <div className="indicators-row">
        {ind('RSI (14)', data.rsi, 1, v => v < 35 ? '#22c55e' : v > 65 ? '#ef4444' : '#94a3b8')}
        {ind('MACD', data.macdLine, 4, v => data.macdSignal != null ? (v > data.macdSignal ? '#22c55e' : '#ef4444') : '#94a3b8')}
        {ind('MACD Sinyal', data.macdSignal, 4)}
        {ind('BB Üst', data.bbUpper)} {ind('BB Orta', data.bbMiddle)} {ind('BB Alt', data.bbLower)}
        {ind('EMA 20', data.ema20, 2, v => data.close != null ? (data.close > v ? '#22c55e' : '#ef4444') : '#94a3b8')}
        {ind('EMA 50', data.ema50, 2, v => data.close != null ? (data.close > v ? '#22c55e' : '#ef4444') : '#94a3b8')}
        {ind('EMA 200', data.ema200, 2, v => data.close != null ? (data.close > v ? '#22c55e' : '#ef4444') : '#94a3b8')}
      </div>
      <div className="strength-bar-wrap" style={{ marginTop: '1.25rem' }}>
        <div className="strength-label"><span>Sinyal Kuvveti</span><span>{strength}%</span></div>
        <div className="strength-bar-bg"><div className="strength-bar-fill" style={{ width: `${strength}%` }} /></div>
        <div className="strength-label" style={{ marginTop: '.4rem' }}>
          <span style={{ color: 'var(--text-muted)', fontSize: '.7rem' }}>
            G/Y: {fmt(data.high)} / {fmt(data.low)} | Hacim: {data.volume != null ? (data.volume / 1_000_000).toFixed(1) + 'M' : '—'}
          </span>
          <span style={{ color: 'var(--text-muted)', fontSize: '.7rem' }}>
            {new Date(data.recordedAt).toLocaleString('tr-TR')}
          </span>
        </div>
      </div>
    </div>
  )
}

// ── Oracle Tavsiye Kartı ──────────────────────────────────────────────────────
function OracleCard({ data }: { data: OracleAnalysis }) {
  const [expanded, setExpanded] = useState(false)
  const col    = recColor(data.recommendation)
  const drivers = parseArr(data.keyDrivers)
  const risks   = parseArr(data.risks)
  const watches = parseArr(data.watchPoints)
  const conf    = Math.round(data.confidence * 100)

  const ScoreBar = ({ label, score }: { label: string; score: number }) => (
    <div style={{ marginBottom: '.35rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.7rem', color: 'var(--text-muted)', marginBottom: '.2rem' }}>
        <span>{label}</span><span>{Math.round(score * 100)}%</span>
      </div>
      <div style={{ height: '4px', background: 'var(--border)', borderRadius: '2px', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${score * 100}%`, background: col.color, borderRadius: '2px', transition: 'width .5s' }} />
      </div>
    </div>
  )

  return (
    <div className="oracle-card" style={{ border: `1px solid ${col.border}`, background: col.bg }}>
      <div className="oracle-card-top" onClick={() => setExpanded(e => !e)} style={{ cursor: 'pointer' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '1.1rem', fontWeight: 800 }}>{data.symbol}</span>
          <span style={{ fontSize: '.72rem', color: 'var(--text-muted)', background: 'var(--surface-2)', padding: '.15rem .5rem', borderRadius: '4px' }}>
            {data.assetType}
          </span>
          <span style={{ fontWeight: 700, fontSize: '.85rem', color: col.color }}>{data.recommendation}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem' }}>
          <span style={{ fontSize: '.8rem', color: 'var(--text-muted)' }}>
            Güven: <strong style={{ color: col.color }}>{conf}%</strong>
          </span>
          <span style={{ fontSize: '.7rem', color: 'var(--text-muted)' }}>{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      <div style={{ marginTop: '.75rem' }}>
        <div style={{ height: '5px', background: 'var(--border)', borderRadius: '3px', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${conf}%`, background: col.color, transition: 'width .5s', opacity: .8 }} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: '1.5rem', marginTop: '.875rem', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: '.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Kısa Vade</div>
          <div style={{ fontSize: '.9rem', fontWeight: 700, color: biasColor(data.shortTermBias) }}>
            {biasIcon(data.shortTermBias)} {data.shortTermBias}
            {data.shortTermTarget != null && <span style={{ fontWeight: 400, color: 'var(--text-dim)', marginLeft: '.4rem' }}>
              Hedef: {fmt(data.shortTermTarget)}
            </span>}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Uzun Vade</div>
          <div style={{ fontSize: '.9rem', fontWeight: 700, color: biasColor(data.longTermBias) }}>
            {biasIcon(data.longTermBias)} {data.longTermBias}
            {data.longTermTarget != null && <span style={{ fontWeight: 400, color: 'var(--text-dim)', marginLeft: '.4rem' }}>
              Hedef: {fmt(data.longTermTarget)}
            </span>}
          </div>
        </div>
        {data.priceAtAnalysis != null && (
          <div>
            <div style={{ fontSize: '.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Analiz Fiyatı</div>
            <div style={{ fontSize: '.9rem', color: 'var(--text-dim)' }}>{fmt(data.priceAtAnalysis)}</div>
          </div>
        )}
      </div>

      {expanded && (
        <div style={{ marginTop: '1rem', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
          {data.reasoning && (
            <p style={{ fontSize: '.85rem', color: 'var(--text-dim)', lineHeight: 1.6, marginBottom: '1rem' }}>
              {data.reasoning}
            </p>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
            {drivers.length > 0 && (
              <div>
                <div style={{ fontSize: '.7rem', color: 'var(--green)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '.4rem' }}>
                  ✓ Olumlu Faktörler
                </div>
                {drivers.map((d, i) => <div key={i} style={{ fontSize: '.8rem', color: 'var(--text-dim)', marginBottom: '.2rem' }}>• {d}</div>)}
              </div>
            )}
            {risks.length > 0 && (
              <div>
                <div style={{ fontSize: '.7rem', color: 'var(--red)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '.4rem' }}>
                  ⚠ Riskler
                </div>
                {risks.map((r, i) => <div key={i} style={{ fontSize: '.8rem', color: 'var(--text-dim)', marginBottom: '.2rem' }}>• {r}</div>)}
              </div>
            )}
          </div>

          {watches.length > 0 && (
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ fontSize: '.7rem', color: 'var(--yellow)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '.4rem' }}>
                👁 Takip Edilecekler
              </div>
              {watches.map((w, i) => <div key={i} style={{ fontSize: '.8rem', color: 'var(--text-dim)', marginBottom: '.2rem' }}>• {w}</div>)}
            </div>
          )}

          <div style={{ marginTop: '.75rem' }}>
            <div style={{ fontSize: '.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '.5rem' }}>
              Sinyal Bileşenleri
            </div>
            <ScoreBar label="Teknik Analiz" score={data.technicalScore} />
            <ScoreBar label="Haber & Duyarlılık" score={data.newsScore} />
            <ScoreBar label="Makro Bağlam" score={data.macroScore} />
            {data.fundamentalScore > 0 && (
              <ScoreBar label="Temel Analiz" score={data.fundamentalScore} />
            )}
          </div>

          <div style={{ fontSize: '.7rem', color: 'var(--text-muted)', marginTop: '.75rem', textAlign: 'right' }}>
            {new Date(data.analyzedAt).toLocaleString('tr-TR')}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Temel Analiz Tablosu ─────────────────────────────────────────────────────
function FundamentalTab({ data }: { data: FundamentalData[] }) {
  const [sortKey, setSortKey] = useState<keyof FundamentalData>('fundamentalScore')
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc')
  const [filter, setFilter]   = useState<'TÜM' | 'GÜÇLÜ' | 'NÖTR' | 'ZAYIF'>('TÜM')

  if (data.length === 0) {
    return (
      <div className="empty">
        <p>Temel analiz verisi henüz yok.</p>
        <p style={{ marginTop: '.5rem', fontSize: '.8rem' }}>fundamental-service başlatıldıktan ~2 dakika sonra görünecektir.</p>
      </div>
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

  const filtered = data.filter(d =>
    filter === 'TÜM'   ? true :
    filter === 'GÜÇLÜ' ? d.fundamentalScore >= 0.60 :
    filter === 'ZAYIF' ? d.fundamentalScore <= 0.40 :
    d.fundamentalScore > 0.40 && d.fundamentalScore < 0.60
  )

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
      {/* Filtreler */}
      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
        {(['TÜM', 'GÜÇLÜ', 'NÖTR', 'ZAYIF'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: '.3rem .85rem', borderRadius: '999px', border: '1px solid var(--border)',
            background: filter === f ? 'var(--yellow)' : 'var(--surface)',
            color: filter === f ? '#0a0f1e' : 'var(--text-muted)',
            fontWeight: filter === f ? 700 : 400,
            cursor: 'pointer', fontSize: '.78rem', transition: 'all .15s',
          }}>
            {f === 'GÜÇLÜ' ? '🟢 Güçlü (>60%)' : f === 'NÖTR' ? '🟡 Nötr' : f === 'ZAYIF' ? '🔴 Zayıf (<40%)' : 'TÜM'}
          </button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: '.75rem', color: 'var(--text-muted)', alignSelf: 'center' }}>
          {sorted.length} varlık
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
                      📋 {d.lastKapTitle.substring(0, 35)}{d.lastKapTitle.length > 35 ? '…' : ''}
                    </span>
                  ) : <span style={{ color: 'var(--text-muted)', fontSize: '.72rem' }}>—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: '1rem', fontSize: '.72rem', color: 'var(--text-muted)', borderTop: '1px solid var(--border)', paddingTop: '.75rem' }}>
        ⚠️ Temel veriler yfinance aracılığıyla 15 dk gecikmeli alınmaktadır. Yatırım kararı vermeden önce doğrulayınız. Bu bir yatırım tavsiyesi değildir.
      </div>
    </div>
  )
}

// ── Haber Feed'i ─────────────────────────────────────────────────────────────
function NewsFeed({ news }: { news: NewsSignal[] }) {
  if (news.length === 0) return <div className="empty">Henüz haber yok.</div>
  return (
    <div className="news-list">
      {news.map(item => {
        const cls = item.sentimentLabel === 'BULLISH' ? 'bull' : item.sentimentLabel === 'BEARISH' ? 'bear' : 'neut'
        const icon = item.sentimentLabel === 'BULLISH' ? '▲' : item.sentimentLabel === 'BEARISH' ? '▼' : '●'
        return (
          <div className="news-item" key={item.id}>
            <div className={`news-sentiment ${cls}`}>{icon}</div>
            <div className="news-body">
              {item.url
                ? <a href={item.url} target="_blank" rel="noopener noreferrer" className="news-headline">{item.headline}</a>
                : <div className="news-headline">{item.headline}</div>}
              <div className="news-meta">
                <span>{item.source}</span>
                <span className="news-entity">{item.entity}</span>
                {item.isGeopolitical && <span className="news-geo">⚡ Jeopolitik</span>}
                <span>{new Date(item.createdAt).toLocaleTimeString('tr-TR')}</span>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Walk-Forward Tipler ────────────────────────────────────────────────────────
interface WFStepStat {
  step: number; train_days: number; test_days: number
  accuracy: number; buy_accuracy: number | null; sell_accuracy: number | null
}
interface WFSummary {
  status?: string; message?: string
  overall_accuracy: number; buy_accuracy: number; sell_accuracy: number
  neutral_pct: number; n_predictions: number; n_steps: number; n_symbols: number
  step_stats: WFStepStat[]
  top_symbols: { symbol: string; accuracy: number; n: number }[]
  completed_at: string
}

// ── ML Ops Konsolu ─────────────────────────────────────────────────────────────
function MLOpsTab() {
  const [logs, setLogs] = useState<SysLog[]>([])
  const [accuracy, setAccuracy] = useState<number>(0)
  const [wfSummary, setWfSummary] = useState<WFSummary | null>(null)

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch(`${API}/oracle/syslogs`)
      if (res.ok) {
        const data = await res.json()
        setLogs(data.logs || [])
        setAccuracy(data.currentAccuracy || 0)
      }
    } catch {}
  }, [])

  const fetchWF = useCallback(async () => {
    try {
      const res = await fetch(`${API}/oracle/walkforward`)
      if (res.ok) setWfSummary(await res.json())
    } catch {}
  }, [])

  const getLogColor = (level: string) => {
    if (level === 'TRAINING') return '#fbbf24' // Sarı
    if (level === 'EVALUATION') return '#38bdf8' // Mavi
    if (level === 'SUCCESS') return '#22c55e' // Yeşil
    if (level === 'WARN') return '#f97316' // Turuncu
    if (level === 'ERROR') return '#ef4444' // Kırmızı
    return '#94a3b8' // Bilgi / Gri
  }

  const [evaluations, setEvaluations] = useState<EvaluationRecord[]>([])

  const fetchEvals = useCallback(async () => {
    try {
      const res = await fetch(`${API}/oracle/evaluations?limit=50`)
      if (res.ok) setEvaluations(await res.json())
    } catch {}
  }, [])

  useEffect(() => {
    fetchLogs()
    fetchWF()
    fetchEvals()
    const t1 = setInterval(fetchLogs, 5000)
    const t2 = setInterval(fetchWF, 30000)
    const t3 = setInterval(fetchEvals, 15000)
    return () => { clearInterval(t1); clearInterval(t2); clearInterval(t3) }
  }, [fetchLogs, fetchWF, fetchEvals])

  // Değerlendirme sonucunu formatla (örn "BUY|+0.0250")
  const renderEval = (val: string) => {
    if (!val) return <span style={{ color: '#64748b' }}>⏳ Bekliyor</span>
    const parts = val.split('|')
    if (parts.length < 2) return val
    const actual = parts[0]
    const ret = parseFloat(parts[1])
    const color = ret > 0.025 ? '#22c55e' : ret < -0.025 ? '#ef4444' : '#fbbf24'
    return <span style={{ color, fontWeight: 600 }}>{actual} <small>({(ret * 100).toFixed(1)}%)</small></span>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 280px', gap: '1.5rem', alignItems: 'start' }}>
        
        {/* Terminal Ekranı */}
        <div style={{ background: '#0f172a', borderRadius: '12px', border: '1px solid #1e293b', overflow: 'hidden', display: 'flex', flexDirection: 'column', height: '400px' }}>
          <div style={{ background: '#1e293b', padding: '0.5rem 1rem', display: 'flex', gap: '0.5rem', alignItems: 'center', borderBottom: '1px solid #334155' }}>
            <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#ef4444' }} />
            <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#fbbf24' }} />
            <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#22c55e' }} />
            <span style={{ marginLeft: '1rem', fontSize: '0.8rem', color: '#94a3b8', fontFamily: 'monospace' }}>oracle-syslog-terminal</span>
          </div>
          
          <div style={{ padding: '1rem', overflowY: 'auto', flex: 1, fontFamily: '"JetBrains Mono", "Fira Code", monospace', fontSize: '0.85rem', lineHeight: 1.6, display: 'flex', flexDirection: 'column-reverse' }}>
            {logs.length === 0 ? (
              <div style={{ color: '#475569' }}>Lütfen bekleyin, loglar alınıyor...</div>
            ) : (
              logs.map((log, i) => (
                <div key={i} style={{ marginBottom: '0.4rem', borderBottom: '1px solid #1e293b', paddingBottom: '0.4rem' }}>
                  <span style={{ color: '#475569', marginRight: '0.8rem' }}>[{new Date(log.timestamp).toLocaleTimeString('tr-TR')}]</span>
                  <span style={{ color: getLogColor(log.level), fontWeight: 700, marginRight: '0.8rem' }}>[{log.level}]</span>
                  <span style={{ color: '#e2e8f0' }}>{log.message}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Model İstatistikleri Dashboard */}
        <div style={{ background: 'var(--surface)', borderRadius: '12px', padding: '1.5rem', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1.5rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.75rem' }}>
            🧠 Model İstatistikleri
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
              Genel Doğruluk Oranı
            </div>
            <div style={{ fontSize: '2rem', fontWeight: 800, color: accuracy >= 0.6 ? '#22c55e' : accuracy >= 0.4 ? '#fbbf24' : '#ef4444' }}>
              {(accuracy * 100).toFixed(1)}%
            </div>
            <div style={{ height: '6px', background: 'var(--border)', borderRadius: '3px', overflow: 'hidden', marginTop: '0.5rem' }}>
              <div style={{ height: '100%', width: `${accuracy * 100}%`, background: accuracy >= 0.6 ? '#22c55e' : accuracy >= 0.4 ? '#fbbf24' : '#ef4444', transition: 'width 1s' }} />
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: '0.5rem' }}>
              Modelin son tahminlerindeki başarısı.
            </div>
          </div>

          <div style={{ padding: '1rem', background: '#ecfdf5', borderRadius: '8px', color: '#064e3b', fontSize: '0.85rem', lineHeight: 1.5, border: '1px solid #a7f3d0' }}>
            <strong>Late Fusion Motoru Aktif:</strong><br />
            Sistem an itibariyle Teknik, Temel, Haber ve Makro sinyalleri dinamik ağırlıklarla birleştirerek nihai kararları üretmektedir.
          </div>
        </div>
      </div>

      {/* ── Walk-Forward Backtest Paneli ── */}
      <div style={{ background: 'var(--surface)', borderRadius: '16px', border: '1px solid var(--border)', overflow: 'hidden', marginBottom: '1.5rem' }}>
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>
            📈 Walk-Forward Backtest
            <span style={{ fontSize: '.72rem', fontWeight: 400, color: 'var(--text-muted)', marginLeft: '.75rem' }}>
              Geçmişten bugüne — her adımda model sadece o güne kadar olan veriyi görür
            </span>
          </h2>
          {wfSummary && !wfSummary.status && (
            <span style={{ fontSize: '.72rem', color: 'var(--text-muted)' }}>
              {new Date(wfSummary.completed_at).toLocaleString('tr-TR')}
            </span>
          )}
        </div>

        {!wfSummary ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>⏳ Yükleniyor...</div>
        ) : wfSummary.status === 'pending' ? (
          <div style={{ padding: '2rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', color: '#fbbf24' }}>
              <span style={{ fontSize: '1.5rem' }}>⚙️</span>
              <div>
                <div style={{ fontWeight: 700, marginBottom: '.3rem' }}>Backtest Çalışıyor...</div>
                <div style={{ fontSize: '.82rem', color: 'var(--text-muted)' }}>
                  3 yıllık geçmiş veri üzerinde walk-forward analizi arka planda devam ediyor. ~10-20 dakika sürer.
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ padding: '1.25rem 1.5rem' }}>
            {/* Özet Metrikler */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px,1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
              {[
                { label: 'Genel Doğruluk', val: wfSummary.overall_accuracy, highlight: true },
                { label: 'BUY Doğruluğu', val: wfSummary.buy_accuracy },
                { label: 'SELL Doğruluğu', val: wfSummary.sell_accuracy },
                { label: 'NÖTR Oranı', val: wfSummary.neutral_pct },
              ].map(m => (
                <div key={m.label} style={{ background: 'var(--surface-2, #1e293b)', borderRadius: '8px', padding: '.85rem 1rem', border: `1px solid ${m.highlight ? 'rgba(34,197,94,.3)' : 'var(--border)'}` }}>
                  <div style={{ fontSize: '.68rem', color: 'var(--text-muted)', marginBottom: '.3rem' }}>{m.label}</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 800, color: m.val >= 0.6 ? '#22c55e' : m.val >= 0.45 ? '#fbbf24' : '#ef4444' }}>
                    {(m.val * 100).toFixed(1)}%
                  </div>
                </div>
              ))}
              <div style={{ background: 'var(--surface-2, #1e293b)', borderRadius: '8px', padding: '.85rem 1rem', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: '.68rem', color: 'var(--text-muted)', marginBottom: '.3rem' }}>Toplam Tahmin</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 800 }}>{wfSummary.n_predictions.toLocaleString()}</div>
              </div>
              <div style={{ background: 'var(--surface-2, #1e293b)', borderRadius: '8px', padding: '.85rem 1rem', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: '.68rem', color: 'var(--text-muted)', marginBottom: '.3rem' }}>WF Adım Sayısı</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 800 }}>{wfSummary.n_steps}</div>
              </div>
            </div>

            {/* Adım Bazlı Doğruluk Çubuğu Grafiği */}
            {wfSummary.step_stats?.length > 0 && (
              <div style={{ marginBottom: '1.5rem' }}>
                <div style={{ fontSize: '.75rem', color: 'var(--text-muted)', marginBottom: '.75rem', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                  Çeyreklik Doğruluk Trendi (Adım Bazlı)
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: '4px', height: '80px' }}>
                  {wfSummary.step_stats.map(s => {
                    const h = Math.round(s.accuracy * 80)
                    const c = s.accuracy >= 0.60 ? '#22c55e' : s.accuracy >= 0.45 ? '#fbbf24' : '#ef4444'
                    return (
                      <div key={s.step} title={`Adım ${s.step}: %${(s.accuracy*100).toFixed(1)} (${s.test_days} tahmin)`}
                        style={{ flex: 1, height: `${h}px`, background: c, borderRadius: '3px 3px 0 0', opacity: .85, cursor: 'default', minWidth: '8px', transition: 'opacity .2s' }}
                        onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                        onMouseLeave={e => (e.currentTarget.style.opacity = '.85')}
                      />
                    )
                  })}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.65rem', color: 'var(--text-muted)', marginTop: '.3rem' }}>
                  <span>3 Yıl Önce</span><span>Bugün</span>
                </div>
              </div>
            )}

            {/* En İyi Semboller */}
            {wfSummary.top_symbols?.length > 0 && (
              <div>
                <div style={{ fontSize: '.75rem', color: 'var(--text-muted)', marginBottom: '.6rem', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                  En Başarılı Semboller (Backtest)
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem' }}>
                  {wfSummary.top_symbols.map(s => (
                    <div key={s.symbol} style={{ background: 'var(--surface-2, #1e293b)', borderRadius: '6px', padding: '.4rem .75rem', border: '1px solid var(--border)', fontSize: '.78rem' }}>
                      <strong>{s.symbol}</strong>
                      <span style={{ color: s.accuracy >= 0.6 ? '#22c55e' : '#fbbf24', marginLeft: '.4rem' }}>
                        {(s.accuracy * 100).toFixed(0)}%
                      </span>
                      <span style={{ color: 'var(--text-muted)', fontSize: '.65rem', marginLeft: '.3rem' }}>({s.n})</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Tahmin Geçmişi Tablosu */}
      <div style={{ background: 'var(--surface)', borderRadius: '16px', border: '1px solid var(--border)', overflow: 'hidden', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)' }}>
        <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.02)' }}>
          <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            📊 Saha Raporu <span style={{ fontSize: '0.85rem', fontWeight: 400, color: 'var(--text-dim)', background: 'var(--background)', padding: '0.2rem 0.6rem', borderRadius: '1rem', border: '1px solid var(--border)' }}>Son 50 Tahmin Odaklı Doğrulama</span>
          </h2>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '800px' }}>
            <thead style={{ background: 'rgba(0,0,0,0.2)' }}>
              <tr>
                <th style={{ padding: '1rem 1.5rem', fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Zaman</th>
                <th style={{ padding: '1rem 1.5rem', fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Sembol</th>
                <th style={{ padding: '1rem 1.5rem', fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Sinyal (Model)</th>
                <th style={{ padding: '1rem 1.5rem', fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right' }}>Anlık Fiyat</th>
                <th style={{ padding: '1rem 1.5rem', fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right' }}>Hedef Fiyat</th>
                <th style={{ padding: '1rem 1.5rem', fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'center' }}>+1 Gün</th>
                <th style={{ padding: '1rem 1.5rem', fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'center' }}>+5 Gün</th>
                <th style={{ padding: '1rem 1.5rem', fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'center' }}>+20 Gün</th>
              </tr>
            </thead>
            <tbody>
              {evaluations.map((ev, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)', transition: 'background 0.2s', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                  <td style={{ padding: '1rem 1.5rem', color: 'var(--text-dim)', fontSize: '0.85rem' }}>
                    {new Date(ev.timestamp).toLocaleString('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td style={{ padding: '1rem 1.5rem', fontWeight: 600 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: ev.predicted.includes('BUY') ? '#22c55e' : ev.predicted.includes('SELL') ? '#ef4444' : '#fbbf24' }} />
                      {ev.symbol}
                    </div>
                  </td>
                  <td style={{ padding: '1rem 1.5rem' }}>
                    <div style={{ padding: '0.25rem 0.75rem', borderRadius: '99px', fontSize: '0.75rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '0.4rem', background: ev.predicted.includes('BUY') ? 'rgba(34, 197, 94, 0.1)' : ev.predicted.includes('SELL') ? 'rgba(239, 68, 68, 0.1)' : 'rgba(251, 191, 36, 0.1)', color: ev.predicted.includes('BUY') ? '#4ade80' : ev.predicted.includes('SELL') ? '#f87171' : '#fcd34d', border: `1px solid ${ev.predicted.includes('BUY') ? 'rgba(34, 197, 94, 0.2)' : ev.predicted.includes('SELL') ? 'rgba(239, 68, 68, 0.2)' : 'rgba(251, 191, 36, 0.2)'}` }}>
                      {ev.predicted}
                      <span style={{ opacity: 0.7, fontSize: '0.7rem' }}>{(ev.confidence * 100).toFixed(0)}%</span>
                    </div>
                  </td>
                  <td style={{ padding: '1rem 1.5rem', textAlign: 'right', fontFamily: 'monospace', fontSize: '0.9rem', color: 'var(--text-muted)' }}>{fmt(ev.close)}</td>
                  <td style={{ padding: '1rem 1.5rem', textAlign: 'right', fontFamily: 'monospace', fontSize: '0.9rem', color: ev.predicted.includes('BUY') ? '#4ade80' : ev.predicted.includes('SELL') ? '#f87171' : 'var(--text-muted)' }}>
                    {ev.target > 0 ? fmt(ev.target) : '—'}
                  </td>
                  <td style={{ padding: '1rem 1.5rem', textAlign: 'center' }}>{renderEval(ev.eval1d)}</td>
                  <td style={{ padding: '1rem 1.5rem', textAlign: 'center' }}>{renderEval(ev.eval5d)}</td>
                  <td style={{ padding: '1rem 1.5rem', textAlign: 'center' }}>{renderEval(ev.eval20d)}</td>
                </tr>
              ))}
              {evaluations.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-dim)' }}>
                    <div style={{ fontSize: '2rem', marginBottom: '1rem', opacity: 0.5 }}>📊</div>
                    Henüz değerlendirilmiş bir tahmin kaydı bulunmamaktadır.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ── Ana Uygulama ──────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab]           = useState<'overview' | 'oracle' | 'news' | 'fundamental' | 'mlops'>('overview')
  const [assets, setAssets]     = useState<PriceData[]>([])
  const [oracle, setOracle]     = useState<OracleAnalysis[]>([])
  const [news, setNews]         = useState<NewsSignal[]>([])
  const [fundamentals, setFundamentals] = useState<FundamentalData[]>([])
  const [selected, setSelected] = useState<PriceData | null>(null)
  const [loading, setLoading]   = useState(true)
  const [lastUpdate, setLastUpdate] = useState('')
  const [oracleFilter, setOracleFilter] = useState<string>('TÜM')
  const [sysStatus, setSysStatus] = useState<SystemStatus | null>(null)

  const fetchAll = useCallback(async () => {
    try {
      const [assetsRes, oracleRes, newsRes, statusRes, fundRes] = await Promise.allSettled([
        fetch(`${API}/market/overview`),
        fetch(`${API}/oracle/overview`),
        fetch(`${API}/signals/latest?limit=40`),
        fetch(`${API}/status`),
        fetch(`${API}/fundamental/overview`),
      ])

      if (assetsRes.status === 'fulfilled' && assetsRes.value.ok) {
        const d: PriceData[] = await assetsRes.value.json()
        setAssets(d)
        setSelected(prev => prev ? d.find(x => x.symbol === prev.symbol) ?? prev : prev)
        setLastUpdate(new Date().toLocaleTimeString('tr-TR'))
      }
      if (oracleRes.status === 'fulfilled' && oracleRes.value.ok)
        setOracle(await oracleRes.value.json())
      if (newsRes.status === 'fulfilled' && newsRes.value.ok)
        setNews(await newsRes.value.json())
      if (statusRes.status === 'fulfilled' && statusRes.value.ok)
        setSysStatus(await statusRes.value.json())
      if (fundRes.status === 'fulfilled' && fundRes.value.ok)
        setFundamentals(await fundRes.value.json())
    } catch { /* bağlantı henüz yok */ }
  }, [])

  useEffect(() => {
    fetchAll().finally(() => setLoading(false))
    const t = setInterval(fetchAll, 30_000)
    return () => clearInterval(t)
  }, [fetchAll])

  const bist      = assets.filter(a => a.assetType === 'BIST')
  const commodity = assets.filter(a => a.assetType === 'COMMODITY')
  const forex     = assets.filter(a => a.assetType === 'FOREX')
  const global    = assets.filter(a => a.assetType === 'GLOBAL')

  const FILTERS = ['TÜM', 'GÜÇLÜ ALIM', 'ALIM', 'NÖTR', 'KAÇIN', 'GÜÇLÜ KAÇIN']
  const filteredOracle = oracleFilter === 'TÜM'
    ? oracle
    : oracle.filter(o => o.recommendation === oracleFilter)

  return (
    <>
      <header className="app-header">
        <div className="logo">Ser<span>Invest</span></div>
        <div className="header-meta">
          {assets.length > 0 && <><span className="live-dot" /><span>Canlı</span></>}
          {lastUpdate && <span>Son güncelleme: {lastUpdate}</span>}
          <span>{assets.length} varlık</span>
          {oracle.length > 0 && <span>{oracle.length} Oracle analizi</span>}
        </div>
      </header>

      <main className="main">
        <div className="tabs">
          <button className={`tab-btn${tab === 'overview' ? ' active' : ''}`} onClick={() => setTab('overview')}>
            Piyasa Genel
          </button>
          <button className={`tab-btn${tab === 'oracle' ? ' active' : ''}`} onClick={() => setTab('oracle')}>
            AI Tavsiye {oracle.length > 0 && `(${oracle.length})`}
          </button>
          <button className={`tab-btn${tab === 'news' ? ' active' : ''}`} onClick={() => setTab('news')}>
            Haberler {news.length > 0 && `(${news.length})`}
          </button>
          <button className={`tab-btn${tab === 'fundamental' ? ' active' : ''}`} onClick={() => setTab('fundamental')}>
            Temel Analiz {fundamentals.length > 0 && `(${fundamentals.length})`}
          </button>
          <button className={`tab-btn${tab === 'mlops' ? ' active' : ''}`} onClick={() => setTab('mlops')}>
            ML Ops Konsolu
          </button>
        </div>

        {loading && (
          <div className="loading"><div className="spinner" /><span>Servisler başlatılıyor...</span></div>
        )}

        {!loading && (
          <StatusBanner
            status={sysStatus}
            assetsReady={assets.length > 0}
            oracleReady={oracle.length > 0}
            newsReady={news.length > 0}
          />
        )}

        {/* ── Piyasa Genel ── */}
        {!loading && tab === 'overview' && (
          <>
            {selected && <DetailPanel data={selected} />}
            {[['BIST Hisseleri', bist], ['Emtialar', commodity], ['Döviz', forex]].map(([title, list]) =>
              (list as PriceData[]).length > 0 ? (
                <div key={title as string}>
                  <div className="section-head">
                    <span className="section-title">{title as string}</span>
                  </div>
                  <div className="asset-grid">
                    {(list as PriceData[]).map(a => (
                      <AssetCard key={a.symbol} data={a}
                        selected={selected?.symbol === a.symbol}
                        onClick={() => setSelected(prev => prev?.symbol === a.symbol ? null : a)}
                      />
                    ))}
                  </div>
                </div>
              ) : null
            )}

            {/* ── Küresel Piyasalar (Makro Bağlam) ── */}
            {global.length > 0 && (
              <div>
                <div className="section-head">
                  <span className="section-title">Küresel Piyasalar</span>
                  <span style={{ fontSize: '.72rem', color: 'var(--text-muted)', marginLeft: '.75rem' }}>
                    BİST ile korelasyon · Risk iştahı barometreleri
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '.75rem' }}>
                  {global.map(a => {
                    const isVix = a.symbol === 'VIX'
                    const vixLevel = isVix && a.close != null
                      ? a.close < 20 ? { label: 'Düşük Risk', color: '#22c55e' }
                      : a.close < 30 ? { label: 'Orta Risk', color: '#f59e0b' }
                      : { label: 'Yüksek Risk', color: '#ef4444' }
                      : null
                    const desc: Record<string, string> = {
                      SP500: 'Risk iştahı', NASDAQ: 'Teknoloji', DAX: 'Avrupa',
                      VIX: 'Korku Endeksi', DXY: 'Dolar Gücü', MSCI_EM: 'Gelişen Piy.',
                    }
                    return (
                      <div key={a.symbol} style={{
                        background: 'var(--surface)', border: '1px solid var(--border)',
                        borderRadius: '10px', padding: '.85rem 1rem',
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '.4rem' }}>
                          <span style={{ fontWeight: 800, fontSize: '.95rem' }}>{a.symbol}</span>
                          {isVix && vixLevel && (
                            <span style={{ fontSize: '.65rem', padding: '.1rem .45rem', borderRadius: '4px',
                              background: vixLevel.color + '22', color: vixLevel.color, fontWeight: 700 }}>
                              {vixLevel.label}
                            </span>
                          )}
                          {!isVix && (
                            <span style={{ fontSize: '.65rem', padding: '.1rem .45rem', borderRadius: '4px',
                              background: a.signal === 'BUY' ? 'rgba(34,197,94,.15)' : a.signal === 'SELL' ? 'rgba(239,68,68,.15)' : 'rgba(148,163,184,.1)',
                              color: a.signal === 'BUY' ? '#22c55e' : a.signal === 'SELL' ? '#ef4444' : '#94a3b8', fontWeight: 700 }}>
                              {a.signal}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '.72rem', color: 'var(--text-muted)', marginBottom: '.5rem' }}>
                          {desc[a.symbol] ?? a.symbol}
                        </div>
                        <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>
                          {fmt(a.close, a.symbol === 'VIX' ? 1 : a.symbol === 'DXY' ? 2 : 0)}
                        </div>
                        {a.rsi != null && !isVix && (
                          <div style={{ fontSize: '.7rem', color: 'var(--text-muted)', marginTop: '.3rem' }}>
                            RSI {fmt(a.rsi, 1)}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {assets.length === 0 && (
              <div className="empty">
                <p>Henüz piyasa verisi yok.</p>
                <p style={{ marginTop: '.5rem', fontSize: '.8rem' }}>market-data-service başlatıldıktan ~5 dakika sonra görünecektir.</p>
              </div>
            )}
          </>
        )}

        {/* ── AI Tavsiye ── */}
        {!loading && tab === 'oracle' && (
          <>
            <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
              {FILTERS.map(f => (
                <button key={f}
                  onClick={() => setOracleFilter(f)}
                  style={{
                    padding: '.3rem .85rem', borderRadius: '999px', border: '1px solid var(--border)',
                    background: oracleFilter === f ? 'var(--yellow)' : 'var(--surface)',
                    color: oracleFilter === f ? '#0a0f1e' : 'var(--text-muted)',
                    fontWeight: oracleFilter === f ? 700 : 400,
                    cursor: 'pointer', fontSize: '.78rem', transition: 'all .15s',
                  }}>
                  {f}
                </button>
              ))}
            </div>

            {filteredOracle.length === 0 ? (
              <div className="empty">
                {oracle.length === 0
                  ? 'AI Oracle henüz çalışmadı. İlk analiz yaklaşık 2 dakika içinde gelecektir.'
                  : 'Bu filtreye uyan sonuç bulunamadı.'}
              </div>
            ) : (
              <div className="oracle-grid">
                {filteredOracle.map(o => <OracleCard key={o.id} data={o} />)}
              </div>
            )}
          </>
        )}

        {/* ── Haberler ── */}
        {!loading && tab === 'news' && <NewsFeed news={news} />}

        {/* ── Temel Analiz ── */}
        {!loading && tab === 'fundamental' && (
          <FundamentalTab data={fundamentals} />
        )}

        {/* ── ML Ops Konsolu ── */}
        {!loading && tab === 'mlops' && (
          <MLOpsTab />
        )}
      </main>
    </>
  )
}
