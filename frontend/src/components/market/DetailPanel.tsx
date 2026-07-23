// =============================================================================
// SerInvest — İndikatör Detay Paneli
// Seçili varlığın teknik göstergeleri + çoklu zaman dilimli grafik.
// =============================================================================
import { fmt } from '../../lib/format'
import { API } from '../../lib/api'
import type { PriceData } from '../../lib/types'
import { ChartPanel } from '../finance'

export function DetailPanel({ data, availableSymbols = [] }: { data: PriceData; availableSymbols?: string[] }) {
  const strength = Math.round(data.signalStrength * 100)
  const ind = (label: string, value: number | null, dec = 2, colorFn?: (v: number) => string) => (
    <div className="ind-box">
      <div className="ind-label">{label}</div>
      <div className={`ind-value ${value != null && colorFn ? '' : 'ind-val-dim'}`}
           style={value != null && colorFn ? { color: colorFn(value) } : {}}>
        {fmt(value, dec)}
      </div>
    </div>
  )

  return (
    <div className="detail-panel">
      <div className="detail-header">
        <span className="detail-symbol">{data.symbol}</span>
        <span className="detail-price">{fmt(data.close, data.assetType === 'FOREX' ? 4 : 2)}</span>
        <span className={`signal-pill ${data.signal === 'BUY' ? 'signal-buy' : data.signal === 'SELL' ? 'signal-sell' : 'signal-neutral'}`}>
          {data.signal}
        </span>
      </div>
      <div className="indicators-row">
        {ind('RSI (14)', data.rsi, 1, v => v < 35 ? '#22c55e' : v > 65 ? '#ef4444' : '#94a3b8')}
        {ind('MACD', data.macdLine, 4, v => data.macdSignal != null ? (v > data.macdSignal ? '#22c55e' : '#ef4444') : '#94a3b8')}
        {ind('MACD Sinyal', data.macdSignal, 4)}
        {ind('BB Üst', data.bbUpper)} {ind('BB Orta', data.bbMiddle)} {ind('BB Alt', data.bbLower)}
        {ind('EMA 20', data.ema20, 2, v => data.close != null ? (data.close > v ? '#22c55e' : '#ef4444') : '#94a3b8')}
        {ind('EMA 50', data.ema50, 2, v => data.close != null ? (data.close > v ? '#22c55e' : '#ef4444') : '#94a3b8')}
        {ind('EMA 200', data.ema200, 2, v => data.close != null ? (data.close > v ? '#22c55e' : '#ef4444') : '#94a3b8')}
      </div>
      <div className="strength-bar-wrap" style={{ marginTop: '1.25rem' }}>
        <div className="strength-label"><span>Sinyal Kuvveti</span><span>{strength}%</span></div>
        <div className="strength-bar-bg"><div className="strength-bar-fill" style={{ width: `${strength}%` }} /></div>
        <div className="strength-label" style={{ marginTop: '.4rem' }}>
          <span style={{ color: 'var(--text-muted)', fontSize: '.7rem' }}>
            G/Y: {fmt(data.high)} / {fmt(data.low)} | Hacim: {data.volume != null ? (data.volume / 1_000_000).toFixed(1) + 'M' : '—'}
          </span>
          <span style={{ color: 'var(--text-muted)', fontSize: '.7rem' }}>
            {new Date(data.recordedAt).toLocaleString('tr-TR')}
          </span>
        </div>
      </div>

      {/* Çoklu zaman dilimli grafik (1H/1D/1W/1M/3M/1Y/5Y) + karşılaştırma */}
      <ChartPanel
        symbol={data.symbol}
        apiBase={API}
        decimals={data.assetType === 'FOREX' ? 4 : 2}
        availableSymbols={availableSymbols}
      />
    </div>
  )
}

export default DetailPanel
