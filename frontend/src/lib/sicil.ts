// =============================================================================
// Modelin BİR HİSSEDEKİ sicili — geçmiş çağrılara ne olduğu
//
// NEDEN BU EKRANDA VAR
// "Model AEFES için AL diyor" cümlesinin tek başına bir ağırlığı yok. Ağırlığı
// veren şey, modelin bu hissede daha önce ne dediği ve o dediklerine ne
// olduğudur. Tahmin günlüğü zaten tutuluyordu; yalnızca Yönetim sekmesinde,
// yani kararı verecek kişinin bakmadığı yerde duruyordu.
//
// NEDEN ORAN DEĞİL SONUÇ ÖNDE
// "İsabet %37,5" yazmak kolay; yanıltıcı olması da o kadar kolay. İki ayrı
// sebeple:
//
//   1. SAYI AZ. Bir hissede iki ayda 12–16 değerlendirilmiş çağrı oluyor.
//      Bu kadar gözlemle bulunan oranın güven aralığı neredeyse bütün
//      ihtimalleri kapsıyor.
//
//   2. GÖZLEMLER BAĞIMSIZ DEĞİL. Çağrı her gün üretiliyor ama ufuk 10 gün.
//      Ardışık iki çağrının penceresi 9 gün ÇAKIŞIYOR — ikisi de aynı fiyat
//      hareketini ölçüyor. 20 sonuç, 20 ayrı deneme değil.
//
// Bu yüzden ekranda ÖNCE olan biten (kaç çağrı, kaçı hedefe, kaçı stopa)
// duruyor — bunlar olgu. Oran sonra geliyor ve yanında ne kadar
// güvenilebileceği yazıyor. Aynı ilke güvenilirlik eğrisinde de uygulandı.
// =============================================================================

/** /admin/prediction-log satırının bu ekranda kullanılan alanları. */
export interface SicilSatiri {
  timestamp: string
  symbol: string
  /** Long-only: 'BUY' | 'NEUTRAL' */
  predicted: string
  confidence: number
  close: number
  evaluated: boolean
  /** 'UP' (hedefe değdi) | 'DOWN' (stopa değdi) | 'NEUTRAL' (ikisi de olmadı) | '' */
  outcome: string
  target?: number | null
  stop?: number | null
  exit_price?: number | null
  return?: string
}

export type Sonuc = 'hedef' | 'stop' | 'ortada' | 'bekliyor'

export interface Cagri {
  gun: string
  guven: number
  giris: number
  sonuc: Sonuc
  cikis?: number | null
  getiri?: number | null
}

export interface Sicil {
  /** Modelin bu hissede kaç kez AL dediği */
  cagri: number
  bekleyen: number
  hedefe: number
  stopa: number
  ortada: number
  /** Hedef ya da stopa değmiş olanlar — isabetin paydası */
  yonlu: number
  /** İsabet oranı (0–1); yönlü sonuç yoksa null */
  isabet: number | null
  ilkGun: string | null
  sonGun: string | null
  /** Günlükte bu hisse için kaç ayrı gün var */
  gunSayisi: number
  cagrilar: Cagri[]
}

const SONUC: Record<string, Sonuc> = { UP: 'hedef', DOWN: 'stop', NEUTRAL: 'ortada' }

/**
 * Yalnız AL çağrıları sayılır.
 *
 * NEUTRAL bir çağrı değil, çağrı YOKLUĞUDUR: uygulanabilir bir işlem
 * önermez, hedefi ve stopu yoktur. Onu da sicile katmak paydayı şişirip
 * oranı sulandırırdı — modelin "çoğunlukla sustuğu" bir dönem, sanki
 * çoğunlukla haklıymış gibi okunurdu.
 */
export function sicilCikar(satirlar: SicilSatiri[]): Sicil {
  const al = satirlar.filter(r => r.predicted === 'BUY')
  const cagrilar: Cagri[] = al.map(r => ({
    gun: r.timestamp,
    guven: r.confidence,
    giris: r.close,
    sonuc: r.evaluated ? (SONUC[r.outcome] ?? 'ortada') : 'bekliyor',
    cikis: r.exit_price ?? null,
    getiri: r.return ? Number(r.return) : null,
  })).sort((a, b) => (a.gun < b.gun ? 1 : -1))

  const say = (s: Sonuc) => cagrilar.filter(c => c.sonuc === s).length
  const hedefe = say('hedef')
  const stopa = say('stop')
  const yonlu = hedefe + stopa
  const gunler = [...new Set(satirlar.map(r => r.timestamp))].sort()

  return {
    cagri: cagrilar.length,
    bekleyen: say('bekliyor'),
    hedefe,
    stopa,
    ortada: say('ortada'),
    yonlu,
    isabet: yonlu > 0 ? hedefe / yonlu : null,
    ilkGun: gunler[0] ?? null,
    sonGun: gunler[gunler.length - 1] ?? null,
    gunSayisi: gunler.length,
    cagrilar,
  }
}

