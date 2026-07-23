import { useEffect, useState } from 'react'
import { Sparkline } from './Sparkline'
import { PnLValue } from './PnLValue'
import { SignalPill } from './SignalPill'
import { Button } from '../ui/Button'

const API = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8080/api'

/**
 * Pozisyona tıklayınca sağdan açılan deep-dive panel.
 * - Pozisyon detayı (alış, güncel, K/Z, süre)
 * - 30 günlük fiyat grafiği
 * - Oracle son analizi (reasoning, drivers, risks)
 * - Hisse haberleri (son 5)
 */
export interface DrawerPosition {
  id: string
  symbol: string
  buyPrice: number
  quantity: number
  buyDate: string
  buyCommission: number
  currentPrice: number
  currentValue: number
  costBasis: number
  unrealizedPnl: number
  unrealizedPnlPct: number
  holdDays: number
  oracleRec: string | null
  oracleConf: number | null
  targetPrice: number | null
  stopPrice: number | null
  riskReward: number | null
  advice: string
  adviceReason: string
  adviceColor: string
  notes: string | null
}

interface PositionDrawerProps {
  position: DrawerPosition
  onClose: () => void
  onSell: () => void
}

interface NewsItem {
  headline: string
  summary?: string
  url: string
  createdAt: string
  sentimentScore: number
  sentimentLabel?: string
}

interface OracleDetail {
  reasoning?: string
  keyDrivers?: string
  risks?: string
  watchPoints?: string
  technicalScore?: number
  newsScore?: number
  macroScore?: number
  fundamentalScore?: number
  analyzedAt?: string
}

const fmtTL = (n: number) =>
  n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₺'

const parseArr = (json: string | undefined | null): string[] => {
  if (!json) return []
  try { const v = JSON.parse(json); return Array.isArray(v) ? v : [] } catch { return [] }
}

