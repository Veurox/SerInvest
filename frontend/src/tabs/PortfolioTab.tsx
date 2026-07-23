// =============================================================================
// SerInvest — Portföy Sekmesi (Faz 1 — 05/2026)
// Pozisyon takibi, nakit/temettü yönetimi, varlık dağılımı pasta grafiği.
// İçerir: PortfolioTab + 4 modal (Position/Close/Cash/Dividend) + AllocationPieChart
// =============================================================================
import { useEffect, useState } from 'react'
import { Button, KPI, EmptyState, useToast, PageHeader, Icon } from '../components/ui'
import { API } from '../lib/api'
import { downloadCsv } from '../lib/format'
import { PnLValue, PositionDrawer, DailyChangeBadge } from '../components/finance'
import { COMPANY_NAMES } from '../lib/companies'
import { CompanyLogo } from '../components/common/CompanyLogo'
import { Modal, Field, inputStyle, btnStyle } from '../components/common/Modal'

interface PortfolioPosition {
  id: string
  symbol: string
  buyPrice: number
  quantity: number
  buyDate: string
  buyCommission: number
  notes: string | null
  currentPrice: number
  dailyChangePct: number | null     // Günlük değişim (Open → Close)
  costBasis: number
  currentValue: number
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
}

interface PortfolioSummary {
  totalCost: number
  totalCurrent: number
  unrealizedPnl: number
  unrealizedPnlPct: number
  realizedPnl: number
  totalDividends: number
  allTimePnl: number               // Açık + Realize + Temettü
  allTimePnlPct: number
  historicalCostBasis: number      // Tüm zamanlar yatırılmış toplam maliyet
  openPositionCount: number
  closedPositionCount: number
  bestPosition: { symbol: string; pnl: number; pnlPct: number } | null
  worstPosition: { symbol: string; pnl: number; pnlPct: number } | null
  allocation: { symbol: string; value: number; weight: number }[]
  sectorAllocation: { sector: string; value: number; weight: number }[]
  warnings: { type: string; severity: string; message: string }[]
}

