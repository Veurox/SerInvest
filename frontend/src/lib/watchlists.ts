// =============================================================================
// SerInvest — İzleme Listesi Hook'u
// localStorage tabanlı, çoklu liste destekli.
// =============================================================================
import { useState } from 'react'

export interface Watchlist {
  id: string
  name: string
  symbols: string[]
}

export function useWatchlists() {
  const [lists, setLists] = useState<Watchlist[]>(() => {
    try {
      const raw = localStorage.getItem('si_watchlists')
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed) && parsed.length > 0) return parsed
      }
    } catch { /* ignore */ }
    // İlk açılış: dolu bir varsayılan izleme listesi tohumla
    const seed: Watchlist[] = [{
      id: 'default', name: 'İzleme Listem',
      symbols: ['THYAO', 'GARAN', 'ASELS', 'TUPRS', 'EREGL',
                'KCHOL', 'SAHOL', 'BIMAS', 'SISE', 'XAUUSD', 'USDTRY'],
    }]
    try { localStorage.setItem('si_watchlists', JSON.stringify(seed)) } catch { /* ignore */ }
    return seed
  })
  const save = (updated: Watchlist[]) => {
    setLists(updated)
    localStorage.setItem('si_watchlists', JSON.stringify(updated))
  }
  const createList = (name: string): string => {
    const id = Date.now().toString()
    save([...lists, { id, name, symbols: [] }])
    return id
  }
  const renameList = (id: string, name: string) =>
    save(lists.map(l => (l.id === id ? { ...l, name } : l)))
  const deleteList = (id: string) => save(lists.filter(l => l.id !== id))
  const toggleSymbol = (listId: string, symbol: string) =>
    save(lists.map(l => l.id !== listId ? l : {
      ...l,
      symbols: l.symbols.includes(symbol)
        ? l.symbols.filter(s => s !== symbol)
        : [...l.symbols, symbol],
    }))
  const isInList = (listId: string, symbol: string) =>
    !!lists.find(l => l.id === listId)?.symbols.includes(symbol)
  // fromSym'i listeden çıkarıp toSym'in bulunduğu konuma taşır (sürükle-bırak)
  const reorderSymbols = (listId: string, fromSym: string, toSym: string) =>
    save(lists.map(l => {
      if (l.id !== listId) return l
      const syms = [...l.symbols]
      const from = syms.indexOf(fromSym)
      const to = syms.indexOf(toSym)
      if (from === -1 || to === -1 || from === to) return l
      syms.splice(from, 1)
      syms.splice(to, 0, fromSym)
      return { ...l, symbols: syms }
    }))
  return { lists, createList, renameList, deleteList, toggleSymbol, isInList, reorderSymbols }
}
