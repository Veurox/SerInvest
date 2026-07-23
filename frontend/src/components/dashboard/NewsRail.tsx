// =============================================================================
// SerInvest — Son Haberler (sağ rail)
// En yeni 5 başlık + duygu rengi. Tıkla → kaynağa; "tümü" → Haberler sayfası.
// =============================================================================
import { Link } from 'react-router-dom'
import type { NewsSignal } from '../../lib/types'

const relTime = (iso: string): string => {
  const t = new Date(iso).getTime()
  if (isNaN(t)) return ''
  const diff = (Date.now() - t) / 1000
  if (diff < 3600) return `${Math.max(1, Math.floor(diff / 60))}dk önce`
  if (diff < 86400) return `${Math.floor(diff / 3600)}sa önce`
  return `${Math.floor(diff / 86400)}g önce`
}

const sentColor = (score: number): string =>
  score > 0.15 ? 'var(--profit)' : score < -0.15 ? 'var(--loss)' : 'var(--text-muted)'

export function NewsRail({ news }: { news: NewsSignal[] }) {
  const items = [...news]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5)

  if (items.length === 0) return null

  return (
    <div className="rail-panel">
      <div className="rail-head">
        <span className="rail-title">Son Haberler</span>
        <Link to="/news" className="rail-link">tümü →</Link>
      </div>
      <div>
        {items.map(n => (
          <a key={n.id} href={n.url || undefined} target="_blank" rel="noopener noreferrer"
            style={{
              display: 'block', padding: '8px var(--space-4)', textDecoration: 'none',
              borderBottom: '0.5px solid var(--border-subtle)',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-surface-2)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, marginTop: 5,
                background: sentColor(n.sentimentScore) }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-primary)', lineHeight: 1.35,
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {n.headline}
                </div>
                <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>
                  {n.entity ? `${n.entity} · ` : ''}{n.source} · {relTime(n.createdAt)}
                </div>
              </div>
            </div>
          </a>
        ))}
      </div>
    </div>
  )
}
