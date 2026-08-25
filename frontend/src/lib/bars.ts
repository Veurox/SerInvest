// =============================================================================
// SerInvest — Bar dönüşümleri (saf fonksiyonlar)
//
// lightweight-charts'ın veriden beklentileri katıdır ve sessizce başarısız olur:
//   • zaman SANİYE cinsinden (bizim API MİLİSANİYE veriyor)
//   • artan sırada olmalı
//   • aynı zaman damgası iki kez olmamalı
// Bu kurallardan biri bozulursa grafik ya boş çizilir ya da bozuk görünür,
// konsola hata düşmez. O yüzden dönüşüm ayrı, saf ve sınanabilir bir yerde
// durur — bileşenin içine gömülü değil.
// =============================================================================

export interface Bar {
  t: number                       // epoch MİLİSANİYE
  o: number | null
  h: number | null
  l: number | null
  c: number
  v: number | null
}

export interface CleanBar extends Bar { s: number }   // s = epoch SANİYE

/**
 * Geçersiz satırları atar, saniyeye çevirir, sıralar ve tekilleştirir.
 * Tekilleştirmede SON kayıt kazanır (geç gelen düzeltme daha doğrudur).
 */
export function cleanBars(bars: Bar[]): CleanBar[] {
  const bySecond = new Map<number, CleanBar>()

  for (const b of bars) {
    if (b == null) continue
    const c = Number(b.c)
    if (!Number.isFinite(c)) continue
    const t = Number(b.t)
    if (!Number.isFinite(t)) continue
    const s = Math.floor(t / 1000)
    bySecond.set(s, { ...b, c, s })
  }

  return [...bySecond.values()].sort((a, b) => a.s - b.s)
}

/** Mum serisi. OHLC eksikse kapanışla doldurulur — grafik kırılmasın. */
export const toCandles = (bars: CleanBar[]) =>
  bars.map(b => ({
    time: b.s,
    open:  Number.isFinite(Number(b.o)) ? Number(b.o) : b.c,
    high:  Number.isFinite(Number(b.h)) ? Number(b.h) : b.c,
    low:   Number.isFinite(Number(b.l)) ? Number(b.l) : b.c,
    close: b.c,
  }))

/** Kapanış çizgisi. */
export const toLine = (bars: CleanBar[]) =>
  bars.map(b => ({ time: b.s, value: b.c }))

/** Hacim histogramı; renk barın yönüne göre. */
export const toVolume = (bars: CleanBar[], upColor: string, downColor: string) =>
  bars.map(b => ({
    time: b.s,
    value: Number.isFinite(Number(b.v)) ? Number(b.v) : 0,
    color: (Number.isFinite(Number(b.o)) ? Number(b.o) : b.c) <= b.c ? upColor : downColor,
  }))

/**
 * Yüzde-değişim normalizasyonu — karşılaştırma modunun çekirdeği.
 *
 * Neden: 8 hisse 8 farklı fiyat ölçeğinde çizilince "hangisi daha iyi gitti"
 * sorusu gözle cevaplanamaz. Hepsi pencerenin BAŞINDAN itibaren yüzde değişime
 * çevrilince aynı eksene oturur ve sıralama görünür olur.
 *
 * Taban = ilk barın KAPANIŞI. Açılış değil: seri kapanışlardan kuruluyor ve
 * ilk barın açılışı bazı kaynaklarda eksik geliyor (o zaman taban kayardı).
 * Taban 0 veya geçersizse dönüşüm YAPILMAZ (bölme hatası yerine ham seri) —
 * sessizce bozuk bir grafik çizmektense normalize etmemek dürüsttür.
 *
 * OHLC'nin dördü de aynı tabana bölünür: kullanıcı mum seçtiyse mum kalır.
 * (08/2026 dersi: kullanıcının açık seçimini kod sessizce ezmez.)
 */
export function toPercent(bars: Bar[]): Bar[] {
  if (bars.length === 0) return bars
  const base = Number(bars[0]?.c)
  if (!Number.isFinite(base) || base === 0) return bars
  const pct = (v: number | null) => {
    const n = Number(v)
    return Number.isFinite(n) ? (n / base - 1) * 100 : null
  }
  return bars.map(b => ({
    ...b,
    o: pct(b.o), h: pct(b.h), l: pct(b.l),
    c: pct(b.c) ?? 0,
  }))
}

/**
 * Verilen SANİYEye ait bar — yoksa ondan önceki EN YAKIN bar.
 *
 * Crosshair senkronunun çekirdeği: fare TUPRS'ta 14 Temmuz'da gezinirken diğer
 * hücrelerin de 14 Temmuz'u okuması gerekir. Tatil/işlem durdurma yüzünden o
 * sembolde tam o gün bar olmayabilir; "önceki en yakın" doğru cevaptır —
 * ileriye bakmak henüz gerçekleşmemiş bir barı göstermek olurdu.
 *
 * Barlar ARTAN sırada varsayılır (cleanBars bunu garantiler). İkili arama:
 * 8 hücre × her fare hareketi için doğrusal tarama gereksiz yük olurdu.
 * `key` ile hem milisaniyeli ham Bar hem saniyeli CleanBar aranabilir.
 */
export function barAtOrBefore<T>(arr: T[], sec: number, key: (x: T) => number): T | null {
  let lo = 0, hi = arr.length - 1, idx = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (key(arr[mid]) <= sec) { idx = mid; lo = mid + 1 } else { hi = mid - 1 }
  }
  return idx >= 0 ? arr[idx] : null
}
