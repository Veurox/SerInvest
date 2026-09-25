// =============================================================================
// SerInvest — AL dediği hisseler, demediklerinden iyi mi gitti?
//
// NEDEN BU, "İSABET · BAŞABAŞ" DEĞİL (25.09.2026)
// Ekran eskiden "AL isabeti %54 · başabaş %40" diyordu ve model başabaşın
// rahatça üstünde görünüyordu. İki kusuru vardı:
//   • İsabet yalnız hedefe YA DA stopa değen çağrılardan hesaplanıyor;
//     hiçbirine değmeyen ~%24'lük dilim dışarıda kalıyor.
//   • %40 başabaş 3:2 kazanç/kayıp oranını varsayıyor. Oysa işlemlerin çoğu
//     süre dolunca küçük kâr ya da zararla kapanıyor; kâğıt portföyde
//     gerçekleşen oran ~1:1.
// Aynı ekran başabaşın üstünde bir model gösterirken portföy zarardaydı.
//
// Kullanıcının asıl sorusu şu: AL çağrısına uysam, uymadığım hisselerden daha
// iyi mi ederdim? Bunun cevabı iki grubun GERÇEKLEŞEN getirisi — ikisi de
// aynı üçlü bariyerle ölçüldüğü için kıyaslanabilir. Ölçüldüğünde AL dediği
// hisselerin demediklerinin gerisinde kaldığı çıktı; ekran artık bunu söylüyor.
//
// MEDYAN DA GÖSTERİLİYOR, çünkü ortalama birkaç büyük kazançla şişebiliyor:
// AL grubunda ortalama pozitif, medyan negatif — tipik bir AL çağrısı hafif
// zararla bitiyor, birkaç büyük kazanç ortalamayı yukarı çekiyor.
// =============================================================================
import { yuzde, fmt } from '../../lib/format'

export interface GrupGetiri {
  n: number
  ort: number | null
  medyan: number | null
  pozitif: number | null
}

export interface GetiriKarsilastirma {
  al: GrupGetiri
  diger: GrupGetiri
}

/** Bu kadar puandan küçük fark "aynı" sayılır — gözlemler üst üste biniyor. */
const FARK_ESIK_PUAN = 0.25

function Satir({ ad, g, olcek, vurgu }: {
  ad: string; g: GrupGetiri; olcek: number; vurgu: boolean
}) {
  const v = g.ort != null ? g.ort * 100 : null
  const genislik = v == null || olcek <= 0 ? 0 : Math.min(100, (Math.abs(v) / olcek) * 100)
  const renk = v == null ? 'var(--viz-track)' : v >= 0 ? 'var(--u-up)' : 'var(--u-down)'
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '92px minmax(0,1fr) auto',
                  gap: 'var(--u-s2)', alignItems: 'center' }}>
      <span className="u-sub" style={{ color: vurgu ? 'var(--u-text)' : undefined,
                                       fontWeight: vurgu ? 600 : undefined }}>{ad}</span>
      <div style={{ height: 8, background: 'var(--viz-track)', borderRadius: 'var(--u-r-full)',
                    overflow: 'hidden', minWidth: 0 }}>
        <div style={{ width: `${genislik}%`, height: '100%', background: renk,
                      opacity: vurgu ? 1 : 0.55, borderRadius: 'var(--u-r-full)' }} />
      </div>
      <span className="u-num" style={{ fontWeight: 600, textAlign: 'right',
                                       fontSize: 'var(--u-t-small)' }}>
        {yuzde(v, 2, true)}
      </span>
    </div>
  )
}

export function AlKarsilastirma({ veri }: { veri: GetiriKarsilastirma | null }) {
  if (!veri || !veri.al.n || !veri.diger.n || veri.al.ort == null || veri.diger.ort == null) {
    return <span className="u-sub">Karşılaştırma için değerlendirilmiş tahmin yok.</span>
  }

  const al = veri.al.ort * 100
  const diger = veri.diger.ort * 100
  const fark = al - diger
  const olcek = Math.max(Math.abs(al), Math.abs(diger), 0.5)

  const hukum = Math.abs(fark) < FARK_ESIK_PUAN
    ? <>AL dediği hisselerle demedikleri arasında <b>anlamlı bir fark yok</b>.</>
    : fark > 0
      ? <>AL dediği hisseler, demediklerinden <b style={{ color: 'var(--u-up)' }}>
          {fmt(fark, 2)} puan önde</b>.</>
      : <>AL dediği hisseler, demediklerinin <b style={{ color: 'var(--u-down)' }}>
          {fmt(-fark, 2)} puan gerisinde</b> kaldı — çağrıya uymak şimdiye kadar
          fayda sağlamadı.</>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Satir ad="AL dediği" g={veri.al} olcek={olcek} vurgu />
      <Satir ad="Demediği" g={veri.diger} olcek={olcek} vurgu={false} />
      <span className="u-sub" style={{ marginTop: 2 }}>{hukum}</span>
      <span className="u-exact" style={{ fontSize: 'var(--u-t-micro)' }}>
        10 günlük ortalama getiri · medyan {yuzde((veri.al.medyan ?? 0) * 100, 2, true)} /{' '}
        {yuzde((veri.diger.medyan ?? 0) * 100, 2, true)} · maliyet hariç ·{' '}
        n={fmt(veri.al.n, 0)} / {fmt(veri.diger.n, 0)} · gözlemler üst üste biniyor
      </span>
    </div>
  )
}

export default AlKarsilastirma
