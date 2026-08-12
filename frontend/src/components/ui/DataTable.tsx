// =============================================================================
// SerInvest — Yoğun Veri Tablosu
// docs/PLAN_2026-08.md Faz D4. Faz F'deki tarayıcı birleşimi buna dayanacak.
//
// Tasarım ilkeleri (kurumsal terminal):
//   • Satır yüksekliği düşük — ekranda çok satır görünsün
//   • Sayısal kolonlar SAĞA hizalı ve tabular rakam → basamaklar alt alta gelir,
//     göz büyüklük farkını okumadan görür
//   • Yapışkan başlık — uzun listede hangi kolona baktığın kaybolmasın
//   • Kolon başlığına tıkla → sırala; ikinci tık yön çevirir
//   • Yatay taşma TABLONUN KENDİ kabında kalır, sayfayı kaydırmaz
//
// Öncelik (priority) ile dar ekranda kolon gizleme: 1 = her zaman görünür,
// 2 = 1200px altında gizlenir, 3 = 900px altında gizlenir. Sabit eşikler CSS'te;
// keyfi piksel değerleri statik CSS'te ifade edilemediği için bilinçli sadeleştirme.
// =============================================================================
import { useMemo, useState } from 'react'

export interface Column<T> {
  key: string
  header: string
  /** Sağa hizalı, tabular rakam. Fiyat/yüzde/adet için. */
  numeric?: boolean
  /** Sabit genişlik (px veya CSS değeri). Verilmezse içeriğe göre. */
  width?: number | string
  /** Sıralanabilir yapmak için karşılaştırma değeri döndür. */
  sortValue?: (row: T) => number | string | null | undefined
  render: (row: T) => React.ReactNode
  /** Başlık üstüne gelince açıklama. */
  title?: string
  /** 1 = her zaman · 2 = <1200px gizle · 3 = <900px gizle */
  priority?: 1 | 2 | 3
}

interface Props<T> {
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string
  onRowClick?: (row: T) => void
  /** Seçili satır anahtarı — vurgulanır. */
  activeKey?: string | null
  defaultSort?: { key: string; dir: 'asc' | 'desc' }
  empty?: React.ReactNode
  /** Kaydırılabilir gövde yüksekliği. Verilmezse tablo tam boy uzar. */
  maxHeight?: number | string
}

type Dir = 'asc' | 'desc'

export function DataTable<T>({
  rows, columns, rowKey, onRowClick, activeKey,
  defaultSort, empty = 'Kayıt yok', maxHeight,
}: Props<T>) {
  const [sortKey, setSortKey] = useState<string | null>(defaultSort?.key ?? null)
  const [dir, setDir] = useState<Dir>(defaultSort?.dir ?? 'desc')

  const sorted = useMemo(() => {
    const col = columns.find(c => c.key === sortKey)
    if (!col?.sortValue) return rows
    const mul = dir === 'asc' ? 1 : -1
    // Boş değerler yönden BAĞIMSIZ olarak en sona düşer; aksi hâlde artan
    // sıralamada liste boşlarla başlar ve tablo kullanılamaz görünür.
    return [...rows].sort((a, b) => {
      const va = col.sortValue!(a)
      const vb = col.sortValue!(b)
      const na = va == null || va === ''
      const nb = vb == null || vb === ''
      if (na && nb) return 0
      if (na) return 1
      if (nb) return -1
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * mul
      return String(va).localeCompare(String(vb), 'tr') * mul
    })
  }, [rows, columns, sortKey, dir])

  const toggle = (col: Column<T>) => {
    if (!col.sortValue) return
    if (sortKey === col.key) setDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(col.key); setDir(col.numeric ? 'desc' : 'asc') }
  }

  return (
    <div className="dt-wrap" style={maxHeight ? { maxHeight, overflowY: 'auto' } : undefined}>
      <table className="dt">
        <colgroup>
          {columns.map(c => (
            <col key={c.key} style={c.width ? { width: typeof c.width === 'number' ? `${c.width}px` : c.width } : undefined} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columns.map(c => {
              const active = sortKey === c.key
              return (
                <th key={c.key} title={c.title}
                    data-numeric={c.numeric ? 'true' : undefined}
                    data-priority={c.priority ?? 1}
                    aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}
                    className={c.sortValue ? 'dt-sortable' : undefined}
                    onClick={() => toggle(c)}>
                  {c.header}
                  {c.sortValue && (
                    <span className={`dt-caret${active ? ' dt-caret--on' : ''}`}>
                      {active ? (dir === 'asc' ? '▲' : '▼') : '▾'}
                    </span>
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && (
            <tr><td className="dt-empty" colSpan={columns.length}>{empty}</td></tr>
          )}
          {sorted.map(row => {
            const k = rowKey(row)
            return (
              <tr key={k}
                  className={`${onRowClick ? 'dt-click' : ''}${activeKey === k ? ' dt-row--active' : ''}`}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  onKeyDown={onRowClick ? e => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRowClick(row) }
                  } : undefined}>
                {columns.map(c => (
                  <td key={c.key}
                      data-numeric={c.numeric ? 'true' : undefined}
                      data-priority={c.priority ?? 1}>
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
