// =============================================================================
// SerInvest — Haber sınıflandırma ve duyarlılık sunumu (saf)
//
// Bileşenden AYRI duruyor: NewsFeed.tsx bunları dışa açınca fast-refresh
// bozuluyordu (bir dosya ya bileşen ya yardımcı dışa açar). Ayrıca bu iki
// kural sunumdan bağımsız — sayfa da, Bugün bandı da aynı sınıflandırmayı
// kullanabilsin.
// =============================================================================
import type { NewsSignal } from './types'

export type HaberKategori = 'TÜM' | 'BIST' | 'EMTİA' | 'KÜRESEL' | 'MAKRO'

export const HABER_KATEGORILERI: { key: HaberKategori; label: string }[] = [
  { key: 'TÜM',     label: 'Tümü' },
  { key: 'BIST',    label: 'BIST' },
  { key: 'EMTİA',   label: 'Emtia' },
  { key: 'KÜRESEL', label: 'Küresel' },
  { key: 'MAKRO',   label: 'Makro' },
]

/**
 * Küresel sayılan varlık adları. Liste AÇIK yazılı: "küresel" tanımı
 * kaynağın kendisinden gelmiyor, biz koyuyoruz — hangi adların bu kümede
 * olduğu görünür olsun.
 */
const KURESEL = new Set([
  'NASDAQ', 'SP500', 'DJI', 'GLOBAL', 'GLOBAL MARKET', 'MACRO_GLOBAL',
  'BIST100', 'DAX', 'MSCI_EM',
])

export function haberKategorisi(item: NewsSignal): HaberKategori {
  if (item.assetType === 'BIST') return 'BIST'
  if (item.assetType === 'COMMODITY') return 'EMTİA'
  if (KURESEL.has((item.entity ?? '').toUpperCase())) return 'KÜRESEL'
  return 'MAKRO'   // MACRO + GENERAL + FOREX + diğerleri
}

export interface DuyarlilikBilgi {
  renk: string
  zemin: string
  isaret: string
  ad: string
}

/** Duyarlılık etiketinin ekran karşılığı — renkler JETON, sabit hex değil. */
export function duyarlilikBilgi(etiket: string): DuyarlilikBilgi {
  if (etiket === 'BULLISH') {
    return { renk: 'var(--u-up)', zemin: 'var(--u-up-bg)', isaret: '▲', ad: 'Yükseliş' }
  }
  if (etiket === 'BEARISH') {
    return { renk: 'var(--u-down)', zemin: 'var(--u-down-bg)', isaret: '▼', ad: 'Düşüş' }
  }
  return { renk: 'var(--u-flat)', zemin: 'var(--viz-track)', isaret: '●', ad: 'Nötr' }
}

/** "3 sa önce" · bir günden eskiyse tarih. */
export function gecenSure(createdAt: string): string {
  const ts = new Date(createdAt.endsWith('Z') ? createdAt : createdAt + 'Z')
  const dk = Math.floor((Date.now() - ts.getTime()) / 60000)
  if (dk < 1) return 'şimdi'
  if (dk < 60) return `${dk} dk önce`
  if (dk < 1440) return `${Math.floor(dk / 60)} sa önce`
  return ts.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' })
}
