// =============================================================================
// SerInvest — Sektör Isı Haritası  (TradingView tarzı)
// BIST hisselerini sektöre göre gruplar; günlük % değişime göre renk verir.
// =============================================================================
import { useMemo, useState } from 'react'
import type { PriceData } from '../../lib/types'

// ── Sektör haritası ──────────────────────────────────────────────────────────
const SECTOR: Record<string, string> = {
  // Bankacılık
  GARAN: 'Bankacılık', AKBNK: 'Bankacılık', ISCTR: 'Bankacılık',
  HALKB: 'Bankacılık', VAKBN: 'Bankacılık', YKBNK: 'Bankacılık',
  TSKB:  'Bankacılık', SKBNK: 'Bankacılık', ALBRK: 'Bankacılık',
  // Holding
  KCHOL: 'Holding', SAHOL: 'Holding', DOHOL: 'Holding',
  ALARK: 'Holding', TKFEN: 'Holding', BERA: 'Holding', AGHOL: 'Holding',
  // Havacılık & Ulaşım
  THYAO: 'Havacılık', PGSUS: 'Havacılık', TAVHL: 'Havacılık',
  // Otomotiv
  FROTO: 'Otomotiv', TOASO: 'Otomotiv', DOAS: 'Otomotiv',
  TTRAK: 'Otomotiv', OTKAR: 'Otomotiv', KARSN: 'Otomotiv', BRISA: 'Otomotiv',
  // Teknoloji & Elektronik
  ASELS: 'Teknoloji', VESTL: 'Teknoloji', ARCLK: 'Teknoloji',
  KAREL: 'Teknoloji', MIATK: 'Teknoloji', PENTA: 'Teknoloji', KONTR: 'Teknoloji',
  // Enerji
  TUPRS: 'Enerji', AKSEN: 'Enerji', ZOREN: 'Enerji', ENJSA: 'Enerji',
  ODAS: 'Enerji', ASTOR: 'Enerji', SMRTG: 'Enerji', AKFYE: 'Enerji',
  CWENE: 'Enerji', GESAN: 'Enerji', BIOEN: 'Enerji', EGEEN: 'Enerji',
  // Petrokimya
  PETKM: 'Petrokimya', SASA: 'Petrokimya', AKSA: 'Petrokimya',
  // Demir-Çelik
  EREGL: 'Demir-Çelik', KRDMD: 'Demir-Çelik', KCAER: 'Demir-Çelik', BRSAN: 'Demir-Çelik',
  // Telekomünikasyon
  TTKOM: 'Telekom', TCELL: 'Telekom',
  // Perakende & Gıda
  BIMAS: 'Perakende', MGROS: 'Perakende', SOKM: 'Perakende',
  MAVI: 'Perakende', TABGD: 'Gıda', ULKER: 'Gıda', TUKAS: 'Gıda',
  // İçecek
  AEFES: 'İçecek', CCOLA: 'İçecek',
  // GYO
  EKGYO: 'GYO', AKSGY: 'GYO', AKFGY: 'GYO',
  // Cam & İnşaat
  SISE: 'Cam', ENKAI: 'İnşaat', BIENY: 'İnşaat',
  // Çimento
  AKCNS: 'Çimento', CIMSA: 'Çimento', OYAKC: 'Çimento',
  BUCIM: 'Çimento', GOLTS: 'Çimento', KONYA: 'Çimento',
  // Sağlık
  MPARK: 'Sağlık', ECILC: 'Sağlık',
  // Tarım
  GUBRF: 'Tarım', HEKTS: 'Tarım',
  // Sigorta
  ANHYT: 'Sigorta', ANSGR: 'Sigorta', TURSG: 'Sigorta',
}

function colorFor(pct: number) {
  const c = Math.max(-4, Math.min(4, pct))
  const intensity = Math.abs(c) / 4
  if (c > 0.1)  return { bg: `rgba(5,150,105,${(0.15 + intensity * 0.65).toFixed(2)})`, text: intensity > 0.45 ? '#fff' : 'var(--text-primary)' }
  if (c < -0.1) return { bg: `rgba(220,38,38,${(0.12 + intensity * 0.65).toFixed(2)})`,  text: intensity > 0.45 ? '#fff' : 'var(--text-primary)' }
  return { bg: 'var(--bg-surface-2)', text: 'var(--text-secondary)' }
}

