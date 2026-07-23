// =============================================================================
// SerInvest — Otonom Model Portföyü  (route: /model-portfoy)
// Modelin KENDİ sanal portföyü: 100.000 ₺ ile başlar, kullanıcının seçtiği
// hisselerde kendi kararlarıyla alım/satım yapar. Canlı paper-trading testi.
// =============================================================================
import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { ADMIN, adminFetch } from '../lib/api'
import { fmt } from '../lib/format'
import { COMPANY_NAMES } from '../lib/companies'
import { CompanyLogo } from '../components/common/CompanyLogo'
import { PageHeader, Icon } from '../components/ui'

// ── Tipler (admin/paper-portfolio yanıtı) ────────────────────────────────────
interface OpenPos {
  symbol: string; shares: number; entry_price: number; last_price: number
  target: number | null; stop: number | null; entry_date: string; hold_days: number
  market_value: number; unrealized_pnl: number; unrealized_pnl_pct: number
  entry_conf: number | null
}
interface ClosedTrade {
  entry_date: string; exit_date: string; symbol: string; shares: number
  entry_price: number; exit_price: number; net_pnl: number; pnl_pct: number
  exit_reason: string; hold_days: number
}
interface EquityPoint { t: string; equity: number; cash: number; invested: number; benchmark: number | null }
interface PaperState {
  initial_capital: number; cash: number; equity: number; invested: number
  total_return: number; total_net_pnl: number
  open_count: number; open_positions: OpenPos[]
  n_closed_trades: number; win_rate: number | null
  avg_win: number; avg_loss: number; profit_factor: number | null
  benchmark_return: number | null
  universe: string[]; equity_history: EquityPoint[]; closed_trades: ClosedTrade[]
  last_cycle: string | null; created_at: string | null
  max_open: number; time_barrier_days: number
  market_open: boolean; market_status: string
}
interface SymbolList { bist: { ticker: string }[]; commodity: { ticker: string }[]; forex: { ticker: string }[] }

const EXIT_LABEL: Record<string, { txt: string; color: string }> = {
  TP:     { txt: 'Hedef',  color: 'var(--profit)' },
  SL:     { txt: 'Stop',   color: 'var(--loss)' },
  TIME:   { txt: 'Süre',   color: 'var(--text-muted)' },
  SIGNAL: { txt: 'Sinyal', color: 'var(--warning)' },
}

const pnlColor = (n: number) => (n > 0 ? 'var(--profit)' : n < 0 ? 'var(--loss)' : 'var(--text-muted)')

