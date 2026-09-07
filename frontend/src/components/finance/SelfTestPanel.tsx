// =============================================================================
// SerInvest — Öz Denetim Paneli
// docs/SAGLAMLIK_PLANI.md Katman 1'in görünen yüzü.
//
// Amaç: sistemdeki sessiz başarısızlıkları KULLANICI fark etmeden önce
// göstermek. 08/2026 denetiminde 23 kusurun 9'u sessizdi — terfi terazisi
// bozuk olduğu için model bir ay donuk kaldı ve hiçbir uyarı çıkmadı.
// =============================================================================
import { useEffect, useState } from 'react'
import { ADMIN, adminFetch } from '../../lib/api'

export interface Check {
  id: string; title: string
  status: 'PASS' | 'WARN' | 'FAIL' | 'SKIP'
  detail: string
  /** "Ne yapmalı" cümlesi — arka uçtan gelir, PASS'te boştur.
   *  Metni burada ÜRETMİYORUZ: kontrolün neden var olduğunu bilen dosya
   *  (selftest.py) ne yapılacağını da bilir; arayüz yalnızca gösterir. */
  action?: string
}
export interface SelfTest {
  computed_at: string
  overall: 'PASS' | 'WARN' | 'FAIL'
  counts: Partial<Record<Check['status'], number>>
  checks: Check[]
  error?: string
}

const S: Record<Check['status'], { icon: string; fg: string; bg: string; bd: string; label: string }> = {
  PASS: { icon: '✓', fg: 'var(--profit)',      bg: 'var(--profit-bg)',   bd: 'var(--profit-border)',  label: 'geçti' },
  WARN: { icon: '!', fg: 'var(--warning)',     bg: 'var(--warning-bg)',  bd: 'var(--warning-border)', label: 'uyarı' },
  FAIL: { icon: '✕', fg: 'var(--loss)',        bg: 'var(--loss-bg)',     bd: 'var(--loss-border)',    label: 'İHLAL' },
  SKIP: { icon: '–', fg: 'var(--text-muted)',  bg: 'var(--bg-surface-2)', bd: 'var(--border-subtle)', label: 'veri yok' },
}

export function SelfTestPanel() {
  const [d, setD]     = useState<SelfTest | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = (rerun = false) => {
    if (rerun) setBusy(true)
    adminFetch(`${ADMIN}/selftest${rerun ? '?run=1' : ''}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((j: SelfTest) => j.error ? setErr(j.error) : (setD(j), setErr(null)))
      .catch(e => setErr(String(e)))
      .finally(() => setBusy(false))
  }

  useEffect(() => { load(); const t = setInterval(() => load(), 300_000); return () => clearInterval(t) }, [])

  if (err) return <div className="card" style={{ padding: 14, fontSize: 13, color: 'var(--text-muted)' }}>Öz denetim alınamadı: {err}</div>
  if (!d)  return <div className="card" style={{ padding: 14, fontSize: 13, color: 'var(--text-muted)' }}>Öz denetim yükleniyor…</div>

  const o = S[d.overall]
  const fails = d.counts.FAIL ?? 0
  const warns = d.counts.WARN ?? 0

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden',
                                   borderColor: fails ? 'var(--loss-border)' : undefined }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                    padding: '11px 14px', borderBottom: '1px solid var(--border-subtle)',
                    background: fails ? 'var(--loss-bg)' : warns ? 'var(--warning-bg)' : 'var(--bg-surface-2)' }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em',
                       textTransform: 'uppercase', color: 'var(--text-muted)' }}>
          Öz Denetim
        </span>
        <span style={{ fontSize: 13, fontWeight: 700, color: o.fg }}>
          {o.icon} {fails ? `${fails} değişmez ihlali` : warns ? `${warns} uyarı` : 'tüm değişmezler geçti'}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
          {(d.counts.PASS ?? 0)} geçti · {(d.counts.SKIP ?? 0)} veri yok
        </span>
        {/* Düz Türkçe özet: kullanıcı sayıları saymadan durumu anlasın. */}
        <span style={{ flexBasis: '100%', fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          {fails
            ? 'Bozuk bir durum var — aşağıdaki kırmızı satırda ne yapılacağı yazıyor.'
            : warns
            ? 'Acil bir sorun yok. Sarı satırda izlenmesi gereken bir durum var; çoğu zaman bir şey yapmanız gerekmez.'
            : 'Her şey yolunda — yapmanız gereken bir şey yok.'}
        </span>
        <button onClick={() => load(true)} disabled={busy}
          style={{ marginLeft: 'auto', fontSize: 11.5, padding: '3px 10px', borderRadius: 4,
                   cursor: busy ? 'wait' : 'pointer', border: '1px solid var(--border-default)',
                   background: 'var(--bg-surface)', color: 'var(--text-secondary)' }}>
          {busy ? 'Çalışıyor…' : 'Yeniden çalıştır'}
        </button>
      </div>

      <div>
        {d.checks.map(c => {
          const s = S[c.status]
          const loud = c.status === 'FAIL' || c.status === 'WARN'
          return (
            <div key={c.id} style={{
              display: 'grid', gridTemplateColumns: '20px 1fr', gap: 8,
              padding: '7px 14px', borderBottom: '1px solid var(--border-subtle)',
              background: loud ? s.bg : 'transparent',
            }}>
              <span style={{ color: s.fg, fontWeight: 800, fontSize: 13 }}>{s.icon}</span>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: loud ? 700 : 500,
                              color: loud ? s.fg : 'var(--text-secondary)' }}>
                  {c.title}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.45 }}>
                  {c.detail}
                </div>
                {/* NE YAPMALI — teknik açıklamadan görsel olarak AYRI durur ki
                    kullanıcı detayı okumadan da eylemi bulabilsin. PASS
                    satırlarında hiç çıkmaz: "sorun yok" satırına aksiyon yazmak
                    gürültü olur ve gerçek uyarıyı gölgeler. */}
                {c.action && (
                  <div style={{
                    marginTop: 4, paddingLeft: 8, fontSize: 11, lineHeight: 1.5,
                    borderLeft: `2px solid ${loud ? s.fg : 'var(--border-strong)'}`,
                    color: 'var(--text-secondary)',
                  }}>
                    <b style={{ color: loud ? s.fg : 'var(--text-muted)' }}>Ne yapmalı: </b>
                    {c.action}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ padding: '7px 14px', fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
        Bu kontroller sistemin kendi kendini denetlemesidir; her açılışta ve her gün
        19:25'te çalışır. <b>İHLAL</b> = bozuk, hemen bakılmalı · <b>uyarı</b> = izlenmeli,
        genelde bir şey yapmak gerekmez · <b>veri yok</b> = henüz ölçmeye yetecek veri
        birikmedi (hata DEĞİL).
        {d.computed_at && <> · Son: {new Date(d.computed_at + 'Z').toLocaleString('tr-TR')}</>}
      </div>
    </div>
  )
}