interface SectorCell {
  sector: string
  pct: number
  count: number
  symbols: { sym: string; pct: number }[]
}

export function SectorHeatmap({ assets, onSelect }: {
  assets: PriceData[]
  onSelect?: (symbol: string) => void
}) {
  const [expanded, setExpanded] = useState<string | null>(null)

  const sectors = useMemo<SectorCell[]>(() => {
    const bist = assets.filter(a => a.assetType === 'BIST' && a.close != null && a.open != null && a.open > 0)
    const map = new Map<string, { total: number; count: number; syms: { sym: string; pct: number }[] }>()

    for (const a of bist) {
      const sector = SECTOR[a.symbol] ?? 'Diğer'
      const pct = ((a.close! - a.open!) / a.open!) * 100
      if (!map.has(sector)) map.set(sector, { total: 0, count: 0, syms: [] })
      const entry = map.get(sector)!
      entry.total += pct
      entry.count++
      entry.syms.push({ sym: a.symbol, pct })
    }

    return [...map.entries()]
      .map(([sector, { total, count, syms }]) => ({
        sector, pct: total / count, count,
        symbols: syms.sort((a, b) => b.pct - a.pct),
      }))
      .filter(s => s.sector !== 'Diğer')
      .sort((a, b) => b.pct - a.pct)
  }, [assets])

  if (sectors.length === 0) return null

  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-lg)',
      padding: 'var(--space-4)',
      marginBottom: 'var(--space-4)',
    }}>
      <div style={{
        fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
        textTransform: 'uppercase', letterSpacing: '0.06em',
        fontWeight: 'var(--fw-bold)', marginBottom: 'var(--space-3)',
      }}>
        Sektör Hareketleri (Bugün)
      </div>

      {/* Sektör kutucukları */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {sectors.map(s => {
          const col = colorFor(s.pct)
          const isOpen = expanded === s.sector
          return (
            <div key={s.sector} style={{ position: 'relative' }}>
              <button
                onClick={() => setExpanded(isOpen ? null : s.sector)}
                style={{
                  background: col.bg,
                  color: col.text,
                  border: `1px solid ${isOpen ? 'var(--accent)' : 'transparent'}`,
                  borderRadius: 'var(--radius-sm)',
                  padding: '8px 12px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  minWidth: 100,
                  transition: 'transform .12s, border-color .12s',
                }}
                onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.03)')}
                onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
              >
                <div style={{ fontSize: 11, fontWeight: 800, marginBottom: 2 }}>{s.sector}</div>
                <div style={{
                  fontSize: 13, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
                  color: s.pct >= 0 ? 'inherit' : 'inherit',
                }}>
                  {s.pct >= 0 ? '+' : ''}{s.pct.toFixed(2)}%
                </div>
                <div style={{ fontSize: 9, opacity: 0.75, marginTop: 1 }}>{s.count} hisse</div>
              </button>

              {/* Expand dropdown */}
              {isOpen && (
                <>
                  <div onClick={() => setExpanded(null)}
                       style={{ position: 'fixed', inset: 0, zIndex: 90 }} />
                  <div style={{
                    position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 100,
                    background: 'var(--bg-surface)', border: '1px solid var(--border-strong)',
                    borderRadius: 'var(--radius-sm)', padding: 8,
                    minWidth: 140, boxShadow: 'var(--shadow-md)',
                  }}>
                    {s.symbols.map(sym => {
                      const c2 = colorFor(sym.pct)
                      return (
                        <button key={sym.sym}
                          onClick={() => { onSelect?.(sym.sym); setExpanded(null) }}
                          style={{
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            width: '100%', padding: '5px 8px', border: 'none',
                            background: 'transparent', cursor: 'pointer',
                            borderRadius: 'var(--radius-xs)', gap: 12,
                          }}
                          onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-surface-2)')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                        >
                          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>
                            {sym.sym}
                          </span>
                          <span style={{
                            fontSize: 11, fontWeight: 700, color: c2.text === '#fff'
                              ? (sym.pct >= 0 ? 'var(--profit)' : 'var(--loss)')
                              : (sym.pct >= 0 ? 'var(--profit)' : 'var(--loss)'),
                            fontVariantNumeric: 'tabular-nums',
                          }}>
                            {sym.pct >= 0 ? '+' : ''}{sym.pct.toFixed(2)}%
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