export function PositionDrawer({ position, onClose, onSell }: PositionDrawerProps) {
  const [news, setNews]     = useState<NewsItem[]>([])
  const [oracle, setOracle] = useState<OracleDetail | null>(null)

  useEffect(() => {
    const sym = position.symbol
    fetch(`${API}/oracle/symbol/${sym}`).then(r => r.ok ? r.json() : null).then(d => d && setOracle(d)).catch(() => {})
    fetch(`${API}/signals/by-entity/${sym}?limit=5`).then(r => r.ok ? r.json() : []).then(d => setNews(d || [])).catch(() => {})
    // ESC ile kapat
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [position.symbol, onClose])

  const drivers = parseArr(oracle?.keyDrivers)
  const risks   = parseArr(oracle?.risks)
  const buyDate = new Date(position.buyDate).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' })

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'var(--bg-overlay)',
      backdropFilter: 'blur(4px)', zIndex: 1000,
      display: 'flex', justifyContent: 'flex-end',
    }}>
      <aside onClick={e => e.stopPropagation()} style={{
        background: 'var(--bg-surface)',
        width: '100%', maxWidth: '540px', height: '100vh', overflowY: 'auto',
        borderLeft: '1px solid var(--border-strong)',
        boxShadow: 'var(--shadow-xl)',
        animation: 'drawer-slide 240ms ease-out',
      }}>
        {/* Başlık */}
        <div style={{
          position: 'sticky', top: 0, zIndex: 2,
          background: 'var(--bg-surface)',
          borderBottom: '1px solid var(--border-default)',
          padding: 'var(--space-4) var(--space-5)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <h2 style={{ margin: 0, fontSize: 'var(--text-lg)', fontWeight: 'var(--fw-black)' }}>
                {position.symbol}
              </h2>
              {position.oracleRec && <SignalPill signal={position.oracleRec} size="sm" />}
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: '2px' }}>
              Pozisyon detayı · {buyDate}'den beri ({position.holdDays}g)
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'var(--bg-surface-2)', border: '1px solid var(--border-strong)',
            color: 'var(--text-muted)', fontSize: 'var(--text-md)', cursor: 'pointer',
            borderRadius: 'var(--radius-sm)',
            width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>×</button>
        </div>

        <div style={{ padding: 'var(--space-5)' }}>
          {/* K/Z Hero */}
          <div style={{
            background: position.unrealizedPnl >= 0
              ? 'linear-gradient(135deg, var(--profit-bg), transparent)'
              : 'linear-gradient(135deg, var(--loss-bg), transparent)',
            border: `1px solid ${position.unrealizedPnl >= 0 ? 'var(--profit-border)' : 'var(--loss-border)'}`,
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-4)',
            marginBottom: 'var(--space-4)',
          }}>
            <div style={{
              fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
              textTransform: 'uppercase', letterSpacing: '0.06em',
              fontWeight: 'var(--fw-bold)', marginBottom: 'var(--space-1)',
            }}>Açık K/Z</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)' }}>
              <PnLValue value={position.unrealizedPnl} size="xl" />
              <PnLValue value={position.unrealizedPnlPct} format="pct" size="md" />
            </div>
          </div>

          {/* Detay grid */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 'var(--space-3)',
            marginBottom: 'var(--space-4)',
          }}>
            <DetailRow label="Adet" value={position.quantity.toString()} />
            <DetailRow label="Tutma Süresi" value={`${position.holdDays} gün`} />
            <DetailRow label="Alış Fiyatı" value={fmtTL(position.buyPrice)} />
            <DetailRow label="Güncel Fiyat" value={fmtTL(position.currentPrice)} accent="info" />
            <DetailRow label="Toplam Maliyet" value={fmtTL(position.costBasis)} />
            <DetailRow label="Güncel Değer" value={fmtTL(position.currentValue)} accent="info" />
            {position.buyCommission > 0 && (
              <DetailRow label="Komisyon" value={fmtTL(position.buyCommission)} />
            )}
          </div>

          {/* 30 günlük grafik */}
          <Section title="Son 30 Gün">
            <div style={{
              padding: 'var(--space-3)',
              background: 'var(--bg-surface-2)',
              borderRadius: 'var(--radius-sm)',
            }}>
              <Sparkline symbol={position.symbol} days={30} width={480} height={100} showAxis />
            </div>
          </Section>

          {/* AI Tavsiye */}
          {position.advice && (
            <Section title="AI Tavsiye">
              <div style={{
                padding: 'var(--space-3) var(--space-4)',
                background: position.adviceColor + '15',
                border: `1px solid ${position.adviceColor}40`,
                borderRadius: 'var(--radius-sm)',
              }}>
                <div style={{
                  fontSize: 'var(--text-md)', fontWeight: 'var(--fw-black)',
                  color: position.adviceColor, marginBottom: 'var(--space-1)',
                }}>{position.advice}</div>
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                  {position.adviceReason}
                </div>

                {/* Risk yönetimi */}
                {(position.targetPrice || position.stopPrice) && (
                  <div style={{
                    marginTop: 'var(--space-3)', paddingTop: 'var(--space-3)',
                    borderTop: '1px solid var(--border-default)',
                    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(80px, 1fr))',
                    gap: 'var(--space-3)', fontSize: 'var(--text-xs)',
                  }}>
                    {position.targetPrice != null && (
                      <div>
                        <div style={{ color: 'var(--text-muted)' }}>TP</div>
                        <div style={{ color: 'var(--profit)', fontWeight: 'var(--fw-bold)', fontVariantNumeric: 'tabular-nums' }}>
                          {position.targetPrice.toFixed(2)}
                        </div>
                      </div>
                    )}
                    {position.stopPrice != null && (
                      <div>
                        <div style={{ color: 'var(--text-muted)' }}>SL</div>
                        <div style={{ color: 'var(--loss)', fontWeight: 'var(--fw-bold)', fontVariantNumeric: 'tabular-nums' }}>
                          {position.stopPrice.toFixed(2)}
                        </div>
                      </div>
                    )}
                    {position.riskReward != null && (
                      <div>
                        <div style={{ color: 'var(--text-muted)' }}>R:R</div>
                        <div style={{ fontWeight: 'var(--fw-bold)', fontVariantNumeric: 'tabular-nums' }}>
                          {position.riskReward.toFixed(2)}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </Section>
          )}

          {/* Oracle Reasoning */}
          {oracle?.reasoning && (
            <Section title="Model Analizi">
              <p style={{
                fontSize: 'var(--text-sm)', color: 'var(--text-secondary)',
                lineHeight: 'var(--lh-base)', margin: 0,
              }}>{oracle.reasoning}</p>

              {(drivers.length > 0 || risks.length > 0) && (
                <div style={{
                  display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)',
                  marginTop: 'var(--space-3)',
                }}>
                  {drivers.length > 0 && (
                    <div>
                      <div style={{
                        fontSize: 'var(--text-xs)', color: 'var(--profit)',
                        fontWeight: 'var(--fw-bold)', textTransform: 'uppercase',
                        letterSpacing: '0.05em', marginBottom: 'var(--space-1)',
                      }}>✓ Olumlu</div>
                      {drivers.slice(0, 3).map((d, i) => (
                        <div key={i} style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginBottom: '2px' }}>
                          • {d}
                        </div>
                      ))}
                    </div>
                  )}
                  {risks.length > 0 && (
                    <div>
                      <div style={{
                        fontSize: 'var(--text-xs)', color: 'var(--loss)',
                        fontWeight: 'var(--fw-bold)', textTransform: 'uppercase',
                        letterSpacing: '0.05em', marginBottom: 'var(--space-1)',
                      }}>⚠ Risk</div>
                      {risks.slice(0, 3).map((r, i) => (
                        <div key={i} style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginBottom: '2px' }}>
                          • {r}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </Section>
          )}

          {/* Haberler */}
          {news.length > 0 && (
            <Section title="Hisse Haberleri">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {news.slice(0, 5).map((n, i) => {
                  const sentColor = n.sentimentScore > 0.1 ? 'var(--profit)'
                    : n.sentimentScore < -0.1 ? 'var(--loss)' : 'var(--text-muted)'
                  return (
                    <a key={i} href={n.url} target="_blank" rel="noreferrer" style={{
                      padding: 'var(--space-2) var(--space-3)',
                      background: 'var(--bg-surface-2)',
                      borderRadius: 'var(--radius-sm)',
                      borderLeft: `3px solid ${sentColor}`,
                      display: 'block',
                      textDecoration: 'none',
                      color: 'inherit',
                      transition: 'background var(--transition-fast)',
                    }}>
                      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--fw-bold)', color: 'var(--text-primary)', marginBottom: '2px' }}>
                        {n.headline}
                      </div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                        {new Date(n.createdAt).toLocaleString('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        {n.sentimentLabel && <> · <span style={{ color: sentColor, fontWeight: 'var(--fw-bold)' }}>{n.sentimentLabel}</span></>}
                      </div>
                    </a>
                  )
                })}
              </div>
            </Section>
          )}

          {/* Notlar */}
          {position.notes && (
            <Section title="Notlar">
              <p style={{
                fontSize: 'var(--text-sm)', color: 'var(--text-secondary)',
                lineHeight: 'var(--lh-base)', margin: 0,
                padding: 'var(--space-2) var(--space-3)',
                background: 'var(--bg-surface-2)',
                borderRadius: 'var(--radius-sm)',
              }}>{position.notes}</p>
            </Section>
          )}

          {/* Aksiyon */}
          <div style={{ marginTop: 'var(--space-5)', display: 'flex', gap: 'var(--space-2)' }}>
            <Button variant="danger" size="lg" onClick={onSell} style={{ flex: 1 }}>
              Pozisyonu Sat
            </Button>
            <Button variant="ghost" size="lg" onClick={onClose}>Kapat</Button>
          </div>
        </div>
      </aside>
    </div>
  )
}

function DetailRow({ label, value, accent }: { label: string; value: string; accent?: 'profit' | 'loss' | 'info' }) {
  const color = accent === 'profit' ? 'var(--profit)'
    : accent === 'loss' ? 'var(--loss)'
    : accent === 'info' ? 'var(--info)' : 'var(--text-primary)'
  return (
    <div>
      <div style={{
        fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
        textTransform: 'uppercase', letterSpacing: '0.05em',
        fontWeight: 'var(--fw-medium)', marginBottom: '2px',
      }}>{label}</div>
      <div style={{
        fontSize: 'var(--text-sm)', fontWeight: 'var(--fw-bold)', color,
        fontVariantNumeric: 'tabular-nums',
      }}>{value}</div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 'var(--space-4)' }}>
      <div style={{
        fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
        textTransform: 'uppercase', letterSpacing: '0.06em',
        fontWeight: 'var(--fw-bold)', marginBottom: 'var(--space-2)',
      }}>{title}</div>
      {children}
    </div>
  )
}
