// =============================================================================
// SerInvest — Model Kanıt Paneli
// docs/MODEL_KANIT.md'nin görünen yüzü.
//
// Neden var: arayüz 50 hissenin 49'una "GÜÇLÜ ALIM · %53 güven" yazıyordu.
// Ölçüm bu iddiayı desteklemiyor — 485 OOS gününde gün-içi Spearman t = -0.78.
// 18.10.2026: Faz 3 deneyi (476 gün, Newey-West) aynı sonucu verdi: t = 0,43.
// Kaynak artık o; eşik 2,5 (protokol §4c).
// Bir sayıyı büyük puntoyla göstermek onu doğru yapmaz; yanında kanıtı da
// göstermek zorundayız. Kanıt yoksa bunu açıkça söylüyoruz.
// =============================================================================
import { useState } from 'react'
import { useEvidence } from './useEvidence'
import { fmt } from '../../lib/format'

/** Sinyal listelerinin üstünde duran kısa uyarı. Kanıt varsa görünmez. */
export function EvidenceBanner() {
  const e = useEvidence()
  if (!e?.measured || e.ranking?.proven) return null

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 9, marginBottom: 'var(--space-3)',
      padding: '10px 13px', borderRadius: 6,
      border: '1px solid var(--warning-border)', background: 'var(--warning-bg)',
    }}>
      <span style={{ color: 'var(--warning)', fontWeight: 800, fontSize: 14, lineHeight: 1.3 }}>!</span>
      <div style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
        <b style={{ color: 'var(--warning)' }}>Bu sıralamanın ölçülmüş bir gücü yok.</b>{' '}
        Modelin aynı gün içinde iyi hisseyi kötüden ayırma yeteneği
        {e.n_days ? ` ${e.n_days} bağımsız günde` : ''} sınandı ve şanstan ayırt edilemedi
        {e.ranking?.t != null && <> (sıra korelasyonu t={fmt(e.ranking.t, 2)}; kanıt için
          t≥{fmt(e.ranking.esik ?? 2, 1)} gerekir)</>}.
        Güven yüzdeleri modelin çıktısıdır, <b>doğrulanmış bir olasılık değildir</b> —
        yatırım kararına dayanak alınmamalıdır. Ayrıntı: Model sayfası → Kanıt.
      </div>
    </div>
  )
}

