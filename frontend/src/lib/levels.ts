// =============================================================================
// Fiyat seviyeleri — "destek/direnç" DEĞİL, TANIMI OLAN seviyeler
//
// NEDEN BÖYLE ADLANDIRILDI
// "Destek 18,42 · Direnç 20,15" yazmak on dakika sürer ama o sayıların
// NEREDEN geldiği söylenemez. Teknik analizin astrolojiye en çok benzediği
// yer burasıdır: kullanıcı sayıya bakıp pozisyon alır, sayının arkasında bir
// ölçüm yoktur.
//
// Buradaki her seviyenin bir TANIMI var ve tanım ekranda yazıyor. Tanımı olan
// seviye dürüsttür; tanımı olmayan seviye süstür.
//
// Seviyeler "fiyat buraya gelince döner" İDDİASINDA BULUNMAZ. Yalnızca
// "burası şu tanıma göre kayda değer bir fiyat" der. Aradaki fark, bu
// projenin tamamının üstüne kurulu olduğu fark.
// =============================================================================
import type { Bar } from './bars'

export interface Seviye {
  /** Ekranda görünen kısa ad */
  ad: string
  /** Seviyenin NASIL bulunduğu — ipucu olarak gösterilir */
  tanim: string
  fiyat: number
  /** Gruplama: göstergeden mi, fiyat geçmişinden mi, modelden mi */
  tur: 'gosterge' | 'gecmis' | 'model'
}

/** Bir barın gerçek yüksek/düşüğü; yoksa kapanışa düşer. */
const yuksek = (b: Bar) => (b.h ?? b.c)
const dusuk = (b: Bar) => (b.l ?? b.c)

/**
 * Belirgin tepe/dipler — "±pencere barın en yükseği/en düşüğü" kuralı.
 *
 * Kural basit ve YAZILI olduğu için savunulabilir: bir bar, kendisinden
 * önceki ve sonraki `pencere` barın hepsinden yüksekse o bir tepedir.
 * Sihir yok, kalibre edilmiş bir parametre yok.
 *
 * Birbirine `yakinlikYuzde` kadar yakın seviyeler tek seviyede toplanır —
 * aynı tepeyi üç kez listelemek bilgi değil gürültüdür.
 */
export function belirginSeviyeler(
  barlar: Bar[], pencere = 5, yakinlikYuzde = 0.6, azami = 3,
): { tepeler: number[]; dipler: number[] } {
  if (barlar.length < pencere * 2 + 1) return { tepeler: [], dipler: [] }

  const tepeler: number[] = []
  const dipler: number[] = []
  for (let i = pencere; i < barlar.length - pencere; i++) {
    const h = yuksek(barlar[i])
    const l = dusuk(barlar[i])
    let tepeMi = true
    let dipMi = true
    for (let j = i - pencere; j <= i + pencere; j++) {
      if (j === i) continue
      if (yuksek(barlar[j]) >= h) tepeMi = false
      if (dusuk(barlar[j]) <= l) dipMi = false
      if (!tepeMi && !dipMi) break
    }
    if (tepeMi) tepeler.push(h)
    if (dipMi) dipler.push(l)
  }

  const topla = (v: number[]) => {
    const s = [...v].sort((a, b) => b - a)
    const cikti: number[] = []
    for (const x of s) {
      if (!cikti.some(y => Math.abs(y - x) / y * 100 < yakinlikYuzde)) cikti.push(x)
    }
    return cikti
  }
  return { tepeler: topla(tepeler).slice(0, azami), dipler: topla(dipler).slice(-azami) }
}

/**
 * Bir sembolün bütün seviyeleri, tanımlarıyla.
 *
 * Gösterge seviyeleri (EMA, Bollinger) arka uçta zaten hesaplanıyor —
 * yeniden hesaplamıyoruz ki ekrandaki sayı ile modelin kullandığı sayı
 * aynı kalsın (SAGLAMLIK_PLANI K2: "aynı sayı iki yerde yazılı").
 */
