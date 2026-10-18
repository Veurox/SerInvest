// =============================================================================
// SerInvest — D modeli gölge sınavı (ileriye dönük)
//
// Faz 3'te (docs/PLAN_2026-10.md §4d) en iyi aday D "göreli etiket" çıktı ama
// eşiği kılpayı kaçırdı. Aynı veride eşiği esnetmek yerine yeni veride
// sınanıyor (§4e): model dondurulmuş, her akşam skor kaydediliyor, hiçbir
// karara karışmıyor. Protokol gereği 60 sınav gününden önce "geçti/kaldı"
// YAZILMAZ — ara ölçümler görünür ama hüküm değildir.
// =============================================================================
import { useEffect, useState } from 'react'
import { ADMIN, adminFetch } from '../../lib/api'
import { fmt, oranYuzde } from '../../lib/format'

interface Olcu { n: number; ort: number | null; t: number | null }
interface Rapor {
  model: { egitildi: string; tarih_min: string; tarih_max: string; n_satir: number } | null
  kayitli_gun: number
  sinav_gunu: number
  esik_gun: number
  ileri?: {
    D: { spearman: Olcu; en_iyi_10_fazla: Olcu }
    sampiyon_ayni_gunler: { spearman: Olcu; en_iyi_10_fazla: Olcu }
    ilk_gun: string | null; son_gun: string | null
  }
  birlesik?: { gun: number; spearman: Olcu; en_iyi_10_fazla: Olcu }
  karar: { durum: 'TOPLANIYOR' | 'GEÇTİ' | 'KALDI'; aciklama: string }
  error?: string
}

const DURUM_RENK: Record<Rapor['karar']['durum'], string> = {
  'TOPLANIYOR': 'var(--text-muted)', 'GEÇTİ': 'var(--profit)', 'KALDI': 'var(--loss)',
}

function Hucre({ ad, o, oran }: { ad: string; o?: Olcu; oran?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{ad}</span>
      <span style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
        {o?.ort == null ? '—' : oran ? oranYuzde(o.ort, 2, true) : fmt(o.ort, 3)}
        <span style={{ fontSize: 10.5, fontWeight: 500, color: 'var(--text-muted)' }}>
          {o?.t == null ? '' : `  t ${fmt(o.t, 2)}`}
        </span>
      </span>
    </div>
  )
}

export function GolgeSinav() {
  const [r, setR] = useState<Rapor | null>(null)

  useEffect(() => {
    let dur = false
    const yukle = () => {
      adminFetch(`${ADMIN}/golge`).then(x => x.ok ? x.json() : null)
        .then((d: Rapor | null) => { if (!dur && d && !d.error) setR(d) })
        .catch(() => {})
    }
    yukle()
    const t = setInterval(yukle, 300_000)
    return () => { dur = true; clearInterval(t) }
  }, [])

  if (!r) return null
  if (!r.model) {
    return (
      <div className="card" style={{ padding: '12px 14px', marginBottom: 'var(--space-3)',
                                     fontSize: 12.5, color: 'var(--text-muted)' }}>
        <b style={{ color: 'var(--text-secondary)' }}>Gölge sınav kurulmadı.</b>{' '}
        Çalıştır: <code>python -m ml.golge_sinav egit</code>
      </div>
    )
  }

  const oran = Math.min(1, r.sinav_gunu / Math.max(1, r.esik_gun))
  const durumRenk = DURUM_RENK[r.karar.durum] ?? 'var(--text-muted)'

  return (
    <div className="card" style={{ padding: '13px 15px', marginBottom: 'var(--space-3)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>Gölge sınav — D modeli (ileriye dönük)</span>
        <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: durumRenk }}>
          {r.karar.durum === 'TOPLANIYOR' ? 'veri toplanıyor' : r.karar.durum}
        </span>
      </div>

      <div style={{ margin: '9px 0 4px', height: 6, borderRadius: 3, background: 'var(--bg-surface-3)',
                    overflow: 'hidden' }}>
        <div style={{ width: `${oran * 100}%`, height: '100%', background: 'var(--accent)' }} />
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
        <b>{r.sinav_gunu}/{r.esik_gun}</b> sınav günü · {r.kayitli_gun} gün kaydedildi
        {r.ileri?.ilk_gun && <> · {r.ileri.ilk_gun} → {r.ileri.son_gun}</>}
      </div>

      <p style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.6, margin: '9px 0' }}>
        Geçmiş sınavda en iyi çıkan tarif, eşiği kılpayı kaçırdı. Aynı veride eşiği
        esnetmek yerine yeni veride sınanıyor: model{' '}
        {r.model.egitildi.slice(0, 10)} tarihinde bir kez eğitildi ve donduruldu, her akşam
        skoru kaydediliyor, <b>hiçbir karara karışmıyor</b>. Bir tahmin ~20 gün sonra
        yargılanır; makinenin açılmadığı günler sayılmaz. {r.esik_gun} sınav gününden önce
        hüküm verilmez.
      </p>

      {r.ileri && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                      gap: '8px 14px', paddingTop: 8, borderTop: '1px solid var(--border-subtle)' }}>
          <Hucre ad="D · gün içi sıra (ileri)" o={r.ileri.D.spearman} />
          <Hucre ad="D · en iyi %10 fazlası (ileri)" o={r.ileri.D.en_iyi_10_fazla} oran />
          <Hucre ad="Şampiyon · aynı günler" o={r.ileri.sampiyon_ayni_gunler.spearman} />
          <Hucre ad="Birleşik · gün içi sıra" o={r.birlesik?.spearman} />
        </div>
      )}

      <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 9, lineHeight: 1.5 }}>
        {r.karar.aciklama}. Geçme şartı: ileri dönemde iki ölçüt de pozitif; geçmiş + ileri
        birlikte sıra t ≥ 2,5, en iyi %10 fazlası %0,40'ın üstünde ve t ≥ 2.
        Protokol: <code>docs/PLAN_2026-10.md §4e</code>.
      </div>
    </div>
  )
}
