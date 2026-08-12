// =============================================================================
// SerInvest — Çoklu Grafik: sembol seçici
// Hücre başlığındaki sembole tıklayınca açılan arama kutusu.
// Klavye: yaz→filtrele, Enter→ilk sonuç, Esc→kapat. Dışarı tıklama kapatır.
// =============================================================================
import { useEffect, useMemo, useRef, useState } from 'react'
import type { PriceData } from '../../lib/types'
import { COMPANY_NAMES } from '../../lib/companies'

interface Props {
  assets: PriceData[]
  onPick: (symbol: string) => void
  onClose: () => void
}

const px = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function SymbolPicker({ assets, onPick, onClose }: Props) {
  const [q, setQ] = useState('')
  const boxRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  // Dışarı tıklama + Esc ile kapan
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const list = useMemo(() => {
    const needle = q.trim().toLocaleUpperCase('tr-TR')
    const rows = assets.filter(a => {
      if (!needle) return true
      const name = (COMPANY_NAMES[a.symbol] ?? '').toLocaleUpperCase('tr-TR')
      return a.symbol.toLocaleUpperCase('tr-TR').includes(needle) || name.includes(needle)
    })
    // BIST önce, sonra alfabetik — aradığı hisse listenin dibinde kalmasın
    return rows
      .sort((a, b) => (a.assetType === b.assetType ? a.symbol.localeCompare(b.symbol, 'tr')
                                                   : a.assetType === 'BIST' ? -1 : 1))
      .slice(0, 120)
  }, [assets, q])

  return (
    <div className="mc-picker" ref={boxRef} onMouseDown={e => e.stopPropagation()}>
      <input
        ref={inputRef}
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder="Sembol veya şirket ara…"
        onKeyDown={e => {
          if (e.key === 'Enter' && list[0]) onPick(list[0].symbol)
        }}
      />
      <div className="mc-picker__list">
        {list.length === 0 && <div className="mc-picker__empty">Sonuç yok</div>}
        {list.map(a => (
          <button key={a.symbol} className="mc-picker__row" onClick={() => onPick(a.symbol)}>
            <b>{a.symbol}</b>
            {COMPANY_NAMES[a.symbol] && (
              <em style={{ fontStyle: 'normal', color: 'var(--text-muted)', fontSize: 10.5,
                           overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {COMPANY_NAMES[a.symbol]}
              </em>
            )}
            <span>{a.close != null ? px.format(a.close) : '—'}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
