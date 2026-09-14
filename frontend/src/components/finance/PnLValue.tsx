/**
 * Kar/Zarar değerlerini renklendirilmiş, formatlı, tabular-nums hizalı göster.
 * Pozitif: yeşil + "+" prefix    Negatif: kırmızı    Sıfır: nötr.
 */
import { fmt, oranYuzde } from '../../lib/format'
interface PnLValueProps {
  value: number
  format?: 'tl' | 'pct' | 'plain'
  size?: 'sm' | 'md' | 'lg' | 'xl'
  showSign?: boolean
  showArrow?: boolean
  decimals?: number
  inline?: boolean
}

const sizeMap = {
  sm: 'var(--text-sm)',
  md: 'var(--text-base)',
  lg: 'var(--text-lg)',
  xl: 'var(--text-2xl)',
}

export function PnLValue({
  value, format = 'tl', size = 'md',
  showSign = true, showArrow = false, decimals,
  inline,
}: PnLValueProps) {
  const isProfit = value > 0
  const isLoss = value < 0
  const color = isProfit ? 'var(--profit)' : isLoss ? 'var(--loss)' : 'var(--text-secondary)'

  const dec = decimals ?? (format === 'pct' ? 2 : 2)
  const sign = showSign && isProfit ? '+' : ''
  const arrow = showArrow ? (isProfit ? '▲ ' : isLoss ? '▼ ' : '') : ''

  // İşaret aşağıda (ok/eksi) ayrıca konuyor; burada mutlak değer biçimlenir.
  let formatted: string
  if (format === 'pct') {
    formatted = oranYuzde(Math.abs(value), dec)
  } else if (format === 'tl') {
    formatted = `${fmt(Math.abs(value), dec)} ₺`
  } else {
    formatted = fmt(Math.abs(value), dec)
  }

  // Negatif gösterim: arrow yoksa minus, arrow varsa zaten okun var
  const display = isLoss && !showArrow
    ? `-${formatted.replace(/^-/, '')}`
    : `${arrow}${sign}${formatted}`

  return (
    <span style={{
      fontSize: sizeMap[size],
      fontWeight: 'var(--fw-bold)',
      color,
      fontVariantNumeric: 'tabular-nums',
      whiteSpace: 'nowrap',
      display: inline ? 'inline' : undefined,
    }}>
      {display}
    </span>
  )
}
