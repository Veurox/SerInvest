// =============================================================================
// SerInvest — Risk Filtresi ve Gölge Portföy Karşılaştırması
// docs/PLAN_2026-08.md Faz A.
//
// Bu panelin işi filtreyi SATMAK değil, durumunu dürüstçe göstermek:
// kural nedir, kapsam hedefte mi, taban karşısında nasıl gidiyor ve
// bunların hangisi kanıtlanmış. Sharpe farkı bugün 1 standart hatanın
// içinde — yani kanıtlanmamış. Karar tarihi 2027-02-12.
// =============================================================================
import { useEffect, useState } from 'react'
import { ADMIN, adminFetch } from '../../lib/api'
import { useConfig } from '../../lib/useConfig'

interface Book {
  equity?: number; initial_capital?: number; cash?: number
  open_positions?: unknown[]; closed_trades?: unknown[]
  n_trades?: number; benchmark_return?: number
}

const money = (v?: number) =>
  v == null ? '—' : v.toLocaleString('tr-TR', { maximumFractionDigits: 0 }) + '₺'

const pctOf = (b?: Book) => {
  if (!b?.equity || !b?.initial_capital) return null
  return (b.equity - b.initial_capital) / b.initial_capital
}

function Row({ label, main, shadow, note }: {
  label: string; main: React.ReactNode; shadow: React.ReactNode; note?: string
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) 1fr 1fr', gap: 10,
                  padding: '7px 0', borderBottom: '1px solid var(--border-subtle)',
                  alignItems: 'baseline' }}>
      <div>
        <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{label}</div>
        {note && <div style={{ fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1.45 }}>{note}</div>}
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, textAlign: 'right',
                    fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>{main}</div>
      <div style={{ fontSize: 13, fontWeight: 700, textAlign: 'right',
                    fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)' }}>{shadow}</div>
    </div>
  )
}

export function RiskFilterPanel() {
  const cfg = useConfig()
  const [main, setMain] = useState<Book | null>(null)
  const [shadow, setShadow] = useState<Book | null>(null)

  useEffect(() => {
    const load = () => {
      adminFetch(`${ADMIN}/paper-portfolio?book=main`).then(r => r.ok ? r.json() : null)
        .then(j => j && !j.error && setMain(j)).catch(() => {})
      adminFetch(`${ADMIN}/paper-portfolio?book=shadow`).then(r => r.ok ? r.json() : null)
        .then(j => j && !j.error && setShadow(j)).catch(() => {})
    }
    load()
    const t = setInterval(load, 120_000)
    return () => clearInterval(t)
  }, [])

  const rf = cfg.risk_filter
  const mainRet = pctOf(main ?? undefined)
  const shadRet = pctOf(shadow ?? undefined)
  const shadowTrades = shadow?.n_trades ?? 0

  const fmtRet = (v: number | null) => v == null ? '—'
    : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`

  return (
    <div className="card" style={{ padding: '14px 16px', marginBottom: 'var(--space-3)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em',
                       textTransform: 'uppercase', color: 'var(--text-muted)' }}>
          Risk filtresi
        </span>
        <span style={{ fontSize: 11.5, fontWeight: 700,
                       color: rf?.on ? 'var(--accent)' : 'var(--text-muted)' }}>
          {rf?.on ? 'devrede' : 'kapalı'}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 10.5, fontWeight: 700,
                       padding: '2px 7px', color: 'var(--warning)',
                       background: 'var(--warning-bg)', border: '1px solid var(--warning-border)' }}>
          KANITLANMAMIŞ — İZLENİYOR
        </span>
      </div>

      <p style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.65, margin: '0 0 10px' }}>
        Filtre <b>getiri tahmin etmez</b>. Model zaten hisse sıralayamıyor; bu kapı yalnızca
        ölçümle kötü çıkan grubu ayıklar: her gün <b>düşük oynaklık</b> ve
        <b> 52 haftalık zirveye yakınlık</b> sıralamasında en iyi
        %{((rf?.top_pct ?? 0.3) * 100).toFixed(0)} geçer.
        Kural {' '}<code>docs/PLAN_2026-08.md §A0</code>'da <b>önceden</b> yazıldı;
        sonucu görüp değiştirilmeyecek. Karar tarihi <b>{rf?.decision_date ?? '2027-02-12'}</b>.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) 1fr 1fr', gap: 10,
                    paddingBottom: 5, borderBottom: '1px solid var(--border-strong)' }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.07em',
                       textTransform: 'uppercase', color: 'var(--text-muted)' }}>Ölçüt</span>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.07em', textAlign: 'right',
                       textTransform: 'uppercase', color: 'var(--accent)' }}>Filtreli</span>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.07em', textAlign: 'right',
                       textTransform: 'uppercase', color: 'var(--text-muted)' }}>Gölge (taban)</span>
      </div>

      <Row label="Portföy değeri" note="Her ikisi de 100.000₺ ile başlar"
           main={money(main?.equity)} shadow={money(shadow?.equity)} />
      <Row label="Getiri" note="Başlangıç sermayesine göre"
           main={<span style={{ color: mainRet == null ? undefined : mainRet >= 0 ? 'var(--profit)' : 'var(--loss)' }}>
                   {fmtRet(mainRet)}</span>}
           shadow={<span style={{ color: shadRet == null ? undefined : shadRet >= 0 ? 'var(--profit)' : 'var(--loss)' }}>
                   {fmtRet(shadRet)}</span>} />
      <Row label="Açık pozisyon"
           main={main?.open_positions?.length ?? '—'} shadow={shadow?.open_positions?.length ?? '—'} />
      <Row label="Kapanan işlem" note="Sharpe için yeterli sayı aylar sürer"
           main={main?.n_trades ?? 0} shadow={shadowTrades} />

      <p style={{ fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1.6, marginTop: 10 }}>
        <b>Gölge defter</b> filtresiz ve eşit ağırlıklı çalışır — tek farkı risk filtresidir,
        böylece ölçülen şey filtrenin etkisi olur. Geçmiş bir Sharpe sayısıyla kıyaslamak
        rejim değiştiği için yanıltıcı olurdu.
        {shadowTrades < 20 && (
          <> <b style={{ color: 'var(--warning)' }}>Henüz {shadowTrades} kapanan işlem var;
          bu sayıyla hiçbir karşılaştırma anlamlı değil.</b></>
        )}
      </p>
    </div>
  )
}