export function PortfolioTab() {
  const [positions, setPositions]   = useState<PortfolioPosition[]>([])
  const [summary,   setSummary]     = useState<PortfolioSummary | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [showDivForm,  setShowDivForm]  = useState(false)
  const [closeTarget,  setCloseTarget]  = useState<PortfolioPosition | null>(null)
  const [editTarget,   setEditTarget]   = useState<PortfolioPosition | null>(null)
  const [drawerPos,    setDrawerPos]    = useState<PortfolioPosition | null>(null)
  const [error, setError] = useState('')

  const fetchAll = async () => {
    try {
      const [pRes, sRes] = await Promise.all([
        fetch(`${API}/portfolio/positions`),
        fetch(`${API}/portfolio/summary`),
      ])
      if (pRes.ok) setPositions(await pRes.json())
      if (sRes.ok) setSummary(await sRes.json())
    } catch (e) { setError(String(e)) }
  }

  useEffect(() => { fetchAll(); const t = setInterval(fetchAll, 30_000); return () => clearInterval(t) }, [])

  const fmtTL = (n: number) => n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₺'
  const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${(n * 100).toFixed(2)}%`

  return (
    <div style={{ paddingTop: 'var(--space-2)' }}>
      <PageHeader
        icon={<Icon name="briefcase" size={20} />}
        title="Portföyüm"
        subtitle={`${positions.length} açık pozisyon · gerçek portföy takibi`}
        right={
          <>
            {positions.length > 0 && (
              <button className="fpill" title="CSV olarak indir"
                onClick={() => downloadCsv(
                  ['Sembol', 'Alış Fiyatı', 'Lot', 'Alış Tarihi', 'Maliyet', 'Güncel Değer', 'K/Z', 'K/Z%', 'AI Tavsiye'],
                  positions.map(p => [
                    p.symbol, p.buyPrice, p.quantity, p.buyDate,
                    p.costBasis.toFixed(2), p.currentValue.toFixed(2),
                    p.unrealizedPnl.toFixed(2),
                    `${p.unrealizedPnlPct >= 0 ? '+' : ''}${(p.unrealizedPnlPct * 100).toFixed(2)}%`,
                    p.oracleRec ?? '—',
                  ]),
                  `serinvest_portfoy_${new Date().toISOString().slice(0, 10)}.csv`
                )}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Icon name="download" size={12} /> CSV
              </button>
            )}
            <Button variant="primary" onClick={() => setShowAddForm(true)}><Icon name="plus" size={14} /> Pozisyon Ekle</Button>
            <Button variant="secondary" onClick={() => setShowDivForm(true)}><Icon name="gift" size={14} /> Temettü Ekle</Button>
          </>
        }
      />

      {error && (
        <div style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', color: 'var(--loss)',
          padding: '.75rem 1rem', borderRadius: '8px', marginBottom: '1rem' }}>{error}</div>
      )}

      {/* ── HERO KART: Tüm Zamanlar K/Z ── */}
      {summary && (
        <div style={{
          marginBottom: 'var(--space-5)',
          background: summary.allTimePnl >= 0
            ? 'linear-gradient(135deg, var(--profit-bg), transparent)'
            : 'linear-gradient(135deg, var(--loss-bg), transparent)',
          border: `1px solid ${summary.allTimePnl >= 0 ? 'var(--profit-border)' : 'var(--loss-border)'}`,
          borderRadius: 'var(--radius-lg)',
          padding: 'var(--space-5) var(--space-6)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexWrap: 'wrap', gap: 'var(--space-4)',
        }}>
          <div>
            <div style={{
              fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
              textTransform: 'uppercase', letterSpacing: '0.08em',
              fontWeight: 'var(--fw-bold)', marginBottom: 'var(--space-2)',
            }}>
              Tüm Zamanlar Net K/Z
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)' }}>
              <PnLValue value={summary.allTimePnl} size="xl" />
              <PnLValue value={summary.allTimePnlPct} format="pct" size="md" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-5)', flexWrap: 'wrap' }}>
            <div>
              <div style={{
                color: 'var(--text-muted)', fontSize: 'var(--text-xs)',
                textTransform: 'uppercase', letterSpacing: '0.05em',
                marginBottom: 'var(--space-1)',
              }}>Açık K/Z</div>
              <PnLValue value={summary.unrealizedPnl} size="md" />
            </div>
            <div>
              <div style={{
                color: 'var(--text-muted)', fontSize: 'var(--text-xs)',
                textTransform: 'uppercase', letterSpacing: '0.05em',
                marginBottom: 'var(--space-1)',
              }}>Realize K/Z</div>
              <PnLValue value={summary.realizedPnl} size="md" />
            </div>
            <div>
              <div style={{
                color: 'var(--text-muted)', fontSize: 'var(--text-xs)',
                textTransform: 'uppercase', letterSpacing: '0.05em',
                marginBottom: 'var(--space-1)',
              }}>Temettü</div>
              <span style={{
                fontSize: 'var(--text-base)', fontWeight: 'var(--fw-bold)',
                color: summary.totalDividends > 0 ? '#a78bfa' : 'var(--text-secondary)',
                fontVariantNumeric: 'tabular-nums',
              }}>
                +{summary.totalDividends.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── Özet Kartlar + Pie Chart (2 kolonlu) ── */}
      {summary && (
        <div className="portfolio-top-grid" style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 2fr) minmax(320px, 1fr)',
          gap: 'var(--space-4)', marginBottom: 'var(--space-5)',
        }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 'var(--space-3)',
          }}>
            <KPI
              label="Toplam Yatırım"
              value={fmtTL(summary.totalCost)}
              sub={`${summary.openPositionCount} açık pozisyon`}
              tone="neutral"
            />
            <KPI
              label="Güncel Değer"
              value={fmtTL(summary.totalCurrent)}
              sub="↻ canlı fiyat"
              tone="info"
            />
            <KPI
              label="Açık K/Z"
              value={<PnLValue value={summary.unrealizedPnl} size="md" />}
              sub={<PnLValue value={summary.unrealizedPnlPct} format="pct" size="sm" />}
              tone={summary.unrealizedPnl >= 0 ? 'profit' : 'loss'}
            />
            <KPI
              label="Realize K/Z"
              value={<PnLValue value={summary.realizedPnl} size="md" />}
              sub={`${summary.closedPositionCount} kapatılan` +
                (summary.totalDividends > 0 ? ` · Temettü ${fmtTL(summary.totalDividends)}` : '')}
              tone={summary.realizedPnl >= 0 ? 'profit' : 'loss'}
            />
          </div>

          {/* Sağda — sembol veya sektör seçilebilir pie */}
          <AllocationPieChart
            allocation={summary.allocation}
            title="Sembol Dağılımı"
            field="symbol"
          />
        </div>
      )}

      {/* Sektör dağılımı — sembol pie'ın altında full-width şerit */}
      {summary && summary.sectorAllocation && summary.sectorAllocation.length > 0 && (
        <div style={{ marginBottom: 'var(--space-5)' }}>
          <AllocationPieChart
            allocation={summary.sectorAllocation}
            title="Sektör Dağılımı"
            field="sector"
            emptyMessage="Sektör verisi yok"
          />
        </div>
      )}

      {/* Portföy değer eğrisi */}
      {positions.length > 0 && <PortfolioEquityChart positions={positions} />}

      {/* Risk Uyarıları */}
      {summary && summary.warnings.length > 0 && (
        <div style={{ marginBottom: '1.25rem' }}>
          {summary.warnings.map((w, i) => {
            const c = w.severity === 'HIGH' ? '#ef4444' : '#fbbf24'
            return (
              <div key={i} style={{ background: c + '11', border: `1px solid ${c}44`,
                borderRadius: '8px', padding: '.65rem 1rem', marginBottom: '.4rem',
                fontSize: '.85rem', color: c }}>
                <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', marginRight: 7, background: w.severity === 'HIGH' ? 'var(--loss)' : 'var(--warning)' }} />{w.message}
              </div>
            )
          })}
        </div>
      )}

      {/* En iyi / en kötü */}
      {summary && (summary.bestPosition || summary.worstPosition) && (
        <div style={{ display: 'flex', gap: '.75rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
          {summary.bestPosition && (
            <div style={{ flex: 1, minWidth: '200px', background: 'rgba(34,197,94,.08)', border: '1px solid rgba(34,197,94,.25)',
              borderRadius: '10px', padding: '.75rem 1rem' }}>
              <div style={{ fontSize: '.7rem', color: '#22c55e', textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700 }}>
                En İyi Pozisyon
              </div>
              <div style={{ fontSize: '1rem', fontWeight: 800, marginTop: '.2rem' }}>
                {summary.bestPosition.symbol}
                <span style={{ marginLeft: '.5rem', color: '#22c55e' }}>
                  {fmtPct(summary.bestPosition.pnlPct)} ({fmtTL(summary.bestPosition.pnl)})
                </span>
              </div>
            </div>
          )}
          {summary.worstPosition && (
            <div style={{ flex: 1, minWidth: '200px', background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)',
              borderRadius: '10px', padding: '.75rem 1rem' }}>
              <div style={{ fontSize: '.7rem', color: '#ef4444', textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700 }}>
                En Kötü Pozisyon
              </div>
              <div style={{ fontSize: '1rem', fontWeight: 800, marginTop: '.2rem' }}>
                {summary.worstPosition.symbol}
                <span style={{ marginLeft: '.5rem', color: '#ef4444' }}>
                  {fmtPct(summary.worstPosition.pnlPct)} ({fmtTL(summary.worstPosition.pnl)})
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Pozisyon Tablosu */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.78rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--tint-1)' }}>
                {['Sembol', 'Adet', 'Maliyet', 'Güncel', 'K/Z', 'K/Z %', 'Süre', 'Tavsiye', 'TP/SL', 'Aksiyon'].map(h => (
                  <th key={h} style={{ padding: '.65rem .8rem',
                    textAlign: ['Adet','Maliyet','Güncel','K/Z','K/Z %','Süre'].includes(h) ? 'right' : 'left',
                    color: 'var(--text-muted)', fontWeight: 700, fontSize: '.65rem',
                    textTransform: 'uppercase', letterSpacing: '.05em', whiteSpace: 'nowrap' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {positions.map(pos => {
                return (
                  <tr key={pos.id}
                    onClick={() => setDrawerPos(pos)}
                    style={{
                      borderBottom: '1px solid var(--border-subtle)',
                      cursor: 'pointer',
                      transition: 'background var(--transition-fast)',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-glass)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <td style={{ padding: 'var(--space-3)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                        <CompanyLogo symbol={pos.symbol} size={28} />
                        <div>
                          <div style={{ fontWeight: 'var(--fw-bold)', fontSize: 'var(--text-sm)' }}>{pos.symbol}</div>
                          {COMPANY_NAMES[pos.symbol] && (
                            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                              {COMPANY_NAMES[pos.symbol]}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '.6rem .8rem', textAlign: 'right' }}>{pos.quantity}</td>
                    <td style={{ padding: '.6rem .8rem', textAlign: 'right', color: 'var(--text-muted)' }}>
                      {fmtTL(pos.buyPrice)}
                      <div style={{ fontSize: '.65rem' }}>
                        ≡ {fmtTL(pos.costBasis)}
                      </div>
                    </td>
                    <td className="num-cell" style={{ padding: 'var(--space-3) var(--space-3)', textAlign: 'right' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
                        <span style={{ fontWeight: 'var(--fw-bold)' }}>{fmtTL(pos.currentPrice)}</span>
                        <DailyChangeBadge changePct={pos.dailyChangePct} size="sm" />
                      </div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: '2px' }}>
                        ≡ {fmtTL(pos.currentValue)}
                      </div>
                    </td>
                    <td className="num-cell" style={{ padding: 'var(--space-3) var(--space-3)', textAlign: 'right' }}>
                      <PnLValue value={pos.unrealizedPnl} size="sm" />
                    </td>
                    <td className="num-cell" style={{ padding: 'var(--space-3) var(--space-3)', textAlign: 'right' }}>
                      <PnLValue value={pos.unrealizedPnlPct} format="pct" size="sm" />
                    </td>
                    <td style={{ padding: '.6rem .8rem', textAlign: 'right', color: 'var(--text-muted)', fontSize: '.7rem' }}>
                      {pos.holdDays}g
                    </td>
                    <td style={{ padding: '.6rem .8rem' }}>
                      <div style={{ padding: '.25rem .55rem', borderRadius: '6px', fontSize: '.72rem', fontWeight: 700,
                        background: pos.adviceColor + '22', color: pos.adviceColor,
                        border: `1px solid ${pos.adviceColor}44`, display: 'inline-block', whiteSpace: 'nowrap' }}>
                        {pos.advice}
                      </div>
                      <div style={{ fontSize: '.62rem', color: 'var(--text-muted)', marginTop: '.2rem', maxWidth: '180px' }}>
                        {pos.adviceReason}
                      </div>
                    </td>
                    <td style={{ padding: '.6rem .8rem', fontSize: '.7rem', color: 'var(--text-muted)' }}>
                      {pos.targetPrice ? <div>Hedef {pos.targetPrice.toFixed(2)}</div> : null}
                      {pos.stopPrice   ? <div>Stop {pos.stopPrice.toFixed(2)}</div> : null}
                    </td>
                    <td style={{ padding: 'var(--space-2) var(--space-3)', whiteSpace: 'nowrap' }}
                      onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                        <Button variant="danger" size="sm" onClick={() => setCloseTarget(pos)}>Sat</Button>
                        <Button variant="ghost" size="sm" onClick={() => setEditTarget(pos)}>✎</Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {positions.length === 0 && (
            <EmptyState
              icon={<Icon name="briefcase" size={30} />}
              title="Henüz pozisyon yok"
              message="Sahip olduğun hisseleri ekle — sistem güncel fiyatları, kar/zarar durumunu ve AI tavsiyelerini sürekli takip eder."
              action={
                <Button variant="primary" onClick={() => setShowAddForm(true)}>
                  İlk Pozisyonunu Ekle
                </Button>
              }
            />
          )}
        </div>
      </div>

      {/* Pozisyon Ekleme Modalı */}
      {showAddForm && (
        <PositionFormModal
          onClose={() => setShowAddForm(false)}
          onSaved={() => { setShowAddForm(false); fetchAll() }}
        />
      )}
      {editTarget && (
        <PositionFormModal
          existing={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => { setEditTarget(null); fetchAll() }}
        />
      )}
      {closeTarget && (
        <ClosePositionModal
          position={closeTarget}
          onClose={() => setCloseTarget(null)}
          onSaved={() => { setCloseTarget(null); fetchAll() }}
        />
      )}
      {showDivForm && (
        <DividendFormModal
          onClose={() => setShowDivForm(false)}
          onSaved={() => { setShowDivForm(false); fetchAll() }}
        />
      )}
      {drawerPos && (
        <PositionDrawer
          position={drawerPos}
          onClose={() => setDrawerPos(null)}
          onSell={() => { setCloseTarget(drawerPos); setDrawerPos(null) }}
        />
      )}
    </div>
  )
}

// ── Pozisyon Form Modal (Ekle/Düzenle) ──────────────────────────────────────
function PositionFormModal({ existing, onClose, onSaved }: {
  existing?: PortfolioPosition
  onClose: () => void
  onSaved: () => void
}) {
  const toast = useToast()
  const [symbol, setSymbol]     = useState(existing?.symbol ?? '')
  const [buyPrice, setBuyPrice] = useState<string>(existing?.buyPrice.toString() ?? '')
  const [quantity, setQuantity] = useState<string>(existing?.quantity.toString() ?? '')
  const [buyDate, setBuyDate]   = useState(existing?.buyDate.slice(0, 10) ?? new Date().toISOString().slice(0, 10))
  const [commission, setCommission] = useState<string>(existing?.buyCommission.toString() ?? '0')
  const [notes, setNotes]       = useState(existing?.notes ?? '')
  const [busy, setBusy]         = useState(false)
  const [err, setErr]           = useState('')

  const allSymbols = Object.keys(COMPANY_NAMES).sort()

  const submit = async () => {
    setBusy(true); setErr('')
    try {
      const body = {
        symbol: symbol.toUpperCase(),
        buyPrice: parseFloat(buyPrice),
        quantity: parseFloat(quantity),
        buyDate: new Date(buyDate).toISOString(),
        buyCommission: parseFloat(commission || '0'),
        notes: notes || null,
      }
      const url = existing ? `${API}/portfolio/positions/${existing.id}` : `${API}/portfolio/positions`
      const method = existing ? 'PUT' : 'POST'
      const r = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        const msg = j.error ?? 'Kayıt başarısız'
        setErr(msg)
        toast.error(msg)
        return
      }
      toast.success(existing
        ? `${body.symbol} pozisyonu güncellendi`
        : `${body.symbol} pozisyonu eklendi (${body.quantity} lot @ ${body.buyPrice} ₺)`)
      onSaved()
    } catch (e) {
      setErr(String(e))
      toast.error('Bağlantı hatası — pozisyon kaydedilemedi')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal onClose={onClose} title={existing ? 'Pozisyon Düzenle' : 'Yeni Pozisyon Ekle'}>
      <div style={{ display: 'grid', gap: '.75rem' }}>
        <Field label="Sembol">
          <select value={symbol} onChange={e => setSymbol(e.target.value)} disabled={!!existing}
            style={inputStyle()}>
            <option value="">Seçin...</option>
            {allSymbols.map(s => <option key={s} value={s}>{s} — {COMPANY_NAMES[s]}</option>)}
          </select>
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem' }}>
          <Field label="Adet (Lot)">
            <input type="number" step="any" value={quantity} onChange={e => setQuantity(e.target.value)}
              style={inputStyle()} placeholder="100" />
          </Field>
          <Field label="Alım Fiyatı (₺)">
            <input type="number" step="any" value={buyPrice} onChange={e => setBuyPrice(e.target.value)}
              style={inputStyle()} placeholder="60.50" />
          </Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem' }}>
          <Field label="Alım Tarihi">
            <input type="date" value={buyDate} onChange={e => setBuyDate(e.target.value)}
              style={inputStyle()} />
          </Field>
          <Field label="Komisyon / Ücret (₺)">
            <input type="number" step="any" value={commission} onChange={e => setCommission(e.target.value)}
              style={inputStyle()} placeholder="0" />
          </Field>
        </div>
        <Field label="Not (opsiyonel)">
          <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
            style={inputStyle()} placeholder="Uzun vade tutma planı..." />
        </Field>

        {/* Maliyet özeti */}
        {buyPrice && quantity && (
          <div style={{ padding: '.6rem .8rem', background: 'rgba(251,191,36,.07)',
            border: '1px solid rgba(251,191,36,.25)', borderRadius: '8px', fontSize: '.8rem' }}>
            <strong>Toplam Maliyet:</strong>{' '}
            {((parseFloat(buyPrice) * parseFloat(quantity)) + parseFloat(commission || '0')).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺
          </div>
        )}

        {err && <div style={{ color: 'var(--loss)', fontSize: '.8rem' }}>{err}</div>}

        <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'flex-end', marginTop: '.5rem' }}>
          <button onClick={onClose} style={btnStyle('ghost')}>İptal</button>
          <button onClick={submit} disabled={busy || !symbol || !buyPrice || !quantity}
            style={btnStyle('primary')}>
            {busy ? 'Kaydediliyor...' : existing ? 'Güncelle' : 'Pozisyon Ekle'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── Pozisyon Kapatma (Sat) Modalı ──────────────────────────────────────────
function ClosePositionModal({ position, onClose, onSaved }: {
  position: PortfolioPosition
  onClose: () => void
  onSaved: () => void
}) {
  const toast = useToast()
  const [closePrice, setClosePrice]     = useState<string>(position.currentPrice.toFixed(2))
  const [quantity, setQuantity]         = useState<string>(position.quantity.toString())
  const [closeDate, setCloseDate]       = useState(new Date().toISOString().slice(0, 10))
  const [commission, setCommission]     = useState<string>('0')
  const [reason, setReason]             = useState('MANUAL')
  const [busy, setBusy]                 = useState(false)
  const [err, setErr]                   = useState('')

  const qtyNum = parseFloat(quantity || '0')
  const priceNum = parseFloat(closePrice || '0')
  const commNum = parseFloat(commission || '0')
  const partial = qtyNum > 0 && qtyNum < position.quantity
  const realizedPnl = (priceNum - position.buyPrice) * qtyNum - position.buyCommission * (qtyNum / position.quantity) - commNum

  const submit = async () => {
    setBusy(true); setErr('')
    try {
      const body: any = {
        closePrice: priceNum,
        closeDate: new Date(closeDate).toISOString(),
        closeCommission: commNum,
        closeReason: reason,
      }
      if (partial) body.quantity = qtyNum

      const r = await fetch(`${API}/portfolio/positions/${position.id}/close`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        const msg = j.error ?? 'Satış başarısız'
        setErr(msg)
        toast.error(msg)
        return
      }
      const pnlText = realizedPnl >= 0
        ? `+${realizedPnl.toLocaleString('tr-TR', { maximumFractionDigits: 2 })} ₺ kar`
        : `${realizedPnl.toLocaleString('tr-TR', { maximumFractionDigits: 2 })} ₺ zarar`
      toast.success(`${position.symbol} ${partial ? 'kısmi ' : ''}satıldı (${pnlText})`)
      onSaved()
    } catch (e) {
      setErr(String(e))
      toast.error('Bağlantı hatası — satış tamamlanamadı')
    }
    finally { setBusy(false) }
  }

  return (
    <Modal onClose={onClose} title={`${position.symbol} Sat`}>
      <div style={{ display: 'grid', gap: '.75rem' }}>
        <div style={{ padding: '.6rem .8rem', background: 'var(--surface-2, var(--tint-2))',
          borderRadius: '8px', fontSize: '.8rem' }}>
          Açık pozisyon: <strong>{position.quantity}</strong> lot @ {position.buyPrice.toFixed(2)} ₺<br/>
          Güncel değer: <strong>{position.currentValue.toFixed(2)} ₺</strong>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem' }}>
          <Field label={`Satış Adedi (max: ${position.quantity})`}>
            <input type="number" step="any" max={position.quantity} value={quantity}
              onChange={e => setQuantity(e.target.value)} style={inputStyle()} />
          </Field>
          <Field label="Satış Fiyatı (₺)">
            <input type="number" step="any" value={closePrice}
              onChange={e => setClosePrice(e.target.value)} style={inputStyle()} />
          </Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem' }}>
          <Field label="Satış Tarihi">
            <input type="date" value={closeDate} onChange={e => setCloseDate(e.target.value)} style={inputStyle()} />
          </Field>
          <Field label="Komisyon (₺)">
            <input type="number" step="any" value={commission} onChange={e => setCommission(e.target.value)} style={inputStyle()} />
          </Field>
        </div>
        <Field label="Satış Nedeni">
          <select value={reason} onChange={e => setReason(e.target.value)} style={inputStyle()}>
            <option value="MANUAL">Manuel</option>
            <option value="STOP_LOSS">Stop-Loss</option>
            <option value="TAKE_PROFIT">Take-Profit (Kar Al)</option>
            <option value="RECOMMENDATION">AI Tavsiye</option>
          </select>
        </Field>

        {/* K/Z özeti */}
        <div style={{ padding: '.7rem .9rem',
          background: realizedPnl >= 0 ? 'rgba(34,197,94,.08)' : 'rgba(239,68,68,.08)',
          border: `1px solid ${realizedPnl >= 0 ? 'rgba(34,197,94,.3)' : 'rgba(239,68,68,.3)'}`,
          borderRadius: '8px', fontSize: '.85rem' }}>
          <strong>Realize K/Z:</strong>{' '}
          <span style={{ color: realizedPnl >= 0 ? '#22c55e' : '#ef4444', fontWeight: 700 }}>
            {realizedPnl >= 0 ? '+' : ''}{realizedPnl.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺
          </span>
          {partial && <span style={{ marginLeft: '.5rem', color: 'var(--accent)', fontSize: '.75rem' }}>
            (Kısmi satış — {position.quantity - qtyNum} lot kalacak)
          </span>}
        </div>

        {err && <div style={{ color: 'var(--loss)', fontSize: '.8rem' }}>{err}</div>}

        <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={btnStyle('ghost')}>İptal</button>
          <button onClick={submit} disabled={busy} style={btnStyle('danger')}>
            {busy ? 'Satılıyor...' : (partial ? 'Kısmi Sat' : 'Pozisyonu Kapat')}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── Temettü Modalı ──────────────────────────────────────────────────────────
function DividendFormModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [symbol, setSymbol]       = useState('')
  const [perShare, setPerShare]   = useState('')
  const [total, setTotal]         = useState('')
  const [date, setDate]           = useState(new Date().toISOString().slice(0, 10))
  const [busy, setBusy]           = useState(false)
  const [err, setErr]             = useState('')

  const allSymbols = Object.keys(COMPANY_NAMES).sort()

  const submit = async () => {
    setBusy(true); setErr('')
    try {
      const r = await fetch(`${API}/portfolio/dividends`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: symbol.toUpperCase(),
          paymentDate: new Date(date).toISOString(),
          amountPerShare: parseFloat(perShare),
          totalAmount: parseFloat(total),
        }),
      })
      if (!r.ok) { setErr('Hata'); toast.error('Temettü kaydedilemedi'); return }
      toast.success(`${symbol.toUpperCase()} temettüsü eklendi (+${parseFloat(total).toLocaleString('tr-TR')} ₺)`)
      onSaved()
    } catch (e) { setErr(String(e)); toast.error('Bağlantı hatası') }
    finally { setBusy(false) }
  }

  return (
    <Modal onClose={onClose} title="Temettü Ekle">
      <div style={{ display: 'grid', gap: '.75rem' }}>
        <Field label="Sembol">
          <select value={symbol} onChange={e => setSymbol(e.target.value)} style={inputStyle()}>
            <option value="">Seçin...</option>
            {allSymbols.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem' }}>
          <Field label="Hisse Başı (₺)">
            <input type="number" step="any" value={perShare} onChange={e => setPerShare(e.target.value)} style={inputStyle()} />
          </Field>
          <Field label="Toplam Tutar (₺)">
            <input type="number" step="any" value={total} onChange={e => setTotal(e.target.value)} style={inputStyle()} />
          </Field>
        </div>
        <Field label="Ödeme Tarihi">
          <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inputStyle()} />
        </Field>
        {err && <div style={{ color: 'var(--loss)' }}>{err}</div>}
        <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={btnStyle('ghost')}>İptal</button>
          <button onClick={submit} disabled={busy || !symbol || !total} style={btnStyle('primary')}>
            {busy ? '...' : 'Kaydet'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── Portföy Değer Eğrisi ────────────────────────────────────────────────────
interface EqPoint { date: string; value: number }

function PortfolioEquityChart({ positions }: { positions: PortfolioPosition[] }) {
  const [equity, setEquity] = useState<EqPoint[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (positions.length === 0) { setEquity([]); return }
    setLoading(true)
    const DAYS = 90
    Promise.all(
      positions.map(p =>
        fetch(`${API}/market/price-history/${p.symbol}?days=${DAYS}`)
          .then(r => r.ok ? r.json() : null)
          .catch(() => null)
      )
    ).then(results => {
      const dayMap = new Map<string, number>()
      results.forEach((data, i) => {
        if (!data?.points?.length) return
        const pos = positions[i]
        const buyDate = pos.buyDate.slice(0, 10)
        data.points.forEach((pt: { date: string; close: number }) => {
          if (!pt.close) return
          const d = (pt.date as string).slice(0, 10)
          if (d < buyDate) return
          dayMap.set(d, (dayMap.get(d) ?? 0) + pos.quantity * pt.close)
        })
      })
      const sorted = [...dayMap.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .filter(([, v]) => v > 0)
      setEquity(sorted.map(([date, value]) => ({ date, value })))
    }).finally(() => setLoading(false))
  }, [positions])

  if (loading) return (
    <div style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-lg)', padding: 'var(--space-5)',
      marginBottom: 'var(--space-5)', color: 'var(--text-muted)',
      fontSize: 'var(--text-sm)', textAlign: 'center',
    }}>
      Değer eğrisi hesaplanıyor…
    </div>
  )

  if (equity.length < 3) return null

  const W = 800, H = 160, padL = 56, padR = 12, padT = 12, padB = 24
  const vals = equity.map(e => e.value)
  const lo = Math.min(...vals), hi = Math.max(...vals)
  const range = hi - lo || hi * 0.01
  const margin = range * 0.08
  const minV = lo - margin, maxV = hi + margin
  const n = equity.length
  const x = (i: number) => padL + (i / (n - 1)) * (W - padL - padR)
  const y = (v: number) => H - padB - ((v - minV) / (maxV - minV)) * (H - padT - padB)

  const isUp = vals[vals.length - 1] >= vals[0]
  const color = isUp ? 'var(--profit)' : 'var(--loss)'
  const fillColor = isUp ? 'var(--profit-bg)' : 'var(--loss-bg)'

  const linePath = equity.map((e, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(e.value).toFixed(1)}`).join(' ')
  const areaPath = `M${x(0).toFixed(1)},${H - padB} ${linePath.slice(1)} L${x(n - 1).toFixed(1)},${H - padB} Z`

  const ticks = [0, 0.25, 0.5, 0.75, 1].map(t => minV + (maxV - minV) * t)
  const fmtTick = (v: number) => v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : v.toFixed(0)

  const d0 = equity[0].date, dN = equity[n - 1].date
  const fmtDate = (s: string) => new Date(s).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' })
  const pctChg = ((vals[n - 1] - vals[0]) / vals[0]) * 100

  return (
    <div style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)',
      marginBottom: 'var(--space-5)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    marginBottom: 'var(--space-3)', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
        <div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
                        textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 800 }}>
            Portföy Değer Eğrisi (Son 90 Gün)
          </div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 2 }}>
            Açık pozisyonların günlük değeri · tarihsel fiyat × adet
          </div>
        </div>
        <div style={{ fontSize: 'var(--text-sm)', fontWeight: 800, color, fontVariantNumeric: 'tabular-nums' }}>
          {isUp ? '+' : ''}{pctChg.toFixed(2)}%
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontWeight: 400, marginLeft: 6 }}>
            {fmtDate(d0)} → {fmtDate(dN)}
          </span>
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} preserveAspectRatio="none">
        {ticks.map((tick, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={y(tick)} y2={y(tick)}
                  stroke="var(--border-subtle)" strokeWidth={1} />
            <text x={padL - 6} y={y(tick)} fontSize={10} dy={4}
                  textAnchor="end" fill="var(--text-muted)">
              {fmtTick(tick)}
            </text>
          </g>
        ))}
        <path d={areaPath} fill={fillColor} />
        <path d={linePath} fill="none" stroke={color} strokeWidth={2}
              strokeLinejoin="round" strokeLinecap="round" />
        {[0, Math.floor((n - 1) / 2), n - 1].map(i => (
          <text key={i} x={x(i)} y={H - 6} fontSize={10}
                textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
                fill="var(--text-muted)">
            {fmtDate(equity[i].date)}
          </text>
        ))}
      </svg>
    </div>
  )
}