/**
 * Çakışmayan pencere sayısı — sonuçların KAÇ bağımsız denemeye karşılık
 * geldiği.
 *
 * Günlükte 46 iş günü varsa ve ufuk 10 günse, üst üste binmeyen en fazla
 * 5 pencere sığar. Değerlendirilmiş sonuç sayısı bundan büyük olamaz:
 * fazlası aynı fiyat hareketinin tekrar tekrar sayılmasıdır.
 */
export function bagimsizGozlem(gunSayisi: number, ufukGun: number, gozlem: number): number {
  if (gozlem <= 0) return 0
  const pencere = Math.max(1, Math.floor(gunSayisi / Math.max(1, ufukGun)))
  return Math.min(gozlem, pencere)
}

/**
 * Wilson %95 güven aralığı.
 *
 * Normal yaklaşıklık (p ± 1.96·√(p(1-p)/n)) burada kullanılamaz: 0/13 gibi
 * uç durumlarda sıfır genişlikte bir aralık üretiyor, yani "isabet kesin
 * %0" diyor. Wilson uçlarda da anlamlı bir aralık verir.
 */
export function wilson(k: number, n: number): [number, number] {
  if (n <= 0) return [0, 1]
  const z = 1.96
  const p = k / n
  const pay = p + (z * z) / (2 * n)
  const yaricap = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n)
  const bolen = 1 + (z * z) / n
  return [Math.max(0, (pay - yaricap) / bolen), Math.min(1, (pay + yaricap) / bolen)]
}

/**
 * Bu sicilden bir sonuç çıkar mı?
 *
 * Çıkmasının şartı, güven aralığının modelin genel isabetini DIŞARIDA
 * bırakmasıdır. Aralık genel ortalamayı kapsıyorsa "bu hisse farklı"
 * denemez; elde yalnız gürültü vardır.
 */
export function sicilYorumu(
  sicil: Sicil, ufukGun: number,
  /** Modelin bütün hisselerdeki isabeti — ORAN (0–1), yüzde değil. */
  genelIsabet: number | null,
): { metin: string; ayirt: boolean; alt: number; ust: number; nEtkin: number } {
  const nEtkin = bagimsizGozlem(sicil.gunSayisi, ufukGun, sicil.yonlu)
  const kEtkin = sicil.isabet != null ? Math.round(sicil.isabet * nEtkin) : 0
  const [alt, ust] = wilson(kEtkin, nEtkin)

  if (sicil.yonlu === 0) {
    return {
      metin: 'Henüz hedefe ya da stopa değmiş bir çağrı yok — ölçülecek sonuç yok.',
      ayirt: false, alt, ust, nEtkin,
    }
  }

  const cakisma = sicil.yonlu > nEtkin
    ? `Bu ${sicil.yonlu} sonuç ${sicil.yonlu} ayrı deneme değil: çağrılar her gün `
      + `üretiliyor, ufuk ${ufukGun} gün, yani pencereler üst üste biniyor. `
      + `${sicil.gunSayisi} işlem gününe kabaca ${nEtkin} bağımsız pencere sığıyor.`
    : ''

  if (genelIsabet == null) {
    return { metin: cakisma, ayirt: false, alt, ust, nEtkin }
  }

  const ayirt = genelIsabet < alt || genelIsabet > ust
  const genelY = (genelIsabet * 100).toFixed(1).replace('.', ',')
  const sonuc = ayirt
    ? `Aralık modelin genel isabetini (%${genelY}) dışarıda bırakıyor — `
      + 'bu hissedeki fark gürültüyle açıklanamıyor.'
    : `Aralık modelin genel isabetini (%${genelY}) kapsıyor — bu hissenin `
      + 'diğerlerinden farklı olduğu SÖYLENEMEZ.'

  return { metin: [cakisma, sonuc].filter(Boolean).join(' '), ayirt, alt, ust, nEtkin }
}
