// =============================================================================
// SerInvest — Terminal  (route: /terminal)
// Pro yoğunlukta bento dashboard: ticker · AI karar merkezi · duyarlılık radarı ·
// fiyat-vs-bariyer grafiği · paper pozisyonlar · model sağlığı · olay bandı.
// Veri: Outlet context (assets/oracle/news) + aggregate + oracle admin proxy.
// =============================================================================
import { useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import type { SharedData } from '../App'
import {
  TickerTape, DecisionCenter, SentimentRadar, TerminalChart,
  PaperPositions, ModelHealth, EventTape, MarketCommentary, latestBySymbol,
} from '../components/terminal'

export default function TerminalPage() {
  const { assets, oracle, news } = useOutletContext<SharedData>()

  const latest = useMemo(() => latestBySymbol(oracle), [oracle])

  // Varsayılan sembol: en güvenli AL sinyali → yoksa ilk BIST hissesi
  const defaultSymbol = useMemo(() => {
    const buys = [...latest.values()]
      .filter(o => o.recommendation.includes('ALIM'))
      .sort((a, b) => b.confidence - a.confidence)
    return buys[0]?.symbol
      ?? assets.find(a => a.assetType === 'BIST')?.symbol
      ?? 'THYAO'
  }, [latest, assets])

  const [picked, setPicked] = useState<string | null>(null)
  const symbol = picked ?? defaultSymbol
  const analysis = latest.get(symbol) ?? null

  return (
    <div className="terminal-page">
      <TickerTape assets={assets} onSelect={setPicked} />
      <DecisionCenter oracle={oracle} selected={symbol} onSelect={setPicked} />
      <TerminalChart symbol={symbol} analysis={analysis} />
      <SentimentRadar />
      <MarketCommentary />
      <PaperPositions onSelect={setPicked} />
      <ModelHealth />
      <EventTape news={news} />
    </div>
  )
}