// ── Pie Chart (Generic Allocation) ─────────────────────────────────────────
// Sembol ya da sektör allocation'ı kabul eder.
// Yüzdeler her dilimin kendi value / sum(values) üzerinden hesaplanır.
type AllocItem = { symbol?: string; sector?: string; value: number; weight: number }

function AllocationPieChart({
  allocation, title = 'Portföy Dağılımı', emptyMessage = 'Henüz pozisyon yok',
  field = 'symbol',
}: {
  allocation: AllocItem[]
  title?: string
  emptyMessage?: string
  field?: 'symbol' | 'sector'
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  // Sadece pozitif değerli kayıtlar
  const items = allocation.filter(a => a.value > 0)
  const sumValues = items.reduce((s, a) => s + a.value, 0)

  if (items.length === 0 || sumValues <= 0) {
    return (
      <div style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-md)', padding: 'var(--space-5)', textAlign: 'center',
        color: 'var(--text-muted)',
      }}>
        <div style={{
          fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: '0.06em',
          fontWeight: 'var(--fw-bold)', marginBottom: 'var(--space-2)',
        }}>{title}</div>
        <div style={{ fontSize: 'var(--text-sm)', padding: 'var(--space-5) 0' }}>{emptyMessage}</div>
      </div>
    )
  }

  // Renk paleti
  const colors = [
    '#22c55e', '#3b82f6', '#f59e0b', '#ec4899', '#8b5cf6',
    '#14b8a6', '#f97316', '#06b6d4', '#a855f7', '#84cc16',
    '#10b981', '#6366f1', '#f43f5e', '#eab308', '#0ea5e9',
  ]

  // Etiket — sembol veya sektör
  const getLabel = (a: AllocItem) => (field === 'sector' ? (a.sector ?? 'Diğer') : (a.symbol ?? '?'))

  // Sıralı dilimler (büyükten küçüğe)
  const sorted = [...items]
    .sort((a, b) => b.value - a.value)
    .map((a, i) => ({
      label: getLabel(a),
      value: a.value,
      pct: a.value / sumValues,
      color: colors[i % colors.length],
    }))

  // SVG geometri
  const size = 200, cx = 100, cy = 100, R = 80, r = 50

  // Polar -> Cartesian (12 o'clock = 0°, saat yönünde)
  const polar = (radius: number, deg: number) => {
    const rad = (deg - 90) * Math.PI / 180
    return [cx + radius * Math.cos(rad), cy + radius * Math.sin(rad)]
  }

  // Donut dilim path'i
  const arcPath = (startDeg: number, endDeg: number, expand: number) => {
    const Ro = R + expand, Ri = r - (expand > 0 ? 2 : 0)
    const [x1, y1] = polar(Ro, endDeg)
    const [x2, y2] = polar(Ro, startDeg)
    const [x3, y3] = polar(Ri, startDeg)
    const [x4, y4] = polar(Ri, endDeg)
    const largeArc = endDeg - startDeg > 180 ? 1 : 0
    return `M ${x1} ${y1}
            A ${Ro} ${Ro} 0 ${largeArc} 0 ${x2} ${y2}
            L ${x3} ${y3}
            A ${Ri} ${Ri} 0 ${largeArc} 1 ${x4} ${y4} Z`
  }

  // Tek dilim varsa (özel case — full circle path bug'ını önle)
  let pathSegments: { d: string; color: string; label: string; pct: number; value: number }[] = []
  if (sorted.length === 1) {
    const c = sorted[0]
    pathSegments = [
      { ...c, d: arcPath(0, 180, hoverIdx === 0 ? 6 : 0) },
      { ...c, d: arcPath(180, 360, hoverIdx === 0 ? 6 : 0) },
    ]
  } else {
    let acc = 0
    pathSegments = sorted.map((s, i) => {
      const startDeg = acc * 360
      const endDeg   = (acc + s.pct) * 360
      acc += s.pct
      return { ...s, d: arcPath(startDeg, endDeg, hoverIdx === i ? 6 : 0) }
    })
  }

  const centerLabel = field === 'sector' ? 'Sektör Toplam' : 'Hisse Toplam'
  const centerSub   = field === 'sector' ? `${sorted.length} sektör` : `${sorted.length} pozisyon`

  return (
    <div style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-md)', padding: 'var(--space-4) var(--space-5)',
    }}>
      <div style={{
        fontSize: 'var(--text-xs)', color: 'var(--text-muted)', textTransform: 'uppercase',
        letterSpacing: '0.06em', fontWeight: 'var(--fw-bold)', marginBottom: 'var(--space-3)',
      }}>{title}</div>

      <div style={{
        display: 'flex', gap: 'var(--space-4)', alignItems: 'center', flexWrap: 'wrap',
        justifyContent: 'center',
      }}>
        {/* Donut */}
        <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
          <svg width={size} height={size}>
            {pathSegments.map((p, i) => {
              const idx = sorted.findIndex(s => s.label === p.label)
              return (
                <path key={i} d={p.d} fill={p.color}
                  stroke="var(--bg-surface)" strokeWidth={2}
                  opacity={hoverIdx === null || hoverIdx === idx ? 1 : 0.35}
                  onMouseEnter={() => setHoverIdx(idx)}
                  onMouseLeave={() => setHoverIdx(null)}
                  style={{ cursor: 'pointer', transition: 'opacity .2s' }}
                />
              )
            })}
          </svg>
          {/* Merkez metni */}
          <div style={{ position: 'absolute', inset: 0, display: 'flex',
            flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none', textAlign: 'center' }}>
            {hoverIdx !== null && sorted[hoverIdx] ? (
              <>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontWeight: 'var(--fw-medium)' }}>
                  {sorted[hoverIdx].label}
                </div>
                <div style={{ fontSize: 'var(--text-md)', fontWeight: 'var(--fw-black)', color: sorted[hoverIdx].color }}>
                  %{(sorted[hoverIdx].pct * 100).toFixed(1)}
                </div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                  {sorted[hoverIdx].value.toLocaleString('tr-TR', { maximumFractionDigits: 0 })} ₺
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontWeight: 'var(--fw-medium)' }}>
                  {centerLabel}
                </div>
                <div style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--fw-black)', fontVariantNumeric: 'tabular-nums' }}>
                  {sumValues.toLocaleString('tr-TR', { maximumFractionDigits: 0 })} ₺
                </div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                  {centerSub}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Legend */}
        <div style={{ flex: '1 1 180px', minWidth: '170px', display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          {sorted.slice(0, 8).map((s, i) => (
            <div key={s.label}
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(null)}
              style={{
                display: 'grid', gridTemplateColumns: '12px 1fr auto auto',
                gap: '.5rem', alignItems: 'center',
                padding: '.3rem .5rem', borderRadius: '5px',
                background: hoverIdx === i ? 'var(--tint-3)' : 'transparent',
                cursor: 'pointer', transition: 'background .15s',
              }}>
              <span style={{ width: '12px', height: '12px', borderRadius: '3px', background: s.color }} />
              <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--fw-bold)' }}>{s.label}</span>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontWeight: 'var(--fw-medium)', fontVariantNumeric: 'tabular-nums' }}>
                %{(s.pct * 100).toFixed(1)}
              </span>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {s.value >= 1000
                  ? (s.value / 1000).toFixed(1) + 'K ₺'
                  : s.value.toFixed(0) + ' ₺'}
              </span>
            </div>
          ))}
          {sorted.length > 8 && (
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', padding: 'var(--space-1) var(--space-2)' }}>
              +{sorted.length - 8} {field === 'sector' ? 'sektör' : 'pozisyon'} daha
            </div>
          )}
        </div>
      </div>

    </div>
  )
}

