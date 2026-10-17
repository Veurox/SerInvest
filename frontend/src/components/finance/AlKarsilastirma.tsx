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
// aynı üçlü bariyerle ölçüldüğü için kıyaslanabilir.
//
// NEDEN AYNI GÜN İÇİNDE (18.10.2026)
// İlk hâli iki grubu tüm zamanlar boyunca havuzluyordu. Rejim kapısı Eylül
// düşüşünde her şeyi NÖTR'e çekince "demediği" grubu kötü günlerle doldu,
// AL grubu ise Temmuz–Ağustos'ta kaldı. Ekran yeşil "2,1 puan önde" dedi;
// aynı gün içinde kıyaslanınca AL 2,7 puan GERİDEYDİ (16 günün 15'inde).
// Kıyaslanan model değil, iki ayrı dönemin piyasasıydı. Artık yalnız iki
// grubun birlikte olduğu günler sayılıyor (hesap arka uçta).
// =============================================================================
import { yuzde, fmt } from '../../lib/format'

export interface GrupGetiri {
  n: number
  ort: number | null
  medyan: number | null
  pozitif: number | null
}

/** Yalnız AL ve AL-dışı tahminin aynı gün birlikte olduğu günler. */
export interface AyniGunKiyas {
  gun: number
  /** Günlük AL ortalamalarının ortalaması (oran) */
  al_ort: number
  diger_ort: number
  /** al_ort − diger_ort (oran) */
  fark: number
  al_onde_gun: number
  min_grup: number
}

export interface GetiriKarsilastirma {
  /** Havuzlanmış — farklı dönemleri karıştırır, hüküm için KULLANILMAZ. */
  al: GrupGetiri
  diger: GrupGetiri
  ayni_gun?: AyniGunKiyas | null
}

/** Bu kadar puandan küçük fark "aynı" sayılır — gözlemler üst üste biniyor. */
const FARK_ESIK_PUAN = 0.25
/** Hüküm için gereken asgari gün; azsa yalnız sayılar gösterilir. */
const MIN_GUN = 10

function Satir({ ad, oran, olcek, vurgu }: {
  ad: string; oran: number; olcek: number; vurgu: boolean
}) {
  const v = oran * 100
  const genislik = olcek <= 0 ? 0 : Math.min(100, (Math.abs(v) / olcek) * 100)
  const renk = v >= 0 ? 'var(--u-up)' : 'var(--u-down)'
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
  const k = veri?.ayni_gun
  if (!k || !k.gun) {
    return <span className="u-sub">
      Karşılaştırma için AL ve AL dışı tahminin aynı gün birlikte değerlendirildiği gün yok.
    </span>
  }

  const al = k.al_ort * 100
  const diger = k.diger_ort * 100
  const fark = k.fark * 100
  const olcek = Math.max(Math.abs(al), Math.abs(diger), 0.5)

  const hukum = k.gun < MIN_GUN
    ? <>Hüküm için en az {MIN_GUN} gün gerekiyor; şimdilik {fmt(k.gun, 0)} gün var.</>
    : Math.abs(fark) < FARK_ESIK_PUAN
      ? <>Aynı günlerde AL dediği hisselerle demedikleri arasında <b>anlamlı bir fark yok</b>.</>
      : fark > 0
        ? <>Aynı günlerde AL dediği hisseler, demediklerinden <b style={{ color: 'var(--u-up)' }}>
            {fmt(fark, 2)} puan önde</b>.</>
        : <>Aynı günlerde AL dediği hisseler, demediklerinin <b style={{ color: 'var(--u-down)' }}>
            {fmt(-fark, 2)} puan gerisinde</b> kaldı — çağrıya uymak şimdiye kadar
            fayda sağlamadı.</>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Satir ad="AL dediği" oran={k.al_ort} olcek={olcek} vurgu />
      <Satir ad="Demediği" oran={k.diger_ort} olcek={olcek} vurgu={false} />
      <span className="u-sub" style={{ marginTop: 2 }}>{hukum}</span>
      <span className="u-exact" style={{ fontSize: 'var(--u-t-micro)' }}>
        10 günlük ortalama getiri · yalnız iki grubun birlikte olduğu günler ·
        AL grubunun önde olduğu gün: {fmt(k.al_onde_gun, 0)} / {fmt(k.gun, 0)} ·
        maliyet hariç · gözlemler üst üste biniyor
      </span>
    </div>
  )
}

export default AlKarsilastirma
