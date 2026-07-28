// =============================================================================
// SerInvest — Sonuçlanan Tahminler
// "Hangi tahmin ne oldu?" sorusunun düz cevabı. Jargon yok, tablo şişkinliği yok:
// giriş fiyatı → hedef/stop → 10 gün sonraki fiyat → getiri → sonuç.
// =============================================================================
import { useMemo, useState } from 'react'
import type { PredRow } from '../../lib/types'

type ResultRow = PredRow & {
  target?: number | null
  stop?: number | null
  exit_price?: number | null
  outcome?: string          // UP | DOWN | NEUTRAL
}

const OUTCOME: Record<string, { label: string; icon: string; cls: string }> = {
  UP:      { label: 'Hedefe ulaştı',  icon: '✓', cls: 'ok' },
  DOWN:    { label: 'Stopa takıldı',  icon: '✕', cls: 'bad' },
  NEUTRAL: { label: 'Süre doldu',     icon: '—', cls: 'mid' },
}

const TONE: Record<string, { fg: string; bg: string; bd: string }> = {
  ok:  { fg: 'var(--profit)',  bg: 'var(--profit-bg)',  bd: 'var(--profit-border)' },
  bad: { fg: 'var(--loss)',    bg: 'var(--loss-bg)',    bd: 'var(--loss-border)' },
  mid: { fg: 'var(--text-muted)', bg: 'var(--bg-surface-2)', bd: 'var(--border-default)' },
}

const num = (v: number | null | undefined, d = 2) =>
  v == null ? '—' : v.toLocaleString('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d })

type Filt = 'all' | 'UP' | 'DOWN' | 'NEUTRAL'

export function PredictionResults({ rows }: { rows: PredRow[] }) {
  const [filt, setFilt] = useState<Filt>('all')

  const done = useMemo(
    () => (rows as ResultRow[])
      .filter(r => r.evaluated && r.outcome)
      .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || '')),
    [rows])

  const stats = useMemo(() => {
    const up = done.filter(r => r.outcome === 'UP').length
    const dn = done.filter(r => r.outcome === 'DOWN').length
    const nt = done.filter(r => r.outcome === 'NEUTRAL').length
    const rets = done.map(r => parseFloat(r.return || '0')).filter(n => !isNaN(n))
    const avg = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : null
    const decided = up + dn
    return { up, dn, nt, avg, hit: decided ? up / decided : null, total: done.length }
  }, [done])

  const shown = filt === 'all' ? done : done.filter(r => r.outcome === filt)

  if (done.length === 0) {
    return (
      <div className="card" style={{ padding: 16, fontSize: 13, color: 'var(--text-muted)' }}>
        Henüz sonuçlanan tahmin yok. Her tahmin, kurulduktan 20 takvim günü sonra yargılanır —
        yukarıdaki olgunlaşma hattı hangi partinin ne zaman çıkacağını gösterir.
      </div>
    )
  }

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      {/* Başlık + tek cümlelik özet */}
      <div style={{ padding: '11px 14px', borderBottom: '1px solid var(--border-subtle)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 14 }}>Sonuçlanan Tahminler</strong>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            {stats.total} tahmin yargılandı · <b style={{ color: 'var(--profit)' }}>{stats.up} hedefe ulaştı</b> ·{' '}
            <b style={{ color: 'var(--loss)' }}>{stats.dn} stopa takıldı</b> ·{' '}
            {stats.nt} süre doldu
            {stats.avg != null && <> · ortalama <b>{(stats.avg * 100).toFixed(2)}%</b></>}
          </span>
        </div>
        <div style={{ marginTop: 7, display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {([
            ['all', `Tümü (${stats.total})`],
            ['UP', `Hedefe ulaşan (${stats.up})`],
            ['DOWN', `Stopa takılan (${stats.dn})`],
            ['NEUTRAL', `Süre dolan (${stats.nt})`],
          ] as [Filt, string][]).map(([k, lbl]) => (
            <button key={k} onClick={() => setFilt(k)}
              style={{
                fontSize: 11.5, padding: '3px 10px', borderRadius: 999, cursor: 'pointer',
                border: `1px solid ${filt === k ? 'var(--accent-border)' : 'var(--border-default)'}`,
                background: filt === k ? 'var(--accent-bg)' : 'transparent',
                color: filt === k ? 'var(--accent)' : 'var(--text-muted)',
                fontWeight: filt === k ? 700 : 500,
              }}>{lbl}</button>
          ))}
        </div>
      </div>

      {/* Tablo — sadece anlamlı kolonlar */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr>
              {['Sembol', 'Tahmin günü', 'Giriş', 'Hedef', 'Stop', '10 gün sonra', 'Getiri', 'Sonuç'].map((h, i) => (
                <th key={h} style={{
                  textAlign: i === 0 || i === 1 ? 'left' : i === 7 ? 'left' : 'right',
                  padding: '7px 12px', fontSize: 10, fontWeight: 700, letterSpacing: '.06em',
                  textTransform: 'uppercase', color: 'var(--text-muted)',
                  borderBottom: '1px solid var(--border-default)', background: 'var(--bg-surface-2)',
                  whiteSpace: 'nowrap',
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody style={{ fontVariantNumeric: 'tabular-nums' }}>
            {shown.map((r, i) => {
              const o = OUTCOME[r.outcome || ''] ?? OUTCOME.NEUTRAL
              const t = TONE[o.cls]
              const ret = parseFloat(r.return || '0')
              return (
                <tr key={`${r.symbol}-${r.timestamp}-${i}`}
                    style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '6px 12px', fontWeight: 700 }}>{r.symbol}</td>
                  <td style={{ padding: '6px 12px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{r.timestamp}</td>
                  <td style={{ padding: '6px 12px', textAlign: 'right' }}>{num(r.close)}</td>
                  <td style={{ padding: '6px 12px', textAlign: 'right', color: 'var(--profit)' }}>{num(r.target)}</td>
                  <td style={{ padding: '6px 12px', textAlign: 'right', color: 'var(--loss)' }}>{num(r.stop)}</td>
                  <td style={{ padding: '6px 12px', textAlign: 'right', fontWeight: 700 }}>{num(r.exit_price)}</td>
                  <td style={{ padding: '6px 12px', textAlign: 'right', fontWeight: 700,
                               color: ret >= 0 ? 'var(--profit)' : 'var(--loss)' }}>
                    {ret >= 0 ? '+' : ''}{(ret * 100).toFixed(2)}%
                  </td>
                  <td style={{ padding: '6px 12px', whiteSpace: 'nowrap' }}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      fontSize: 11.5, fontWeight: 600, padding: '2px 9px', borderRadius: 3,
                      color: t.fg, background: t.bg, border: `1px solid ${t.bd}`,
                    }}>{o.icon} {o.label}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Okuma kılavuzu — tabloyu "anlaşılır" yapan kısım */}
      <div style={{ padding: '8px 14px', borderTop: '1px solid var(--border-subtle)',
                    fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1.6 }}>
        <b>Nasıl okunur:</b> Model tahmin gününde hisseyi <b>giriş</b> fiyatından alsaydı,
        10 işlem günü içinde <b style={{ color: 'var(--profit)' }}>hedefe</b> önce değerse başarılı,{' '}
        <b style={{ color: 'var(--loss)' }}>stopa</b> önce değerse başarısız sayılır. Hiçbirine değmeden
        süre dolarsa kararsız (isabet oranına katılmaz). <b>10 gün sonra</b> = sürenin sonundaki fiyat.
      </div>
    </div>
  )
}
