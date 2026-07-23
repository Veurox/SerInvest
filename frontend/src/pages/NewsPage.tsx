// =============================================================================
// SerInvest — Haberler Sayfası  (route: /news)
// PageHeader + duyarlılık özeti + NewsFeed (kategori/sentiment filtreli).
// =============================================================================
import { useOutletContext } from 'react-router-dom'
import { PageHeader, Icon } from '../components/ui'
import { NewsFeed } from '../components/news/NewsFeed'
import type { SharedData } from '../App'

export default function NewsPage() {
  const { news } = useOutletContext<SharedData>()
  const bull = news.filter(n => n.sentimentLabel === 'BULLISH').length
  const bear = news.filter(n => n.sentimentLabel === 'BEARISH').length

  return (
    <div style={{ paddingTop: 'var(--space-2)' }}>
      <PageHeader
        icon={<Icon name="news" size={20} />}
        title="Haberler"
        subtitle={`${news.length} haber · piyasa duyarlılığı (BIST · emtia · küresel · makro)`}
        right={
          <div style={{ display: 'flex', gap: 'var(--space-3)', fontSize: 'var(--text-sm)', fontWeight: 'var(--fw-bold)' }}>
            <span style={{ color: 'var(--profit)' }}>▲ {bull} olumlu</span>
            <span style={{ color: 'var(--loss)' }}>▼ {bear} olumsuz</span>
          </div>
        }
      />
      <NewsFeed news={news} />
    </div>
  )
}
