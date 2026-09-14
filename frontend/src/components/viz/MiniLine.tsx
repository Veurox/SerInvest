// =============================================================================
// Mini çizgi — küçük alanda bir serinin GİDİŞATINI gösterir, değerini değil.
//
// İKİ DÜRÜSTLÜK ÖZELLİĞİ (PLAN_ARAYUZ.md §4)
//
// 1. `yetersiz`: örneklem azken çizgi soluklaşır ve "yetersiz veri" yazar.
//    Modelin 10 günlük doğruluk dalgalanması bir eğilim DEĞİLDİR; pürüzsüz
//    bir çizgiyle çizilirse "yükseliyor" diye okunur. Bu bayrak o okumayı
//    baştan engelliyor.
//
// 2. `referans`: bir çizginin anlamı çoğu zaman bir eşiğe göredir (rastgele
//    %50, başabaş, sıfır K/Z). Eşik çizilmezse göz kendi eşiğini uydurur.
//
// Eksen kırpma: seri kendi aralığına ölçekleniyor (sparkline'ın doğası).
// Bu yüzden `referans` verildiğinde ölçek onu KAPSAYACAK şekilde genişletiliyor —
// yoksa eşiğin üstünde mi altında mı olduğun görünmez ve çizgi yalan söyler.
// =============================================================================

export function MiniLine({
  veri, genislik = 120, yukseklik = 34, renk, referans, yetersiz = false,
  alan = true, sonNokta = true,
}: {
  veri: (number | null)[]
  genislik?: number
  yukseklik?: number
  renk?: string
  /** Anlamı belirleyen yatay çizgi (ör. %50 rastgele, 0 K/Z) */
  referans?: number | null
  /** Örneklem yetersizse: soluk çizgi + uyarı */
  yetersiz?: boolean
  alan?: boolean
  sonNokta?: boolean
}) {
  const nokta = veri.filter((v): v is number => v != null && Number.isFinite(v))
  if (nokta.length < 2) {
    return (
      <div style={{ width: genislik, height: yukseklik, display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                    background: 'var(--viz-track)', borderRadius: 'var(--u-r-sm)' }}>
        <span style={{ fontSize: 'var(--u-t-micro)', color: 'var(--u-text-4)' }}>veri yok</span>
      </div>
    )
  }

  let enAz = Math.min(...nokta)
  let enCok = Math.max(...nokta)
  // Referans görünür olmalı, yoksa "eşiğin üstünde mi" sorusu cevapsız kalır.
  if (referans != null) {
    enAz = Math.min(enAz, referans)
    enCok = Math.max(enCok, referans)
  }
  const aralik = enCok - enAz || 1
  const pay = aralik * 0.12
  const alt = enAz - pay
  const ust = enCok + pay

  const x = (i: number) => (i / (veri.length - 1)) * genislik
  const y = (v: number) => yukseklik - ((v - alt) / (ust - alt)) * yukseklik

  // Boşluklar çizgiyi kesmeli: olmayan günü düz çizgiyle bağlamak veri uydurmaktır.
  const parcalar: string[] = []
  let simdiki: string[] = []
  veri.forEach((v, i) => {
    if (v == null || !Number.isFinite(v)) {
      if (simdiki.length > 1) parcalar.push(simdiki.join(' '))
      simdiki = []
      return
    }
    simdiki.push(`${simdiki.length ? 'L' : 'M'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`)
  })
  if (simdiki.length > 1) parcalar.push(simdiki.join(' '))

  const c = renk ?? 'var(--viz-1)'
  const op = yetersiz ? 0.42 : 1
  const sonIdx = veri.length - 1 - [...veri].reverse()
    .findIndex(v => v != null && Number.isFinite(v))
  const sonDeger = veri[sonIdx] as number

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <svg width={genislik} height={yukseklik} viewBox={`0 0 ${genislik} ${yukseklik}`}
           role="img" aria-label={yetersiz ? 'Gidişat — örneklem yetersiz' : 'Gidişat'}
           style={{ display: 'block', overflow: 'visible' }}>
        {referans != null && (
          <line x1={0} y1={y(referans)} x2={genislik} y2={y(referans)}
                stroke="var(--viz-ref)" strokeWidth={1} strokeDasharray="3 3" />
        )}
        {alan && parcalar.length === 1 && (
          <path d={`${parcalar[0]} L ${genislik} ${yukseklik} L 0 ${yukseklik} Z`}
                fill={c} opacity={yetersiz ? 0.06 : 0.13} />
        )}
        {parcalar.map((p, i) => (
          <path key={i} d={p} fill="none" stroke={c} strokeWidth={1.75}
                strokeLinecap="round" strokeLinejoin="round" opacity={op} />
        ))}
        {sonNokta && (
          <circle cx={x(sonIdx)} cy={y(sonDeger)} r={2.5} fill={c} opacity={op} />
        )}
      </svg>
      {yetersiz && (
        <span style={{ fontSize: 'var(--u-t-micro)', color: 'var(--u-text-4)' }}>
          örneklem yetersiz — eğilim okunmaz
        </span>
      )}
    </div>
  )
}

export default MiniLine
