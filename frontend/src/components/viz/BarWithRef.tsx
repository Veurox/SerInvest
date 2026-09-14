// =============================================================================
// Eşikli çubuk — bir oranı, ANLAM KAZANDIĞI eşikle birlikte gösterir.
//
// BU BİLEŞEN BİR DÜRÜSTLÜK ARACI
// "Güven %58" tek başına iyi mi kötü mü belli değil. Asıl soru şu: başabaş
// eşiği %42 ve %58 onun üstünde mi? Eşik çizilmeden gösterilen bir oran,
// kullanıcının kafasında olmayan bir kıyasla değerlendiriliyor.
//
// Aynı kalıp birçok yerde geçiyor:
//   güven %58        ↔ başabaş %42
//   AL isabeti %51,5 ↔ başabaş %42
//   doğruluk %58,3   ↔ rastgele %50
//   fon getirisi     ↔ para piyasası eşiği
//
// Eşik verilmezse çubuk yine çizilir ama o zaman yalnız "ne kadar" der,
// "yeterli mi" demez — çağıranın bunu bilerek seçmesi gerekir.
// =============================================================================
import { fmt, yuzde } from '../../lib/format'

export function BarWithRef({
  deger, esik, esikEtiket, renk, yukseklik = 9, gosterDeger = true, birim = '%',
}: {
  /** 0-100 */
  deger: number | null
  /** 0-100 · anlamı belirleyen eşik (başabaş, rastgele, kıyas) */
  esik?: number | null
  esikEtiket?: string
  renk?: string
  yukseklik?: number
  gosterDeger?: boolean
  birim?: string
}) {
  const v = deger == null ? null : Math.max(0, Math.min(100, deger))
  const e = esik == null ? null : Math.max(0, Math.min(100, esik))

  // Eşiğin altı/üstü anlamı değiştirir: renk buradan gelir, keyfî değil.
  const otomatikRenk = v == null ? 'var(--u-text-4)'
    : e == null ? 'var(--u-accent)'
    : v >= e ? 'var(--u-up)' : 'var(--u-down)'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
      <div style={{ position: 'relative', height: yukseklik,
                    background: 'var(--viz-track)', borderRadius: 'var(--u-r-full)' }}
           role="img"
           aria-label={v == null ? 'Veri yok'
             : `${v}${birim}${e != null ? `, eşik ${e}${birim}` : ''}`}>
        {v != null && (
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0,
                        width: `${v}%`, background: renk ?? otomatikRenk,
                        borderRadius: 'var(--u-r-full)' }} />
        )}
        {e != null && (
          <div style={{ position: 'absolute', left: `${e}%`, top: -3, bottom: -3,
                        width: 2, background: 'var(--viz-ref)', borderRadius: 1 }} />
        )}
      </div>

      {(gosterDeger || (e != null && esikEtiket)) && (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
          {gosterDeger && (
            <span className="u-num" style={{ fontSize: 'var(--u-t-small)',
                                             color: 'var(--u-text-2)', fontWeight: 600 }}>
              {v == null ? '—'
                : birim === '%' ? yuzde(v, v % 1 === 0 ? 0 : 1)
                : `${birim}${fmt(v, v % 1 === 0 ? 0 : 1)}`}
            </span>
          )}
          {e != null && esikEtiket && (
            <span style={{ fontSize: 'var(--u-t-micro)', color: 'var(--u-text-3)',
                           whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {esikEtiket}{' '}
              {birim === '%' ? yuzde(e, e % 1 === 0 ? 0 : 1)
                             : `${birim}${fmt(e, e % 1 === 0 ? 0 : 1)}`}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

export default BarWithRef
