// =============================================================================
// SerInvest — Haber Feed'i
// Kategori + sentiment filtreli haber listesi; her haber genişleyebilir kart.
// =============================================================================
import { useState } from 'react'
import type { NewsSignal } from '../../lib/types'

type NewsCategory = 'TÜM' | 'BIST' | 'EMTİA' | 'KÜRESEL' | 'MAKRO'

const NEWS_CATEGORIES: { key: NewsCategory; label: string }[] = [
  { key: 'TÜM',     label: 'Tümü' },
  { key: 'BIST',    label: 'BIST' },
  { key: 'EMTİA',   label: 'Emtialar' },
  { key: 'KÜRESEL', label: 'Küresel' },
  { key: 'MAKRO',   label: 'Ekonomi & Makro' },
]

const GLOBAL_ENTITIES = new Set([
  'NASDAQ', 'SP500', 'DJI', 'GLOBAL', 'GLOBAL MARKET', 'MACRO_GLOBAL', 'BIST100', 'DAX', 'MSCI_EM',
])

function classifyNews(item: NewsSignal): NewsCategory {
  if (item.assetType === 'BIST') return 'BIST'
  if (item.assetType === 'COMMODITY') return 'EMTİA'
  const ent = (item.entity ?? '').toUpperCase()
  if (GLOBAL_ENTITIES.has(ent)) return 'KÜRESEL'
  return 'MAKRO'  // MACRO + GENERAL + FOREX + diğerleri
}

function sentimentMeta(label: string) {
  if (label === 'BULLISH') return { color: '#22c55e', bg: 'rgba(34,197,94,.12)',  border: 'rgba(34,197,94,.25)',  icon: '▲', text: 'Yükseliş' }
  if (label === 'BEARISH') return { color: '#ef4444', bg: 'rgba(239,68,68,.12)',  border: 'rgba(239,68,68,.25)',  icon: '▼', text: 'Düşüş' }
  return                          { color: '#94a3b8', bg: 'rgba(148,163,184,.08)', border: 'rgba(148,163,184,.2)', icon: '●', text: 'Nötr' }
}

function NewsCard({ item }: { item: NewsSignal }) {
  const [expanded, setExpanded] = useState(false)
  const sm = sentimentMeta(item.sentimentLabel)
  const ts = new Date(item.createdAt.endsWith('Z') ? item.createdAt : item.createdAt + 'Z')
  const now = new Date()
  const diffMin = Math.floor((now.getTime() - ts.getTime()) / 60000)
  const timeStr = diffMin < 1 ? 'şimdi' : diffMin < 60 ? `${diffMin}dk önce`
    : diffMin < 1440 ? `${Math.floor(diffMin / 60)}sa önce`
    : ts.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' })

  return (
    <div
      onClick={() => setExpanded(e => !e)}
      style={{
        background: 'var(--surface)', border: `1px solid ${expanded ? sm.border : 'var(--border)'}`,
        borderRadius: '10px', padding: '.85rem 1rem', cursor: 'pointer',
        transition: 'border-color .15s, background .15s',
      }}
      onMouseEnter={e => { if (!expanded) e.currentTarget.style.borderColor = sm.border }}
      onMouseLeave={e => { if (!expanded) e.currentTarget.style.borderColor = 'var(--border)' }}
    >
      {/* Üst satır: sentiment pill + başlık + zaman */}
      <div style={{ display: 'flex', gap: '.75rem', alignItems: 'flex-start' }}>
        <div style={{
          flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center',
          gap: '.2rem', paddingTop: '.1rem',
        }}>
          <span style={{
            fontSize: '.65rem', fontWeight: 800, color: sm.color,
            background: sm.bg, border: `1px solid ${sm.border}`,
            padding: '.15rem .4rem', borderRadius: '5px', letterSpacing: '.03em',
          }}>
            {sm.icon} {sm.text}
          </span>
        </div>

        {/* Başlık */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: '.875rem', fontWeight: 600, color: 'var(--text)',
            lineHeight: 1.45, marginBottom: '.35rem',
            overflow: 'hidden', display: '-webkit-box',
            WebkitLineClamp: expanded ? 'unset' : 2,
            WebkitBoxOrient: 'vertical',
          }}>
            {item.headline || item.summary?.slice(0, 120) || '(Başlık yok)'}
          </div>

          {/* Meta satırı */}
          <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{
              fontSize: '.67rem', color: 'var(--text-muted)', background: 'var(--surface-2)',
              padding: '.1rem .45rem', borderRadius: '4px', border: '1px solid var(--border)',
            }}>
              {item.source}
            </span>
            <span style={{
              fontSize: '.67rem', fontWeight: 700, color: sm.color,
              background: sm.bg, padding: '.1rem .45rem', borderRadius: '4px',
              border: `1px solid ${sm.border}`,
            }}>
              {item.entity}
            </span>
            {item.isGeopolitical && (
              <span style={{ fontSize: '.67rem', color: '#f97316', background: 'rgba(249,115,22,.1)', padding: '.1rem .4rem', borderRadius: '4px', border: '1px solid rgba(249,115,22,.25)' }}>
                Jeopolitik
              </span>
            )}
            <span style={{ fontSize: '.67rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
              {timeStr}
            </span>
          </div>
        </div>

        {/* Expand ikonu */}
        <span style={{ flexShrink: 0, fontSize: '.65rem', color: 'var(--text-muted)', paddingTop: '.2rem' }}>
          {expanded ? '▲' : '▼'}
        </span>
      </div>

      {/* Özet (genişletilince) */}
      {expanded && item.summary && (
        <div style={{
          marginTop: '.75rem', paddingTop: '.75rem', borderTop: '1px solid var(--border)',
          fontSize: '.8rem', color: 'var(--text-dim)', lineHeight: 1.6,
        }}>
          {item.summary}
          {item.url && (
            <a href={item.url} target="_blank" rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              style={{ display: 'inline-block', marginTop: '.5rem', fontSize: '.75rem', color: sm.color }}>
              Habere git →
            </a>
          )}
        </div>
      )}
    </div>
  )
}

