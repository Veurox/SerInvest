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
