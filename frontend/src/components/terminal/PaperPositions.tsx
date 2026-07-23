// =============================================================================
// Terminal — Model Portföyü (Paper Trading) Pozisyon Masası
// Oracle admin /paper-portfolio: equity, açık pozisyonlar, kâr/zarar.
// =============================================================================
import { useEffect, useState } from 'react'
import { ADMIN, adminFetch } from '../../lib/api'

interface OpenPos {
  symbol: string; shares: number; entry_price: number; last_price: number
  target: number | null; stop: number | null; entry_date: string; hold_days: number
  market_value: number; unrealized_pnl: number; unrealized_pnl_pct: number
  entry_conf: number | null
}
interface PaperSummary {
  initial_capital: number; cash: number; equity: number; invested: number
  total_return: number; open_count: number; open_positions: OpenPos[]
  n_closed_trades: number; win_rate: number | null; profit_factor: number | null
  benchmark_return: number | null; market_status: string; market_open: boolean
}

const tl  = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 })
const px  = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pct = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'always' })

export function PaperPositions({ onSelect }: { onSelect: (s: string) => void }) {
  const [data, setData] = useState<PaperSummary | null>(null)

  useEffect(() => {
    let stop = false
    const load = () =>
      adminFetch(`${ADMIN}/paper-portfolio`)
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (!stop && d) setData(d) })
        .catch(() => {})
    load()
    const t = setInterval(load, 90_000)
    return () => { stop = true; clearInterval(t) }
  }, [])

  const ret = data ? data.total_return * 100 : null
  const alpha = data && data.benchmark_return != null
    ? (data.total_return - data.benchmark_return) * 100 : null

  return (
    <section className="t-panel t-area-positions" aria-label="Model portföyü pozisyonları">
      <div className="t-panel__head">
        <span className="t-panel__title">
          Model Portföyü · Paper
          <span style={{ marginLeft: 8, color: data?.market_open ? 'var(--profit)' : 'var(--text-disabled)', letterSpacing: 0, textTransform: 'none' }}>
            ● {data?.market_status ?? '…'}
          </span>
        </span>
        {data && (
          <span className="t-panel__meta t-num">
            ₺{tl.format(data.equity)}
            <span className={ret != null && ret >= 0 ? 't-up' : 't-down'} style={{ marginLeft: 8, fontWeight: 700 }}>
              {ret != null ? `${pct.format(ret)}%` : ''}
            </span>
            {alpha != null && (
              <span style={{ marginLeft: 8, color: 'var(--text-muted)' }}>
                α {pct.format(alpha)}p vs XU100
              </span>
            )}
          </span>
        )}
      </div>
      <div className="t-panel__body t-panel__body--flush" style={{ overflowX: 'auto' }}>
        <table className="t-table">
          <thead>
            <tr>
              <th>Sembol</th><th>Adet</th><th>Maliyet</th><th>Son</th>
              <th>Hedef</th><th>Stop</th><th>Değer</th><th>K/Z</th><th>K/Z %</th><th>Gün</th>
            </tr>
          </thead>
          <tbody className="t-num">
            {(data?.open_positions ?? []).map(p => {
              const up = p.unrealized_pnl >= 0
              return (
                <tr key={p.symbol} onClick={() => onSelect(p.symbol)} style={{ cursor: 'pointer' }}>
                  <td style={{ fontWeight: 700, fontFamily: 'inherit' }}>{p.symbol}</td>
                  <td>{tl.format(p.shares)}</td>
                  <td>{px.format(p.entry_price)}</td>
                  <td>{px.format(p.last_price)}</td>
                  <td className="t-up">{p.target != null ? px.format(p.target) : '—'}</td>
                  <td className="t-down">{p.stop != null ? px.format(p.stop) : '—'}</td>
                  <td>{tl.format(p.market_value)}</td>
                  <td className={up ? 't-up' : 't-down'} style={{ fontWeight: 700 }}>{pct.format(p.unrealized_pnl)}</td>
                  <td className={up ? 't-up' : 't-down'}>{pct.format(p.unrealized_pnl_pct * 100)}%</td>
                  <td style={{ color: 'var(--text-muted)' }}>{p.hold_days.toFixed(0)}</td>
                </tr>
              )
            })}
            {data && data.open_positions.length === 0 && (
              <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 16, fontFamily: 'inherit' }}>
                Açık pozisyon yok — model piyasa açılışında EV-sıralı adaylardan pozisyon açar.
              </td></tr>
            )}
            {!data && (
              <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 16, fontFamily: 'inherit' }}>
                Portföy yükleniyor…
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      {data && data.n_closed_trades > 0 && (
        <div style={{ padding: '5px 10px', borderTop: '1px solid var(--border-subtle)', fontSize: 10.5, color: 'var(--text-muted)', display: 'flex', gap: 16 }} className="t-num">
          <span>Kapanan: <b>{data.n_closed_trades}</b></span>
          {data.win_rate != null && <span>İsabet: <b>%{(data.win_rate * 100).toFixed(0)}</b></span>}
          {data.profit_factor != null && <span>Profit Factor: <b>{data.profit_factor}</b></span>}
          <span style={{ marginLeft: 'auto' }}>Nakit: ₺{tl.format(data.cash)}</span>
        </div>
      )}
    </section>
  )
}
