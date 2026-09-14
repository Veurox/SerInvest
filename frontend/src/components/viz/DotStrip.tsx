// =============================================================================
// Genişlik şeridi — "83 hissenin 30'u artıda" oranını BİRE BİR gösterir.
//
// NEDEN TEK ÇUBUK DEĞİL
// "30/83" okumak için bölme yapmak gerekiyor. Tek bir dolu çubuk oranı verir
// ama bütünün KAÇ parçadan oluştuğunu gizler — 3/8 ile 30/83 aynı görünür.
// Burada her öğe kendi işaretini alıyor: göz hem oranı hem kalabalığın
// büyüklüğünü aynı anda okuyor.
//
// İŞARET SEÇİMİ ÖLÇÜYE GÖRE
//   • öğe başına yer geniş → daire (sayılabilir, ayrık)
//   • dar → dikey çubuk (yüksekliği kullanır, taramalı bir şerit gibi okunur)
//   • çok dar (yüzlerce öğe) → tek dolu oran çubuğu; tek tek çizmek
//     okunaksız bir gri lekeye dönüşürdü
// =============================================================================

/** Öğe başına bu genişliğin altına düşülürse daire yerine dikey çubuk. */
const DAIRE_ESIGI = 7
/** Öğe başına bu genişliğin altına düşülürse tek dolu oran çubuğu. */
const CIZIM_ESIGI = 1.6

export function DotStrip({
  artida, toplam, genislik = 200, yukseklik = 14,
}: {
  artida: number
  toplam: number
  genislik?: number
  yukseklik?: number
}) {
  const t = Math.max(0, Math.floor(toplam))
  const a = Math.max(0, Math.min(t, Math.floor(artida)))
  const oran = t > 0 ? a / t : 0
  const etiket = t > 0 ? `${t} içinden ${a} artıda` : 'Veri yok'

  if (t === 0) {
    return (
      <div style={{ width: genislik, height: yukseklik, borderRadius: 'var(--u-r-full)',
                    background: 'var(--viz-track)' }}
           role="img" aria-label={etiket} />
    )
  }

  const adim = genislik / t

  // Çok kalabalık: tek tek çizmek anlamsız, oran çubuğuna düş.
  if (adim < CIZIM_ESIGI) {
    return (
      <div style={{ width: genislik, height: yukseklik, borderRadius: 'var(--u-r-full)',
                    background: 'var(--u-down-bg)', overflow: 'hidden', display: 'flex' }}
           role="img" aria-label={etiket}>
        <div style={{ width: `${oran * 100}%`, background: 'var(--u-up)' }} />
      </div>
    )
  }

  const daire = adim >= DAIRE_ESIGI
  const r = Math.min(adim * 0.34, yukseklik / 2 - 1)
  const cbGenislik = Math.max(1.2, adim * 0.62)

  return (
    <svg width={genislik} height={yukseklik} viewBox={`0 0 ${genislik} ${yukseklik}`}
         role="img" aria-label={etiket} style={{ display: 'block' }}>
      {Array.from({ length: t }, (_, i) => {
        const x = i * adim + adim / 2
        const iyi = i < a
        const renk = iyi ? 'var(--u-up)' : 'var(--u-down)'
        const op = iyi ? 1 : 0.38
        return daire
          ? <circle key={i} cx={x} cy={yukseklik / 2} r={r} fill={renk} opacity={op} />
          : <rect key={i} x={x - cbGenislik / 2} y={0} width={cbGenislik} height={yukseklik}
                  rx={Math.min(1, cbGenislik / 2)} fill={renk} opacity={op} />
      })}
    </svg>
  )
}

export default DotStrip
