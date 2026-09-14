// =============================================================================
// Model sürücüleri — "hangi gösterge kararı ne yöne itti"
//
// Arka uç bunları DÜZ METİN olarak gönderiyor, örnek:
//   "EMA hızlanması 0.00 (model etkisi +0.35, yukarı yönde)"
//
// Buradaki iş, metnin içindeki etki sayısını çıkarıp görselleştirilebilir
// hâle getirmek. Sayı çıkarılabilirse çubuk çizilir (sürücüler büyüklüğe göre
// sıralanabilir), çıkarılamazsa satır düz metin olarak kalır.
//
// BU BİR GEÇİCİ ÇÖZÜM VE ÖYLE OLDUĞU BİLİNİYOR.
// Doğrusu arka ucun yapılandırılmış veri göndermesi ({ad, etki, yon}).
// Metin biçimi değişirse burası sessizce çubuk çizmeyi bırakır — ama YANLIŞ
// çubuk çizmez: ayrıştırılamayan satır metin olarak görünmeye devam eder.
// Sessiz bozulma yerine görünür gerileme.
// =============================================================================

export interface Surucu {
  /** Ham metnin tamamı — ayrıştırma tutmazsa gösterilecek olan. */
  metin: string
  /** Parantezden önceki kısım: göstergenin adı. */
  ad: string
  /** Model etkisi (+/−). Çıkarılamazsa null. */
  etki: number | null
}

/** JSON dizisi olarak gelen listeyi güvenle çözer. */
export function listeCoz(s: string | null | undefined): string[] {
  if (!s) return []
  try {
    const v = JSON.parse(s)
    return Array.isArray(v) ? v.map(String) : []
  } catch {
    return []
  }
}

/**
 * Etki sayısı: "model etkisi +0.35" ya da "etki −0.24" gibi kalıpları yakalar.
 * Hem nokta hem virgül ondalığı, hem düz eksi (-) hem tipografik eksi (−).
 */
const ETKI = /etkisi?\s*([+−-]?\s*\d+(?:[.,]\d+)?)/i

export function surucuAyristir(metin: string): Surucu {
  const ad = (metin.split('(')[0] ?? metin).trim()
  const m = ETKI.exec(metin)
  let etki: number | null = null
  if (m) {
    const ham = m[1].replace(/\s+/g, '').replace('−', '-').replace(',', '.')
    const n = Number(ham)
    if (Number.isFinite(n)) etki = n
  }
  return { metin, ad: ad || metin, etki }
}

/**
 * Sürücü ve riskleri tek listede birleştirir.
 *
 * Risk metinlerinde etki çoğu zaman eksi işaretiyle zaten yazılı; yazılı
 * değilse işaret RİSK OLMASINDAN türetilmez — uydurma bir sayı, olmayan bir
 * ölçüm demektir. O satır çubuksuz kalır.
 */
export function suruculeriTopla(
  keyDrivers: string | null | undefined,
  risks: string | null | undefined,
): Surucu[] {
  const hepsi = [...listeCoz(keyDrivers), ...listeCoz(risks)].map(surucuAyristir)
  // Büyüklüğe göre sırala; ölçülemeyenler sona.
  return hepsi.sort((a, b) => {
    if (a.etki == null && b.etki == null) return 0
    if (a.etki == null) return 1
    if (b.etki == null) return -1
    return Math.abs(b.etki) - Math.abs(a.etki)
  })
}
