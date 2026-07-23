import { DailyChangeBadge } from './DailyChangeBadge'

/**
 * Üst barda her tab'da görünen makro ticker şeridi.
 * USDTRY, BIST100, Altın, Brent gibi önemli göstergeleri canlı gösterir.
 */
interface TickerData {
  symbol: string
  label: string
  close: number | null
  open: number | null
  decimals?: number
  unit?: string
}

interface MacroTickerProps {
  items: TickerData[]
}

export function MacroTicker({ items }: MacroTickerProps) {
  return (
    <div style={{
      display: 'flex',
      gap: 'var(--space-4)',
      alignItems: 'center',
      flexWrap: 'wrap',
      paddingRight: 'var(--space-4)',
    }}>
      {items.map(t => {
        if (t.close == null) return null
        const changePct = t.open && t.open > 0 ? (t.close - t.open) / t.open : null
        const dec = t.decimals ?? 2

        return (
          <div key={t.symbol} style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            paddingRight: 'var(--space-3)',
            borderRight: '1px solid var(--border-default)',
          }}>
            <span style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              fontWeight: 'var(--fw-bold)',
              minWidth: '40px',
            }}>
              {t.label}
            </span>
            <span style={{
              fontSize: 'var(--text-sm)',
              fontWeight: 'var(--fw-bold)',
              color: 'var(--text-primary)',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {t.close.toLocaleString('tr-TR', { minimumFractionDigits: dec, maximumFractionDigits: dec })}
              {t.unit && <span style={{ color: 'var(--text-muted)', marginLeft: '2px' }}>{t.unit}</span>}
            </span>
            <DailyChangeBadge changePct={changePct} size="sm" />
          </div>
        )
      })}
    </div>
  )
}
