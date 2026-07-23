// =============================================================================
// SerInvest — Format / görüntüleme yardımcıları
// =============================================================================

/** Türkçe sayı formatı, null güvenli. */
export const fmt = (n: number | null, dec = 2): string =>
  n == null ? '—' : n.toLocaleString('tr-TR', { minimumFractionDigits: dec, maximumFractionDigits: dec })

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