export function NewsFeed({ news }: { news: NewsSignal[] }) {
  const [category, setCategory] = useState<NewsCategory>('TÜM')
  const [sentFilter, setSentFilter] = useState<string>('TÜM')

  if (news.length === 0) return <div className="empty">Henüz haber yok. Analyst-engine haberler topluyor...</div>

  // Her kategori için sayıları hesapla
  const counts: Record<NewsCategory, number> = {
    'TÜM': news.length,
    'BIST': 0, 'EMTİA': 0, 'KÜRESEL': 0, 'MAKRO': 0,
  }
  news.forEach(n => { counts[classifyNews(n)]++ })

  const catFiltered = category === 'TÜM' ? news : news.filter(n => classifyNews(n) === category)
  const visible = sentFilter === 'TÜM' ? catFiltered
    : catFiltered.filter(n => n.sentimentLabel === sentFilter)

  const sentCounts = { BULLISH: 0, BEARISH: 0, NEUTRAL: 0 }
  catFiltered.forEach(n => {
    if (n.sentimentLabel in sentCounts) sentCounts[n.sentimentLabel as keyof typeof sentCounts]++
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

      {/* ── Kategori tab'ları ── */}
      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {NEWS_CATEGORIES.map(({ key, label }) => {
          const cnt = counts[key]
          const active = category === key
          return (
            <button key={key} className={`fpill${active ? ' on' : ''}`}
              onClick={() => { setCategory(key); setSentFilter('TÜM') }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
              <span>{label}</span>
              {cnt > 0 && <span style={{ opacity: 0.7 }}>({cnt})</span>}
            </button>
          )
        })}

        {/* Sentiment dağılımı */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '.35rem', alignItems: 'center', fontSize: '.72rem' }}>
          <span style={{ color: '#22c55e', fontWeight: 700 }}>▲{sentCounts.BULLISH}</span>
          <span style={{ color: '#94a3b8' }}>●{sentCounts.NEUTRAL}</span>
          <span style={{ color: '#ef4444', fontWeight: 700 }}>▼{sentCounts.BEARISH}</span>
        </div>
      </div>

      {/* ── Sentiment alt filtresi ── */}
      <div style={{ display: 'flex', gap: '.4rem' }}>
        {[
          { key: 'TÜM',     label: 'Tümü',       color: 'var(--text-muted)' },
          { key: 'BULLISH', label: '▲ Yükseliş', color: '#22c55e' },
          { key: 'NEUTRAL', label: '● Nötr',     color: '#94a3b8' },
          { key: 'BEARISH', label: '▼ Düşüş',    color: '#ef4444' },
        ].map(({ key, label, color }) => (
          <button key={key} onClick={() => setSentFilter(key)}
            style={{
              padding: '.2rem .65rem', borderRadius: '6px', fontSize: '.72rem',
              border: `1px solid ${sentFilter === key ? color + '55' : 'transparent'}`,
              background: sentFilter === key ? color + '15' : 'transparent',
              color: sentFilter === key ? color : 'var(--text-muted)',
              fontWeight: sentFilter === key ? 700 : 400, cursor: 'pointer',
            }}>
            {label}
          </button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: '.72rem', color: 'var(--text-muted)', alignSelf: 'center' }}>
          {visible.length} haber gösteriliyor
        </span>
      </div>

      {/* ── Haber listesi ── */}
      {visible.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)', fontSize: '.9rem' }}>
          Bu kategoride haber bulunamadı.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
          {visible.slice(0, 30).map(item => <NewsCard key={item.id} item={item} />)}
          {visible.length > 30 && (
            <div style={{ textAlign: 'center', fontSize: '.75rem', color: 'var(--text-muted)', padding: '.5rem' }}>
              + {visible.length - 30} daha fazla haber (API'den daha fazla çekmek için limit artırılabilir)
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default NewsFeed