export function seviyeleriTopla(opts: {
  barlar: Bar[]
  ema20?: number | null
  ema50?: number | null
  ema200?: number | null
  bbUst?: number | null
  bbOrta?: number | null
  bbAlt?: number | null
  hedef?: number | null
  stop?: number | null
  pencere?: number
}): Seviye[] {
  const { barlar, pencere = 5 } = opts
  const s: Seviye[] = []

  // ── Fiyat geçmişi ────────────────────────────────────────────────────────
  if (barlar.length > 0) {
    const hepsiY = barlar.map(yuksek)
    const hepsiD = barlar.map(dusuk)
    s.push({
      ad: 'Dönem zirvesi', tur: 'gecmis', fiyat: Math.max(...hepsiY),
      tanim: 'Gösterilen dönemdeki en yüksek fiyat. Olgusal — yorum yok.',
    })
    s.push({
      ad: 'Dönem dibi', tur: 'gecmis', fiyat: Math.min(...hepsiD),
      tanim: 'Gösterilen dönemdeki en düşük fiyat. Olgusal — yorum yok.',
    })
    const { tepeler, dipler } = belirginSeviyeler(barlar, pencere)
    tepeler.forEach((p, i) => s.push({
      ad: `Belirgin tepe ${i + 1}`, tur: 'gecmis', fiyat: p,
      tanim: `Kendisinden önceki ve sonraki ${pencere} barın hepsinden yüksek `
           + 'bir bar. "Fiyat buraya gelince döner" iddiası DEĞİL; tanıma göre '
           + 'kayda değer bir fiyat.',
    }))
    dipler.forEach((p, i) => s.push({
      ad: `Belirgin dip ${i + 1}`, tur: 'gecmis', fiyat: p,
      tanim: `Kendisinden önceki ve sonraki ${pencere} barın hepsinden düşük `
           + 'bir bar. Dönüş vaadi değil, tanımlı bir fiyat.',
    }))
  }

  // ── Göstergeler (arka uçta hesaplanmış değerler) ─────────────────────────
  const g = (ad: string, fiyat: number | null | undefined, tanim: string) => {
    if (fiyat != null && Number.isFinite(fiyat)) s.push({ ad, fiyat, tanim, tur: 'gosterge' })
  }
  g('EMA 20', opts.ema20, 'Son 20 işlem gününün (≈1 ay) ağırlıklı ortalaması.')
  g('EMA 50', opts.ema50, 'Son 50 işlem gününün (≈2,5 ay) ağırlıklı ortalaması.')
  g('EMA 200', opts.ema200, 'Son 200 işlem gününün (≈10 ay) ağırlıklı ortalaması — uzun vadeli ana eğilim.')
  g('Bollinger üst', opts.bbUst, '20 günlük ortalamanın iki standart sapma üstü.')
  g('Bollinger orta', opts.bbOrta, 'Son 20 günün ortalama fiyatı.')
  g('Bollinger alt', opts.bbAlt, '20 günlük ortalamanın iki standart sapma altı.')

  // ── Modelin bariyerleri ──────────────────────────────────────────────────
  if (opts.hedef != null) s.push({
    ad: 'Hedef', fiyat: opts.hedef, tur: 'model',
    tanim: 'Modelin kısa vadeli hedefi — son dönem oynaklığının (ATR) katı.',
  })
  if (opts.stop != null) s.push({
    ad: 'Stop', fiyat: opts.stop, tur: 'model',
    tanim: 'Zarar kesme seviyesi — fiyat buraya inerse tahmin yanlışlanmış sayılır.',
  })

  return s
}

/** Fiyata göre uzaklık yüzdesi (işaretli). */
export function uzaklikYuzde(seviye: number, fiyat: number | null | undefined): number | null {
  if (fiyat == null || !Number.isFinite(fiyat) || fiyat === 0) return null
  return ((seviye - fiyat) / fiyat) * 100
}
