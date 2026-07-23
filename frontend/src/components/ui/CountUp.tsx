import { useEffect, useRef, useState } from 'react'

interface CountUpProps {
  value: number
  decimals?: number
  duration?: number      // ms
  prefix?: string
  suffix?: string
  className?: string
  style?: React.CSSProperties
}

/**
 * Sayıyı animasyonla mevcut değerden yenisine sayar.
 * Değer değiştiğinde otomatik animasyon başlar.
 */
export function CountUp({
  value, decimals = 2, duration = 600,
  prefix = '', suffix = '',
  className, style,
}: CountUpProps) {
  const [displayed, setDisplayed] = useState(value)
  const startVal = useRef(value)
  const startTime = useRef(0)
  const rafId = useRef<number | undefined>(undefined)

  useEffect(() => {
    startVal.current = displayed
    startTime.current = performance.now()
    const target = value

    const tick = (now: number) => {
      const elapsed = now - startTime.current
      const t = Math.min(elapsed / duration, 1)
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3)
      const current = startVal.current + (target - startVal.current) * eased
      setDisplayed(current)
      if (t < 1) {
        rafId.current = requestAnimationFrame(tick)
      } else {
        setDisplayed(target)
      }
    }
    rafId.current = requestAnimationFrame(tick)
    return () => { if (rafId.current) cancelAnimationFrame(rafId.current) }
  }, [value, duration])    // displayed kasıtlı dışarda — yeni hedef geldiğinde yeniden başlasın

  const formatted = displayed.toLocaleString('tr-TR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })

  return (
    <span className={className} style={{ fontVariantNumeric: 'tabular-nums', ...style }}>
      {prefix}{formatted}{suffix}
    </span>
  )
}
