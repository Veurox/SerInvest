// =============================================================================
// Aralık çubuğu — bir oranı, NE KADAR BİLİNDİĞİYLE birlikte gösterir
//
// NEDEN NOKTA DEĞİL BANT
// "%37,5" tek bir nokta olarak çizilince, ölçülmüş ve oturmuş bir sayı gibi
// okunuyor. Oysa on altı gözlemden çıkan bir oranın etrafındaki belirsizlik
// oranın kendisinden büyük olabiliyor. Bant, o belirsizliği sayfanın
// üstünde YER KAPLAYAN bir şeye çeviriyor: geniş bant "bilmiyoruz" der,
// dar bant "biliyoruz" der, ve ikisi arasındaki fark göze çarpar.
//
// REFERANS ÇİZGİSİ KARARIN KENDİSİ
// Bant referansı (modelin genel isabeti) içine alıyorsa, elde bir fark YOK
// demektir. Dışarıda bırakıyorsa fark var. Bu yüzden bandın rengi referansın
// nerede kaldığına göre değişiyor — kullanıcının aritmetik yapması gerekmez.
// =============================================================================
import { yuzde } from '../../lib/format'

export function IntervalBar({
  deger, alt, ust, referans, referansEtiket, genislik = 260, yukseklik = 20,
}: {
  /** Nokta tahmin (0–100) */
  deger: number
  /** Güven aralığının alt/üst ucu (0–100) */
  alt: number
  ust: number
  /** Karşılaştırma çizgisi (0–100) — ör. modelin genel isabeti */
  referans?: number | null
  referansEtiket?: string
  genislik?: number
  yukseklik?: number
}) {
  const kis = (v: number) => Math.max(0, Math.min(100, v))
  const a = kis(alt), u = kis(ust), d = kis(deger)
  const x = (v: number) => (v / 100) * genislik

  // Referans bandın içindeyse ayırt edici bir bulgu yok — nötr renk.
  const ayirt = referans != null && (referans < a || referans > u)
  const renk = !ayirt ? 'var(--u-flat)' : (d > (referans ?? 50) ? 'var(--u-up)' : 'var(--u-down)')

  const etiket = `${yuzde(d, 1)}, %95 güven aralığı ${yuzde(a, 0)}–${yuzde(u, 0)}`
    + (referans != null
        ? `; ${referansEtiket ?? 'karşılaştırma'} ${yuzde(referans, 1)}` : '')

  return (
    <svg viewBox={`0 0 ${genislik} ${yukseklik}`} width="100%"
         style={{ maxWidth: genislik, height: yukseklik, display: 'block' }}
         role="img" aria-label={etiket}>
      {/* 0–100 rayı */}
      <rect x={0} y={yukseklik / 2 - 2} width={genislik} height={4} rx={2}
            fill="var(--viz-track)" />
      {/* Güven aralığı bandı */}
      <rect x={x(a)} y={yukseklik / 2 - 6} width={Math.max(2, x(u) - x(a))} height={12}
            rx={3} fill={renk} opacity={0.32} />
      {/* Nokta tahmin */}
      <rect x={x(d) - 1} y={yukseklik / 2 - 8} width={2.5} height={16} rx={1} fill={renk} />
      {/* Referans */}
      {referans != null && (
        <line x1={x(kis(referans))} x2={x(kis(referans))} y1={1} y2={yukseklik - 1}
              stroke="var(--viz-ref)" strokeWidth={1} strokeDasharray="2 2" />
      )}
    </svg>
  )
}

export default IntervalBar