// Backend zamanları UTC (Python utcnow, 'Z' yok) → JS'e 'Z' ekleyip yerel saate çevir.
const fmtDT = (s: string | null | undefined): string => {
  if (!s) return '—'
  const d = new Date(s.endsWith('Z') ? s : s + 'Z')
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function ModelPortfolioPage() {
  const [state, setState] = useState<PaperState | null>(null)
  const [symbols, setSymbols] = useState<string[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string>('')
  const [editing, setEditing] = useState(false)

  const fetchState = useCallback(async () => {
    try {
      const res = await adminFetch(`${ADMIN}/paper-portfolio`)
      if (res.ok) {
        const data: PaperState = await res.json()
        setState(data)
        if (!editing) setSelected(new Set(data.universe || []))
      }
    } catch {}
  }, [editing])

  const fetchSymbols = useCallback(async () => {
    try {
      const res = await adminFetch(`${ADMIN}/symbols`)
      if (res.ok) {
        const d: SymbolList = await res.json()
        const all = [...d.bist, ...d.commodity, ...d.forex].map(s => s.ticker)
        setSymbols(all)
      }
    } catch {}
  }, [])

  useEffect(() => {
    fetchState()
    fetchSymbols()
    const t = setInterval(fetchState, 15000)
    return () => clearInterval(t)
  }, [fetchState, fetchSymbols])

  const toggle = (sym: string) => {
    setEditing(true)
    setSelected(prev => {
      const next = new Set(prev)
      next.has(sym) ? next.delete(sym) : next.add(sym)
      return next
    })
  }

  const saveUniverse = async () => {
    setSaving(true); setMsg('')
    try {
      const res = await adminFetch(`${ADMIN}/paper-universe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols: [...selected] }),
      })
      const d = await res.json()
      if (res.ok) {
        setMsg(`${d.symbols?.length ?? 0} hisse kaydedildi — model bir sonraki döngüde işlem yapacak.`)
        setEditing(false)
        fetchState()
      } else setMsg(`${d.error || 'Kaydedilemedi'}`)
    } catch (e) {
      setMsg(`Bağlantı hatası: ${e}`)
    } finally { setSaving(false) }
  }

  const resetPortfolio = async () => {
    if (!confirm('Portföy 100.000 ₺ye sıfırlanacak, tüm pozisyon ve işlem geçmişi silinecek. Emin misiniz?')) return
    setSaving(true); setMsg('')
    try {
      const res = await adminFetch(`${ADMIN}/paper-reset`, { method: 'POST' })
      if (res.ok) { setMsg('Portföy sıfırlandı.'); fetchState() }
      else setMsg('Sıfırlanamadı (admin anahtarı?).')
    } catch (e) { setMsg(`${e}`) }
    finally { setSaving(false) }
  }

  if (!state) {
    return (
      <div style={{ padding: '2rem 0' }}>
        <div className="empty"><p>Model portföyü yükleniyor…</p>
          <p style={{ fontSize: '.8rem', marginTop: '.5rem' }}>
            Görünmüyorsa Yönetim sekmesinden admin anahtarını girdiğinizden emin olun.
          </p>
        </div>
      </div>
    )
  }

  const retPct  = state.total_return * 100
  const benchPct = state.benchmark_return != null ? state.benchmark_return * 100 : null
  const alpha = benchPct != null ? retPct - benchPct : null

  return (
    <div style={{ padding: '1rem 0' }}>
      <PageHeader
        icon={<Icon name="bot" size={20} />}
        title="Model Portföyü"
        subtitle="Otonom paper-trading — model kendi AL/NÖTR kararlarıyla işlem yapar (saf teknik · 10g · long-only)"
        right={
          <>
            <span title={state.market_open
              ? 'BIST açık — model yeni pozisyon açabilir'
              : `BIST kapalı (${state.market_status}) — yeni pozisyon açılmaz; sadece kaçırılan TP/SL bariyerleri taranır`}
              style={{
                padding: '.25rem .7rem', borderRadius: '999px', fontSize: 'var(--text-xs)', fontWeight: 700,
                background: state.market_open ? 'var(--profit-bg)' : 'var(--bg-surface-2)',
                color: state.market_open ? 'var(--profit)' : 'var(--text-muted)',
                border: `1px solid ${state.market_open ? 'var(--profit-border)' : 'var(--border-default)'}`,
              }}>
              <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', marginRight: 6, verticalAlign: 'middle', background: state.market_open ? 'var(--profit)' : 'var(--text-disabled)' }} />
              {state.market_open ? 'BIST Açık' : state.market_status}
            </span>
            <button onClick={resetPortfolio} disabled={saving} className="fpill"
              style={{ color: 'var(--loss)', borderColor: 'var(--loss-border)' }}>↺ Sıfırla</button>
          </>
        }
      />

      {/* Özet metrik kartları */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        gap: '.75rem', marginBottom: '1.25rem' }}>
        <Metric label="Portföy Değeri" value={`${fmt(state.equity)} ₺`}
          sub={`${retPct >= 0 ? '+' : ''}${retPct.toFixed(2)}%`} subColor={pnlColor(retPct)} big />
        <Metric label="Nakit" value={`${fmt(state.cash)} ₺`}
          sub={`Yatırımda: ${fmt(state.invested)} ₺`} />
        <Metric label="Net K/Z" value={`${state.total_net_pnl >= 0 ? '+' : ''}${fmt(state.total_net_pnl)} ₺`}
          valueColor={pnlColor(state.total_net_pnl)} />
        <Metric label="BIST-100 Karşılaştırma"
          value={benchPct != null ? `${benchPct >= 0 ? '+' : ''}${benchPct.toFixed(2)}%` : '—'}
          sub={alpha != null ? `Alfa: ${alpha >= 0 ? '+' : ''}${alpha.toFixed(2)}%` : undefined}
          subColor={alpha != null ? pnlColor(alpha) : undefined} />
        <Metric label="Kazanma Oranı"
          value={state.win_rate != null ? `%${(state.win_rate * 100).toFixed(0)}` : '—'}
          sub={`${state.n_closed_trades} kapanan işlem`} />
        <Metric label="Profit Factor"
          value={state.profit_factor != null ? state.profit_factor.toFixed(2) : '—'}
          sub={`Ort. K: ${fmt(state.avg_win)} / Z: ${fmt(state.avg_loss)} ₺`} />
      </div>

      {/* Equity eğrisi */}
      <EquityChart history={state.equity_history} initial={state.initial_capital} />

      {/* Açık pozisyonlar */}
      <Section title={`Açık Pozisyonlar (${state.open_count}/${state.max_open})`}>
        {state.open_positions.length === 0 ? (
          <Empty text="Şu an açık pozisyon yok. Model uygun ALIM sinyali bulduğunda otomatik pozisyon açacak." />
        ) : (
          <Table head={['Hisse', 'Alış Tarihi', 'Adet', 'Giriş', 'Güncel', 'Hedef/Stop', 'Değer', 'K/Z', 'Süre']}>
            {state.open_positions.map(p => (
              <tr key={p.symbol}>
                <td><SymCell sym={p.symbol} /></td>
                <td style={{ ...tdNum, textAlign: 'left', fontSize: '.74rem', color: 'var(--text-secondary)' }}>
                  {fmtDT(p.entry_date)}
                </td>
                <td style={tdNum}>{p.shares}</td>
                <td style={tdNum}>{fmt(p.entry_price)}</td>
                <td style={tdNum}>{fmt(p.last_price)}</td>
                <td style={{ ...tdNum, fontSize: '.7rem', color: 'var(--text-muted)' }}>
                  {p.target ? fmt(p.target) : '—'} / {p.stop ? fmt(p.stop) : '—'}
                </td>
                <td style={tdNum}>{fmt(p.market_value)} ₺</td>
                <td style={{ ...tdNum, color: pnlColor(p.unrealized_pnl), fontWeight: 700 }}>
                  {p.unrealized_pnl >= 0 ? '+' : ''}{fmt(p.unrealized_pnl)} ₺
                  <div style={{ fontSize: '.68rem' }}>
                    {p.unrealized_pnl_pct >= 0 ? '+' : ''}{(p.unrealized_pnl_pct * 100).toFixed(1)}%
                  </div>
                </td>
                <td style={{ ...tdNum, fontSize: '.72rem', color: 'var(--text-muted)' }}>{p.hold_days.toFixed(0)}g</td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      {/* Kapanan işlemler */}
      <Section title={`Kapanan İşlemler (${state.n_closed_trades})`}>
        {state.closed_trades.length === 0 ? (
          <Empty text="Henüz kapanan işlem yok." />
        ) : (
          <Table head={['Hisse', 'Alış Zamanı', 'Satış Zamanı', 'Fiyat (G→Ç)', 'Net K/Z', '%', 'Sebep', 'Süre']}>
            {state.closed_trades.map((t, i) => {
              const ex = EXIT_LABEL[t.exit_reason] || { txt: t.exit_reason, color: 'var(--text-muted)' }
              return (
                <tr key={i}>
                  <td><SymCell sym={t.symbol} /></td>
                  <td style={{ ...tdNum, textAlign: 'left', fontSize: '.72rem', color: 'var(--text-secondary)' }}>
                    {fmtDT(t.entry_date)}
                  </td>
                  <td style={{ ...tdNum, textAlign: 'left', fontSize: '.72rem', color: 'var(--text-secondary)' }}>
                    {fmtDT(t.exit_date)}
                  </td>
                  <td style={{ ...tdNum, fontSize: '.72rem' }}>{fmt(t.entry_price)} → {fmt(t.exit_price)}</td>
                  <td style={{ ...tdNum, color: pnlColor(t.net_pnl), fontWeight: 700 }}>
                    {t.net_pnl >= 0 ? '+' : ''}{fmt(t.net_pnl)} ₺
                  </td>
                  <td style={{ ...tdNum, color: pnlColor(t.pnl_pct) }}>
                    {t.pnl_pct >= 0 ? '+' : ''}{(t.pnl_pct * 100).toFixed(1)}%
                  </td>
                  <td><span style={{ color: ex.color, fontSize: '.72rem', fontWeight: 700 }}>{ex.txt}</span></td>
                  <td style={{ ...tdNum, fontSize: '.72rem', color: 'var(--text-muted)' }}>{t.hold_days.toFixed(0)}g</td>
                </tr>
              )
            })}
          </Table>
        )}
      </Section>

      {/* İşlem evreni seçici */}
      <Section title="İşlem Evreni — Modelin alım/satım yapacağı hisseler">
        <p style={{ fontSize: '.78rem', color: 'var(--text-muted)', margin: '0 0 .75rem' }}>
          Aşağıdan hisse seçin. Model yalnızca seçtiğiniz hisselerde, kendi pozisyon önerisine göre
          (güçlü ALIM + pozisyon büyüklüğü &gt; 0) otomatik işlem açar; hedef/stop/süre dolunca kapatır.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.4rem', marginBottom: '.9rem' }}>
          {symbols.map(sym => {
            const on = selected.has(sym)
            return (
              <button key={sym} onClick={() => toggle(sym)} title={COMPANY_NAMES[sym] || sym} style={{
                padding: '.3rem .65rem', borderRadius: '999px', fontSize: '.74rem', fontWeight: 700,
                cursor: 'pointer',
                background: on ? 'var(--accent)' : 'transparent',
                color: on ? 'var(--bg-app)' : 'var(--text-muted)',
                border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
              }}>{sym}</button>
            )
          })}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', flexWrap: 'wrap' }}>
          <button onClick={saveUniverse} disabled={saving || !editing} style={{
            padding: '.45rem 1.1rem', borderRadius: '8px', fontSize: '.8rem', fontWeight: 700,
            cursor: editing ? 'pointer' : 'default',
            background: editing ? 'var(--accent)' : 'var(--surface)',
            color: editing ? 'var(--bg-app)' : 'var(--text-muted)',
            border: '1px solid var(--accent)', opacity: saving ? 0.6 : 1,
          }}>{saving ? 'Kaydediliyor…' : `Kaydet (${selected.size} hisse)`}</button>
          {editing && (
            <button onClick={() => { setSelected(new Set(state.universe || [])); setEditing(false) }}
              style={{ padding: '.45rem .9rem', borderRadius: '8px', fontSize: '.8rem',
                cursor: 'pointer', background: 'transparent', color: 'var(--text-muted)',
                border: '1px solid var(--border)' }}>İptal</button>
          )}
          {msg && <span style={{ fontSize: '.78rem', color: 'var(--text-secondary)' }}>{msg}</span>}
        </div>
      </Section>
    </div>
  )
}

// ── Alt bileşenler ───────────────────────────────────────────────────────────
function Metric({ label, value, sub, subColor, valueColor, big }: {
  label: string; value: string; sub?: string; subColor?: string; valueColor?: string; big?: boolean
}) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: '10px', padding: '.8rem .9rem' }}>
      <div style={{ fontSize: '.68rem', color: 'var(--text-muted)', textTransform: 'uppercase',
        letterSpacing: '.05em', fontWeight: 700, marginBottom: '.3rem' }}>{label}</div>
      <div style={{ fontSize: big ? '1.35rem' : '1.05rem', fontWeight: 800,
        color: valueColor || 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {sub && <div style={{ fontSize: '.72rem', marginTop: '.15rem', fontWeight: 600,
        color: subColor || 'var(--text-muted)' }}>{sub}</div>}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <h3 style={{ fontSize: '.95rem', fontWeight: 700, margin: '0 0 .6rem' }}>{title}</h3>
      {children}
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <div style={{ padding: '1rem', background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: '10px', fontSize: '.82rem', color: 'var(--text-muted)' }}>{text}</div>
}

function SymCell({ sym }: { sym: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
      <CompanyLogo symbol={sym} size={22} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: '.82rem' }}>{sym}</div>
        {COMPANY_NAMES[sym] && (
          <div style={{ fontSize: '.66rem', color: 'var(--text-muted)', overflow: 'hidden',
            textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '120px' }}>{COMPANY_NAMES[sym]}</div>
        )}
      </div>
    </div>
  )
}

const tdNum: CSSProperties = { textAlign: 'right', fontVariantNumeric: 'tabular-nums', padding: '.5rem .6rem' }

function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div style={{ overflowX: 'auto', background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: '10px' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.82rem' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            {head.map((h, i) => (
              <th key={i} style={{ textAlign: i === 0 ? 'left' : 'right', padding: '.5rem .6rem',
                fontSize: '.68rem', color: 'var(--text-muted)', textTransform: 'uppercase',
                letterSpacing: '.04em', fontWeight: 700 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

// ── Equity eğrisi (basit SVG) ─────────────────────────────────────────────────
function EquityChart({ history, initial }: { history: EquityPoint[]; initial: number }) {
  if (!history || history.length < 2) {
    return (
      <Section title="Sermaye Eğrisi">
        <Empty text="Yeterli veri yok — model birkaç döngü çalıştıkça eğri oluşacak." />
      </Section>
    )
  }
  const W = 800, H = 200, pad = 8
  const eq = history.map(h => h.equity)
  // Benchmark'ı portföyle aynı başlangıç sermayesine ölçekle (relatif karşılaştırma)
  const b0 = history.find(h => h.benchmark != null)?.benchmark ?? null
  const bench = history.map(h => (b0 && h.benchmark != null ? (h.benchmark / b0) * initial : null))
  const allVals = [...eq, ...bench.filter((v): v is number => v != null), initial]
  const min = Math.min(...allVals), max = Math.max(...allVals)
  const range = max - min || 1
  const x = (i: number) => pad + (i / (history.length - 1)) * (W - 2 * pad)
  const y = (v: number) => H - pad - ((v - min) / range) * (H - 2 * pad)
  const path = (vals: (number | null)[]) =>
    vals.map((v, i) => (v == null ? '' : `${i === 0 || vals[i - 1] == null ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`)).join(' ')
  const y0 = y(initial)
  const last = eq[eq.length - 1]
  const up = last >= initial

  return (
    <Section title="Sermaye Eğrisi (Model vs BIST-100)">
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px', padding: '.6rem' }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none">
          {/* Başlangıç sermayesi referans çizgisi */}
          <line x1={pad} y1={y0} x2={W - pad} y2={y0} stroke="var(--border)" strokeWidth={1} strokeDasharray="4 4" />
          {/* Benchmark */}
          <path d={path(bench)} fill="none" stroke="var(--text-muted)" strokeWidth={1.5} opacity={0.6} />
          {/* Portföy */}
          <path d={path(eq)} fill="none" stroke={up ? 'var(--profit)' : 'var(--loss)'} strokeWidth={2} />
        </svg>
        <div style={{ display: 'flex', gap: '1.2rem', fontSize: '.72rem', color: 'var(--text-muted)',
          marginTop: '.4rem', flexWrap: 'wrap' }}>
          <span><span style={{ color: up ? 'var(--profit)' : 'var(--loss)' }}>━</span> Model portföyü</span>
          <span><span style={{ color: 'var(--text-muted)' }}>━</span> BIST-100 (ölçekli)</span>
          <span style={{ marginLeft: 'auto' }}>{history.length} fotoğraf • başlangıç {fmt(initial)} ₺</span>
        </div>
      </div>
    </Section>
  )
}
