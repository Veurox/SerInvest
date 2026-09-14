// =============================================================================
// SerInvest — Format / görüntüleme yardımcıları
// =============================================================================

/** Türkçe sayı formatı, null güvenli. */
export const fmt = (n: number | null, dec = 2): string =>
  n == null ? '—' : n.toLocaleString('tr-TR', { minimumFractionDigits: dec, maximumFractionDigits: dec })

// ── Yüzde ───────────────────────────────────────────────────────────────────
//
// NEDEN MERKEZÎ BİR YARDIMCI
// Bu yardımcı yokken herkes `toFixed(1)}%` yazdı ve ekranda üç ayrı yazım
// oluştu: Sembol sayfası "%53,6", Bugün sayfası "%53.6", fon tablosu ise
// aynı SATIRDA hem "147.5%" hem "%100". Aynı sayının iki türlü yazılması,
// okuyanda "bunlar farklı ölçüler mi?" sorusunu doğuruyor.
//
// KARARLAR
//   • İşaret en dışta: -%7,51  (+%0,72 · %53,6)
//   • Ondalık ayracı virgül; binlik ayracı nokta (tr-TR).
//   • Eksi işareti HER ZAMAN yazılır; artı yalnız istenirse.
//   • null/NaN → "—". Sıfır yazmak veri yokluğunu gizlerdi.

/**
 * Yüzde biçimi. `n` ZATEN yüzde birimindedir (53.6 → "%53,6").
 * Oran (0–1) elinizdeyse `oranYuzde` kullanın.
 */
export const yuzde = (
  n: number | null | undefined, basamak = 1, isaret = false,
): string => {
  if (n == null || !Number.isFinite(n)) return '—'
  const govde = Math.abs(n).toLocaleString('tr-TR', {
    minimumFractionDigits: basamak, maximumFractionDigits: basamak,
  })
  const on = n < 0 ? '-' : isaret ? '+' : ''
  return `${on}%${govde}`
}

/** Oranı (0–1) yüzdeye çevirip biçimler: 0.536 → "%53,6". */
export const oranYuzde = (
  n: number | null | undefined, basamak = 1, isaret = false,
): string => (n == null || !Number.isFinite(n) ? '—' : yuzde(n * 100, basamak, isaret))

/** Backend'den JSON-string olarak gelen string[]'leri güvenle parse eder. */
export const parseArr = (s: string): string[] => {
  try { return JSON.parse(s) } catch { return [] }
}

/** Tavsiye etiketinden renk paleti. */
export const recColor = (r: string): { bg: string; color: string; border: string } => {
  if (r.includes('GÜÇLÜ ALIM'))  return { bg: 'rgba(34,197,94,.15)', color: '#22c55e', border: 'rgba(34,197,94,.35)' }
  if (r.includes('ALIM'))        return { bg: 'rgba(34,197,94,.08)', color: '#86efac', border: 'rgba(34,197,94,.2)' }
  if (r.includes('GÜÇLÜ KAÇIN')) return { bg: 'rgba(239,68,68,.15)', color: '#ef4444', border: 'rgba(239,68,68,.35)' }
  if (r.includes('KAÇIN'))       return { bg: 'rgba(239,68,68,.08)', color: 'var(--loss)', border: 'rgba(239,68,68,.2)' }
  return { bg: 'rgba(148,163,184,.08)', color: '#94a3b8', border: 'rgba(148,163,184,.2)' }
}

export const biasIcon = (b: string): string =>
  b === 'YÜKSELİŞ' ? '↑' : b === 'DÜŞÜŞ' ? '↓' : '→'

export const biasColor = (b: string): string =>
  b === 'YÜKSELİŞ' ? '#22c55e' : b === 'DÜŞÜŞ' ? '#ef4444' : '#94a3b8'

/** BIST piyasa saati — Pazartesi-Cuma 10:00-18:00 Istanbul (UTC+3). */
export const isMarketOpen = (): boolean => {
  const now = new Date()
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000
  const ist = new Date(utcMs + 3 * 3_600_000)
  const day = ist.getDay()          // 0=Pazar 6=Cumartesi
  if (day === 0 || day === 6) return false
  const hm = ist.getHours() * 60 + ist.getMinutes()
  return hm >= 600 && hm < 1080    // 10:00–18:00
}

/** Belirtilen satırları CSV olarak indirir. */
export const downloadCsv = (headers: string[], rows: (string | number | null | undefined)[][], filename: string): void => {
  const escape = (v: string | number | null | undefined): string => {
    const s = v == null ? '' : String(v)
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [headers.map(escape).join(','), ...rows.map(r => r.map(escape).join(','))]
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}
