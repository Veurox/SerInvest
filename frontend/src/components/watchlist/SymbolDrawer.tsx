// =============================================================================
// SerInvest — Sembol Drawer
// İzleme listesinde bir sembole tıklayınca açılır: büyük grafik (ChartPanel) +
// teknik göstergeler + (varsa) AI tavsiyesi.
// =============================================================================
import { useEffect } from 'react'
import { ChartPanel, TechnicalSummary } from '../finance'
import { CompanyLogo } from '../common/CompanyLogo'
import { fmt, recColor } from '../../lib/format'
import { COMPANY_NAMES } from '../../lib/companies'
import type { PriceData, OracleAnalysis } from '../../lib/types'

const fmtVol = (v: number | null): string => {
  if (v == null) return '—'
  if (v >= 1e9) return `${(v / 1e9).toLocaleString('tr-TR', { maximumFractionDigits: 2 })}B`
  if (v >= 1e6) return `${(v / 1e6).toLocaleString('tr-TR', { maximumFractionDigits: 2 })}M`
  if (v >= 1e3) return `${(v / 1e3).toLocaleString('tr-TR', { maximumFractionDigits: 1 })}K`
  return v.toLocaleString('tr-TR', { maximumFractionDigits: 0 })
}

function Val({ k, v, color }: { k: string; v: React.ReactNode; color?: string }) {
  return (
    <div className="sym-val">
      <div className="k">{k}</div>
      <div className="v" style={{ color: color ?? 'var(--text-primary)' }}>{v}</div>
    </div>
  )
}

export function SymbolDrawer({
  symbol, asset, oracle, availableSymbols, apiBase, onClose,
}: {
  symbol: string
  asset: PriceData | undefined
  oracle: OracleAnalysis | undefined
  availableSymbols: string[]
  apiBase: string
  onClose: () => void
}) {
  // ESC ile kapat
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const dec = asset?.assetType === 'FOREX' ? 4 : 2
  const change = asset?.close != null && asset?.open != null ? asset.close - asset.open : null
  const changePct = change != null && asset?.open ? (change / asset.open) * 100 : null
  const chgColor = changePct == null ? 'var(--text-muted)' : changePct >= 0 ? 'var(--profit)' : 'var(--loss)'
  const company = COMPANY_NAMES[symbol]

  const sigColor = asset?.signal === 'BUY' ? 'var(--profit)' : asset?.signal === 'SELL' ? 'var(--loss)' : 'var(--text-muted)'
  const rsiColor = asset?.rsi == null ? 'var(--text-muted)' : asset.rsi > 70 ? 'var(--loss)' : asset.rsi < 30 ? 'var(--profit)' : 'var(--text-primary)'

  return (
    <div className="sym-drawer-overlay" onClick={onClose}>
      <div className="sym-drawer" onClick={e => e.stopPropagation()}>
        {/* Başlık */}
        <div className="sym-drawer-head">
          <div className="sym-drawer-title">
            <CompanyLogo symbol={symbol} size={40} />
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <span style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--fw-black)' }}>{symbol}</span>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', padding: '1px 7px',
                  borderRadius: 'var(--radius-full)', background: 'var(--bg-surface-2)' }}>{asset?.assetType ?? '—'}</span>
              </div>
              {company && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 2 }}>{company}</div>}
            </div>
          </div>
          <button onClick={onClose} className="ico-btn" style={{
            background: 'var(--bg-surface-2)', border: '1px solid var(--border-default)',
            color: 'var(--text-muted)', width: 30, height: 30, borderRadius: 'var(--radius-sm)',
            cursor: 'pointer', fontSize: 16, lineHeight: 1,
          }} title="Kapat (Esc)">×</button>
        </div>

        {/* Fiyat + değişim */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)' }}>
          <span className="sym-drawer-px">{fmt(asset?.close ?? null, dec)}</span>
          {changePct != null && (
            <span style={{ fontSize: 'var(--text-md)', fontWeight: 'var(--fw-bold)', color: chgColor, fontVariantNumeric: 'tabular-nums' }}>
              {changePct >= 0 ? '▲ +' : '▼ '}{fmt(change, dec)} ({changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%)
            </span>
          )}
        </div>

        {/* AI tavsiyesi (varsa) */}
        {oracle && (() => {
          const c = recColor(oracle.recommendation)
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginTop: 'var(--space-3)',
              padding: 'var(--space-2) var(--space-3)', background: c.bg, border: `1px solid ${c.border}`,
              borderRadius: 'var(--radius-sm)', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontWeight: 'var(--fw-bold)' }}>AI</span>
              <span style={{ fontWeight: 'var(--fw-bold)', color: c.color }}>{oracle.recommendation}</span>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>güven %{(oracle.confidence * 100).toFixed(0)}</span>
              {oracle.shortTermTarget != null && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>Hedef {fmt(oracle.shortTermTarget, dec)}</span>}
              {oracle.shortTermStop != null && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>Stop {fmt(oracle.shortTermStop, dec)}</span>}
              {oracle.riskRewardRatio != null && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>R:R {oracle.riskRewardRatio.toFixed(2)}</span>}
            </div>
          )
        })()}

        {/* Grafik */}
        <ChartPanel symbol={symbol} apiBase={apiBase} decimals={dec} availableSymbols={availableSymbols} />

        {/* Teknik özet */}
        <TechnicalSummary asset={asset} />

        {/* Teknik değerler */}
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', textTransform: 'uppercase',
          letterSpacing: '0.05em', fontWeight: 'var(--fw-bold)', marginTop: 'var(--space-5)', marginBottom: 'var(--space-2)' }}>
          Teknik Göstergeler
        </div>
        <div className="sym-vals">
          <Val k="Açılış" v={fmt(asset?.open ?? null, dec)} />
          <Val k="Gün Yüksek" v={fmt(asset?.high ?? null, dec)} />
          <Val k="Gün Düşük" v={fmt(asset?.low ?? null, dec)} />
          <Val k="Hacim" v={fmtVol(asset?.volume ?? null)} />
          <Val k="Sinyal" v={asset?.signal ?? '—'} color={sigColor} />
          <Val k="RSI (14)" v={asset?.rsi != null ? asset.rsi.toFixed(1) : '—'} color={rsiColor} />
          <Val k="MACD Hist" v={asset?.macdHistogram != null ? asset.macdHistogram.toFixed(3) : '—'}
            color={asset?.macdHistogram == null ? undefined : asset.macdHistogram >= 0 ? 'var(--profit)' : 'var(--loss)'} />
          <Val k="EMA 20" v={fmt(asset?.ema20 ?? null, dec)} />
          <Val k="EMA 50" v={fmt(asset?.ema50 ?? null, dec)} />
          <Val k="EMA 200" v={fmt(asset?.ema200 ?? null, dec)}
            color={asset?.close != null && asset?.ema200 != null ? (asset.close > asset.ema200 ? 'var(--profit)' : 'var(--loss)') : undefined} />
          <Val k="BB Üst" v={fmt(asset?.bbUpper ?? null, dec)} />
          <Val k="BB Alt" v={fmt(asset?.bbLower ?? null, dec)} />
        </div>
      </div>
    </div>
  )
}