const Row = ({ label, value, note, tone }:
  { label: string; value: string; note?: string; tone?: string }) => (
  <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 12,
                alignItems: 'baseline', padding: '7px 0',
                borderBottom: '1px solid var(--border-subtle)' }}>
    <div>
      <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{label}</div>
      {note && <div style={{ fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>{note}</div>}
    </div>
    <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap',
                  color: tone ?? 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
      {value}
    </div>
  </div>
)

/** Model sayfasındaki tam kanıt paneli. */
export function ModelEvidence() {
  const e = useEvidence()
  const [open, setOpen] = useState(false)

  if (!e) return null

  if (!e.measured) {
    return (
      <div className="card" style={{ padding: '12px 14px', marginBottom: 'var(--space-3)',
                                     fontSize: 12.5, color: 'var(--text-muted)' }}>
        <b style={{ color: 'var(--text-secondary)' }}>Kanıt henüz ölçülmedi.</b>{' '}
        Çalıştır: <code>python -m ml.experiment_faz3</code>
      </div>
    )
  }

  const r  = e.ranking
  const rf = e.risk_filter
  const proven = !!r?.proven

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 'var(--space-3)',
                                   borderColor: proven ? undefined : 'var(--warning-border)' }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                 padding: '11px 14px', border: 'none', textAlign: 'left',
                 background: proven ? 'var(--bg-surface-2)' : 'var(--warning-bg)',
                 color: 'var(--text-primary)', fontSize: 13, fontWeight: 700 }}>
        <span style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s',
                       color: 'var(--text-muted)' }}>▸</span>
        Kanıt — model gerçekten bir şey biliyor mu?
        <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700,
                       color: proven ? 'var(--profit)' : 'var(--warning)' }}>
          {proven ? '✓ sıralama gücü ölçüldü' : 'sıralama gücü kanıtlanamadı'}
        </span>
      </button>

      {open && (
        <div style={{ padding: '4px 14px 12px', borderTop: '1px solid var(--border-subtle)' }}>
          <p style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.65, margin: '10px 0' }}>
            Aşağıdaki sayılar <b>gün bazında bağımsız</b> ölçümlerdir: aynı günün 50 satırı
            tek gözlem sayılır. Bu ayrım önemli — ilk analizde 249 sonuçlanmış tahmin vardı
            ama yalnızca 5 bağımsız gün, ve havuzlama yanlış sonuç vermişti.
          </p>

          {r && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em',
                            textTransform: 'uppercase', color: 'var(--text-muted)',
                            margin: '12px 0 4px' }}>
                Hisse seçme yeteneği
              </div>
              <Row label="Gün-içi sıra korelasyonu"
                   note={`${e.n_oos?.toLocaleString('tr-TR')} tahmin · ${e.n_days} bağımsız gün`}
                   value={fmt(r.spearman ?? null, 4)} />
              <Row label={r.nw ? 'İstatistiksel güç (Newey-West t)' : 'İstatistiksel güç (t)'}
                   note={`Kanıt için t ≥ ${fmt(r.esik ?? 2, 1)} gerekir`}
                   value={fmt(r.t ?? null, 2)}
                   tone={proven ? 'var(--profit)' : 'var(--loss)'} />
              <Row label="Yargı"
                   value={proven ? 'sıralayabiliyor' : 'şanstan ayırt edilemiyor'}
                   tone={proven ? 'var(--profit)' : 'var(--loss)'} />
              {e.faz3 && (
                <Row label="En iyi aday tarif"
                     note="Geçmiş sınavda eşiğe en yakın çıkan tarif. Canlıya alınmadı —
                           yeni veride gölge sınavda (aşağıda)."
                     value={`${e.faz3.en_iyi_aday.varyant} · t ${fmt(e.faz3.en_iyi_aday.spearman_t ?? null, 2)}`} />
              )}
            </>
          )}

          {rf && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em',
                            textTransform: 'uppercase', color: 'var(--text-muted)',
                            margin: '14px 0 4px' }}>
                Risk filtresi (oynaklık)
              </div>
              <Row label="Eşit ağırlık — Sharpe"
                   note={`${rf.n_periods} aylık dönem, işlem maliyeti dâhil`}
                   value={fmt(rf.baseline_sharpe ?? null, 2)} />
              <Row label="En düşük oynaklık %20 — Sharpe"
                   value={fmt(rf.lowvol_sharpe ?? null, 2)} />
              <Row label="Fark kanıtlanmış mı?"
                   note={rf.sharpe_se != null
                     ? `Sharpe farkının standart hatası ≈ ${fmt(rf.sharpe_se, 2)}`
                     : undefined}
                   value={rf.proven ? 'evet' : 'hayır — gürültü içinde'}
                   tone={rf.proven ? 'var(--profit)' : 'var(--warning)'} />
            </>
          )}

          <p style={{ fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1.6, marginTop: 12 }}>
            {e.kaynak === 'faz3' && e.date_range
              ? <>Ölçüm BIST-50, test dönemi {e.date_range[0]} → {e.date_range[1]}; tek ülke.
                  Protokol sonuçlardan önce yazıldı: <code>docs/PLAN_2026-10.md §4c</code>.</>
              : <>Ölçüm 3 yıllık BIST-50 verisi üzerindedir; tek ülke, tek rejim.</>}{' '}
            Ayrıntılı kanıt zinciri ve tekrarlanamayacak denemeler:{' '}
            <code>docs/MODEL_KANIT.md</code>. Bu sayfa yatırım tavsiyesi değildir.
          </p>
        </div>
      )}
    </div>
  )
}
