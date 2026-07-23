// =============================================================================
// SerInvest — AI Öne Çıkanlar (sağ rail)
// Bugünün Güçlü Al / Al tavsiyeleri — güven %, hedef, R:R. Tıkla → detay.
// Uygulamanın ana farkı: AI sinyalleri kalıcı ve göz önünde.
// =============================================================================
import { Link } from 'react-router-dom'
import { CompanyLogo } from '../common/CompanyLogo'
import { fmt, recColor } from '../../lib/format'
import type { OracleAnalysis } from '../../lib/types'

export function AiPicks({ oracle, onSelect }: {
  oracle: OracleAnalysis[]
  onSelect: (symbol: string) => void
}) {
  const picks = oracle
    .filter(o => o.recommendation.includes('ALIM'))
    .sort((a, b) => {
      // Güçlü Al önce, sonra güven
      const sa = a.recommendation.includes('GÜÇLÜ') ? 1 : 0
      const sb = b.recommendation.includes('GÜÇLÜ') ? 1 : 0
      return sb - sa || b.confidence - a.confidence
    })
    .slice(0, 8)

  return (
    <div className="rail-panel">
      <div className="rail-head">
        <span className="rail-title">AI Öne Çıkanlar</span>
        <Link to="/oracle" className="rail-link">tümü →</Link>
      </div>

      {picks.length === 0 ? (
        <div style={{ padding: 'var(--space-4)', fontSize: 'var(--text-xs)', color: 'var(--text-muted)', lineHeight: 1.5 }}>
          Şu an alım sinyali yok. Düşüş rejiminde bu normaldir — model nötr bekliyor.
        </div>
      ) : (
        <div>
          {picks.map(o => {
            const c = recColor(o.recommendation)
            const strong = o.recommendation.includes('GÜÇLÜ')
            return (
              <button key={o.id}
                onClick={() => onSelect(o.symbol)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                  padding: '8px var(--space-4)', background: 'transparent', border: 'none',
                  borderBottom: '0.5px solid var(--border-subtle)', cursor: 'pointer', textAlign: 'left',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-surface-2)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <CompanyLogo symbol={o.symbol} size={24} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--fw-black)', color: 'var(--text-primary)' }}>
                      {o.symbol}
                    </span>
                    {strong && <span style={{ fontSize: 8, fontWeight: 800, color: c.color,
                      background: c.bg, padding: '0 4px', borderRadius: 3 }}>GÜÇLÜ</span>}
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 1 }}>
                    {o.shortTermTarget != null ? `Hedef ${fmt(o.shortTermTarget, 2)}` : '—'}
                    {o.riskRewardRatio != null ? ` · R:R ${o.riskRewardRatio.toFixed(1)}` : ''}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--fw-bold)', color: c.color }}>
                    %{(o.confidence * 100).toFixed(0)}
                  </div>
                  <div style={{ fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.03em' }}>güven</div>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
