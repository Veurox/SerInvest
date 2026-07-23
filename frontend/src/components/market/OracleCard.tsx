// =============================================================================
// SerInvest — Oracle Tavsiye Kartı
// AI Oracle analizini gösteren genişleyebilir kart (TP/SL, skorlar, faktörler).
// =============================================================================
import { useState } from 'react'
import { fmt, parseArr, recColor, biasIcon, biasColor } from '../../lib/format'
import type { OracleAnalysis } from '../../lib/types'
import { COMPANY_NAMES } from '../../lib/companies'
import { CompanyLogo } from '../common/CompanyLogo'
import { SignalPill, ConfidenceMeter } from '../finance'

export function OracleCard({ data }: { data: OracleAnalysis }) {
  const [expanded, setExpanded] = useState(false)
  const col     = recColor(data.recommendation)
  const drivers = parseArr(data.keyDrivers)
  const risks   = parseArr(data.risks)
  const watches = parseArr(data.watchPoints)

  const ScoreBar = ({ label, score }: { label: string; score: number }) => (
    <div style={{ marginBottom: '.35rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.7rem', color: 'var(--text-muted)', marginBottom: '.2rem' }}>
        <span>{label}</span><span>{Math.round(score * 100)}%</span>
      </div>
      <div style={{ height: '4px', background: 'var(--border)', borderRadius: '2px', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${score * 100}%`, background: col.color, borderRadius: '2px', transition: 'width .5s' }} />
      </div>
    </div>
  )

  return (
    <div className="oracle-card" style={{ border: `1px solid ${col.border}`, background: col.bg }}>
      {/* ── Üst Satır: Logo + Sembol + Sinyal Pill ── */}
      <div className="oracle-card-top" onClick={() => setExpanded(e => !e)} style={{ cursor: 'pointer' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <CompanyLogo symbol={data.symbol} size={32} />
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <span style={{ fontSize: 'var(--text-md)', fontWeight: 'var(--fw-black)' }}>{data.symbol}</span>
              {data.priceAtAnalysis != null && (
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)',
                  fontVariantNumeric: 'tabular-nums' }}>
                  {fmt(data.priceAtAnalysis)} ₺
                </span>
              )}
            </div>
            {COMPANY_NAMES[data.symbol] && (
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: '2px' }}>
                {COMPANY_NAMES[data.symbol]}
              </div>
            )}
          </div>
          <SignalPill signal={data.recommendation} size="md" />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
            {expanded ? '▲ Kapat' : '▼ Detay'}
          </span>
        </div>
      </div>

      {/* ── Confidence Meter (görsel bar) ── */}
      <div style={{ marginTop: 'var(--space-3)' }}>
        <ConfidenceMeter value={data.confidence} label="Model Güveni" size="sm" />
      </div>

      {/* ── Risk Yönetimi: TP / SL / Position Size — EXPAND ETMEDEN GÖRÜNÜR ── */}
      {(data.shortTermTarget != null || data.shortTermStop != null || data.positionSizePct != null) && (
        <div style={{
          marginTop: 'var(--space-3)',
          padding: 'var(--space-2) var(--space-3)',
          background: 'var(--bg-glass)',
          borderRadius: 'var(--radius-sm)',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(80px, 1fr))',
          gap: 'var(--space-2)',
          fontSize: 'var(--text-xs)',
        }}>
          {data.shortTermTarget != null && (
            <div>
              <div style={{ color: 'var(--text-muted)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>TP</div>
              <div style={{ color: 'var(--profit)', fontWeight: 'var(--fw-bold)', fontVariantNumeric: 'tabular-nums' }}>
                {fmt(data.shortTermTarget)}
              </div>
            </div>
          )}
          {data.shortTermStop != null && (
            <div>
              <div style={{ color: 'var(--text-muted)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>SL</div>
              <div style={{ color: 'var(--loss)', fontWeight: 'var(--fw-bold)', fontVariantNumeric: 'tabular-nums' }}>
                {fmt(data.shortTermStop)}
              </div>
            </div>
          )}
          {data.riskRewardRatio != null && (
            <div>
              <div style={{ color: 'var(--text-muted)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>R:R</div>
              <div style={{
                color: data.riskRewardRatio >= 1.5 ? 'var(--profit)' : 'var(--warning)',
                fontWeight: 'var(--fw-bold)', fontVariantNumeric: 'tabular-nums',
              }}>
                {data.riskRewardRatio.toFixed(2)}
              </div>
            </div>
          )}
          {data.positionSizePct != null && data.positionSizePct > 0 && (
            <div>
              <div style={{ color: 'var(--text-muted)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Boyut</div>
              <div style={{ color: 'var(--info)', fontWeight: 'var(--fw-bold)', fontVariantNumeric: 'tabular-nums' }}>
                %{(data.positionSizePct * 100).toFixed(1)}
              </div>
            </div>
          )}
        </div>
      )}

      {expanded && (
        <div style={{ marginTop: 'var(--space-3)', borderTop: '1px solid var(--border)', paddingTop: 'var(--space-3)' }}>
          {/* Long Term + Short Term Bias detayı */}
          <div style={{ display: 'flex', gap: 'var(--space-4)', marginBottom: 'var(--space-3)', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Kısa Vade</div>
              <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--fw-bold)', color: biasColor(data.shortTermBias) }}>
                {biasIcon(data.shortTermBias)} {data.shortTermBias}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Uzun Vade</div>
              <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--fw-bold)', color: biasColor(data.longTermBias) }}>
                {biasIcon(data.longTermBias)} {data.longTermBias}
                {data.longTermTarget != null && <span style={{ fontWeight: 'var(--fw-regular)', color: 'var(--text-secondary)', marginLeft: 'var(--space-1)' }}>
                  → {fmt(data.longTermTarget)} ₺
                </span>}
              </div>
            </div>
          </div>

          {data.reasoning && (
            <p style={{ fontSize: '.85rem', color: 'var(--text-dim)', lineHeight: 1.6, marginBottom: '1rem' }}>
              {data.reasoning}
            </p>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
            {drivers.length > 0 && (
              <div>
                <div style={{ fontSize: '.7rem', color: 'var(--green)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '.4rem' }}>
                  ✓ Olumlu Faktörler
                </div>
                {drivers.map((d, i) => <div key={i} style={{ fontSize: '.8rem', color: 'var(--text-dim)', marginBottom: '.2rem' }}>• {d}</div>)}
              </div>
            )}
            {risks.length > 0 && (
              <div>
                <div style={{ fontSize: '.7rem', color: 'var(--red)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '.4rem' }}>
                  ⚠ Riskler
                </div>
                {risks.map((r, i) => <div key={i} style={{ fontSize: '.8rem', color: 'var(--text-dim)', marginBottom: '.2rem' }}>• {r}</div>)}
              </div>
            )}
          </div>

          {watches.length > 0 && (
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ fontSize: '.7rem', color: 'var(--yellow)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '.4rem' }}>
                Takip Edilecekler
              </div>
              {watches.map((w, i) => <div key={i} style={{ fontSize: '.8rem', color: 'var(--text-dim)', marginBottom: '.2rem' }}>• {w}</div>)}
            </div>
          )}

          <div style={{ marginTop: '.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              fontSize: '.7rem', color: 'var(--text-muted)', textTransform: 'uppercase',
              letterSpacing: '.06em', marginBottom: '.5rem' }}>
              <span>Model Olasılığı · P(yukarı) 10g</span>
              <span className="tech-tag" style={{ textTransform: 'none', letterSpacing: 0 }}>● saf teknik</span>
            </div>
            <ScoreBar label="Teknik model — TP'ye SL'den önce değme" score={data.technicalScore} />
            <div style={{ fontSize: '.7rem', color: 'var(--text-muted)', marginTop: '.4rem', lineHeight: 1.5 }}>
              Haber / makro / temel füzyonu kullanılmıyor — karar yalnızca fiyat-teknik göstergelerden üretilir.
            </div>
          </div>

          <div style={{ fontSize: '.7rem', color: 'var(--text-muted)', marginTop: '.75rem', textAlign: 'right' }}>
            {new Date(data.analyzedAt).toLocaleString('tr-TR')}
          </div>
        </div>
      )}
    </div>
  )
}

export default OracleCard
