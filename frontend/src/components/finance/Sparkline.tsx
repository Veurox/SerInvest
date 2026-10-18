import { useEffect, useState } from 'react'

const API = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8080/api'

/**
 * Mini sparkline — sembolün son N günlük fiyat çizgisi.
 * Yükselişte yeşil, düşüşte kırmızı.
 */
interface SparklineProps {
  symbol: string
  days?: number
  width?: number
  height?: number
  showAxis?: boolean
}

const cache: Record<string, { ts: number; points: number[] }> = {}
const CACHE_TTL = 5 * 60 * 1000   // 5 dk

export function Sparkline({
  symbol, days = 7, width = 80, height = 28, showAxis,
}: SparklineProps) {
  // Noktalar modül önbelleğinden okunur; efekt yalnız eksik ya da bayatsa
  // çeker ve bitince yeniden çizdirir (eskiden önbellek isabetinde efekt
  // içinde senkron setState vardı — fazladan bir render).
  const anahtar = `${symbol}:${days}`
  const [, yenidenCiz] = useState(0)
  const points = cache[anahtar]?.points ?? null

  useEffect(() => {
    const c = cache[anahtar]
    if (c && Date.now() - c.ts < CACHE_TTL) return

    let cancelled = false
    fetch(`${API}/market/price-history/${symbol}?days=${days}`)
      .then(r => r.ok ? r.json() : null)
      .then((data: { points?: { close: number | null }[] } | null) => {
        if (cancelled || !data?.points) return
        const pts = data.points
          .map(p => p.close)
          .filter((v): v is number => v != null)
        cache[anahtar] = { ts: Date.now(), points: pts }
        yenidenCiz(n => n + 1)
      })
      .catch(() => {})

    return () => { cancelled = true }
  }, [anahtar, symbol, days])

  if (!points || points.length < 2) {
    return (
      <div style={{ width, height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span className="skeleton" style={{ width: width * 0.7, height: 2 }} />
      </div>
    )
  }

  const min = Math.min(...points)
  const max = Math.max(...points)
  const range = max - min || 1
  const isUp = points[points.length - 1] >= points[0]
  const color = isUp ? 'var(--profit)' : 'var(--loss)'
  const fill = isUp ? 'var(--profit-bg)' : 'var(--loss-bg)'

  // SVG path
  const stepX = width / (points.length - 1)
  const yFor = (v: number) => height - ((v - min) / range) * height
  const path = points.map((v, i) => `${i === 0 ? 'M' : 'L'} ${i * stepX} ${yFor(v)}`).join(' ')
  const fillPath = `${path} L ${width} ${height} L 0 ${height} Z`

  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <path d={fillPath} fill={fill} />
      <path d={path} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      {showAxis && (
        <line x1={0} y1={yFor(points[0])} x2={width} y2={yFor(points[0])}
          stroke="var(--text-disabled)" strokeWidth={0.5} strokeDasharray="2 2" />
      )}
    </svg>
  )
}
