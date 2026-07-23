// =============================================================================
// SerInvest — Sol İzleme Listesi Paneli (TradingView tarzı)
// Çoklu liste, kategoriye göre katlanabilir gruplar, sembol ekle/çıkar.
// Satıra tıklayınca onSelect(symbol) → grafik drawer'ı açılır.
// =============================================================================
import { useEffect, useMemo, useRef, useState } from 'react'
import { useWatchlists } from '../../lib/watchlists'
import { COMPANY_NAMES } from '../../lib/companies'
import { CompanyLogo } from '../common/CompanyLogo'
import { Icon } from '../ui'
import { fmt } from '../../lib/format'
import type { PriceData } from '../../lib/types'

const fmtVol = (v: number | null): string => {
  if (v == null || v === 0) return '—'
  if (v >= 1e9) return `${(v / 1e9).toLocaleString('tr-TR', { maximumFractionDigits: 1 })}B`
  if (v >= 1e6) return `${(v / 1e6).toLocaleString('tr-TR', { maximumFractionDigits: 1 })}M`
  if (v >= 1e3) return `${(v / 1e3).toLocaleString('tr-TR', { maximumFractionDigits: 0 })}K`
  return v.toLocaleString('tr-TR', { maximumFractionDigits: 0 })
}

// Kategori sırası + etiketleri
const GROUPS: { type: string; label: string }[] = [
  { type: 'GLOBAL', label: 'Endeks & Küresel' },
  { type: 'BIST', label: 'Hisse Senetleri' },
  { type: 'COMMODITY', label: 'Emtialar' },
  { type: 'FOREX', label: 'Döviz' },
  { type: 'OTHER', label: 'Diğer' },
]

export function WatchlistSidebar({
  assets, onSelect, activeSymbol, onCollapse,
}: {
  assets: PriceData[]
  onSelect: (symbol: string) => void
  activeSymbol: string | null
  onCollapse: () => void
}) {
  const { lists, createList, renameList, deleteList, toggleSymbol, reorderSymbols } = useWatchlists()

  const [activeId, setActiveId] = useState<string>(() => localStorage.getItem('si_wl_active') || '')
  const [menuOpen, setMenuOpen] = useState(false)
  const [addOpen, setAddOpen]   = useState(false)
  const [addQuery, setAddQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [dragSym, setDragSym]   = useState<string | null>(null)
  const [overSym, setOverSym]   = useState<string | null>(null)
  const dragSymRef = useRef<string | null>(null)   // drop mantığı ref'ten okur (render zamanlamasından bağımsız)

  // Geçerli aktif liste garantisi
  useEffect(() => {
    if (lists.length === 0) return
    if (!lists.find(l => l.id === activeId)) {
      const id = lists[0].id
      setActiveId(id)
      localStorage.setItem('si_wl_active', id)
    }
  }, [lists, activeId])

  const setActive = (id: string) => {
    setActiveId(id)
    localStorage.setItem('si_wl_active', id)
    setMenuOpen(false)
  }

  const active = lists.find(l => l.id === activeId) || lists[0]
  const bySym = useMemo(() => new Map(assets.map(a => [a.symbol, a])), [assets])

  // Aktif listenin sembollerini kategoriye göre grupla (liste sırası korunur)
  const grouped = useMemo(() => {
    const out: Record<string, string[]> = {}
    for (const sym of active?.symbols ?? []) {
      const t = bySym.get(sym)?.assetType ?? 'OTHER'
      const key = GROUPS.some(g => g.type === t) ? t : 'OTHER'
      ;(out[key] ||= []).push(sym)
    }
    return out
  }, [active, bySym])

  const toggleGroup = (t: string) =>
    setCollapsed(prev => { const n = new Set(prev); n.has(t) ? n.delete(t) : n.add(t); return n })

  // Sembol ekleme adayları
  const addCandidates = useMemo(() => {
    const inList = new Set(active?.symbols ?? [])
    const q = addQuery.trim().toLowerCase()
    return assets
      .filter(a => !inList.has(a.symbol))
      .filter(a => !q || a.symbol.toLowerCase().includes(q) || (COMPANY_NAMES[a.symbol] || '').toLowerCase().includes(q))
      .slice(0, 40)
  }, [assets, active, addQuery])

  const newList = () => {
    const name = prompt('Yeni liste adı:')?.trim()
    if (name) setActive(createList(name))
  }
  const rename = () => {
    if (!active) return
    const name = prompt('Liste adını değiştir:', active.name)?.trim()
    if (name) renameList(active.id, name)
    setMenuOpen(false)
  }
  const remove = () => {
    if (!active) return
    if (lists.length <= 1) { alert('Son liste silinemez.'); return }
    if (confirm(`"${active.name}" listesi silinsin mi?`)) {
      deleteList(active.id)
      setMenuOpen(false)
    }
  }

  const Row = ({ sym }: { sym: string }) => {
    const a = bySym.get(sym)
    const change = a?.close != null && a?.open != null ? a.close - a.open : null
    const chgPct = change != null && a?.open ? (change / a.open) * 100 : null
    const dec = a?.assetType === 'FOREX' ? 4 : a?.assetType === 'GLOBAL' ? 0 : 2
    const col = chgPct == null ? 'var(--text-muted)' : chgPct >= 0 ? 'var(--profit)' : 'var(--loss)'
    const wrapCls = `wl-row-wrap${activeSymbol === sym ? ' active' : ''}${dragSym === sym ? ' dragging' : ''}${overSym === sym && dragSym !== sym ? ' drop-target' : ''}`
    return (
      <div
        className={wrapCls}
        draggable
        onDragStart={e => { dragSymRef.current = sym; setDragSym(sym); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', sym) }}
        onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (sym !== dragSymRef.current) setOverSym(sym) }}
        onDragLeave={() => setOverSym(prev => (prev === sym ? null : prev))}
        onDrop={e => { e.preventDefault(); const from = dragSymRef.current; if (from && from !== sym && active) reorderSymbols(active.id, from, sym); dragSymRef.current = null; setDragSym(null); setOverSym(null) }}
        onDragEnd={() => { dragSymRef.current = null; setDragSym(null); setOverSym(null) }}
      >
        <span className="wl-grip" title="Sürükle" aria-hidden>⠿</span>
        <button
          className={`wl-row${activeSymbol === sym ? ' active' : ''}`}
          onClick={() => onSelect(sym)}
          title={COMPANY_NAMES[sym] || sym}
        >
          <CompanyLogo symbol={sym} size={20} />
          <div style={{ minWidth: 0 }}>
            <div className="sym">{sym}</div>
            <div className="vol">{fmtVol(a?.volume ?? null)}</div>
          </div>
          <div className="right">
            <div className="px">{fmt(a?.close ?? null, dec)}</div>
            <div className="chg" style={{ color: col }}>
              {chgPct == null ? '—' : `${chgPct >= 0 ? '+' : ''}${chgPct.toFixed(2)}%`}
            </div>
          </div>
        </button>
        <button className="rm-btn" title="Listeden çıkar"
          onClick={e => { e.stopPropagation(); toggleSymbol(active!.id, sym) }}>×</button>
      </div>
    )
  }

  return (
    <aside className="wl-sidebar">
      {/* Başlık */}
      <div className="wl-head" style={{ position: 'relative' }}>
        <button className="title-btn" onClick={() => setMenuOpen(o => !o)}>
          <Icon name="list" size={14} /> {active?.name ?? 'İzleme Listesi'}
          <Icon name="chevron-down" size={11} style={{ color: 'var(--text-muted)' }} />
        </button>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
          <button className="ico-btn" title="Sembol ekle" onClick={() => setAddOpen(o => !o)}><Icon name="plus" size={15} /></button>
          <button className="ico-btn" title="Paneli gizle" onClick={onCollapse}><Icon name="chevron-right" size={15} style={{ transform: 'rotate(180deg)' }} /></button>
        </div>

        {menuOpen && (
          <>
            <div onClick={() => setMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
            <div className="wl-menu">
              {lists.map(l => (
                <button key={l.id} className={`wl-menu-item${l.id === activeId ? ' on' : ''}`} onClick={() => setActive(l.id)}>
                  <Icon name="list" size={14} /> {l.name}
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-disabled)' }}>{l.symbols.length}</span>
                </button>
              ))}
              <div className="wl-menu-sep" />
              <button className="wl-menu-item" onClick={newList}><Icon name="plus" size={14} /> Yeni liste</button>
              <button className="wl-menu-item" onClick={rename}>Yeniden adlandır</button>
              <button className="wl-menu-item" onClick={remove} style={{ color: 'var(--loss)' }}>Listeyi sil</button>
            </div>
          </>
        )}
      </div>

      {/* Sembol ekleme kutusu */}
      {addOpen && (
        <div className="wl-add-box">
          <input autoFocus placeholder="Sembol veya şirket ara… (ekle)"
            value={addQuery} onChange={e => setAddQuery(e.target.value)}
            onKeyDown={e => e.key === 'Escape' && setAddOpen(false)} />
          <div className="wl-add-results">
            {addCandidates.length === 0 ? (
              <div style={{ padding: 8, color: 'var(--text-muted)', fontSize: 11 }}>Sonuç yok</div>
            ) : addCandidates.map(a => (
              <button key={a.symbol} className="wl-add-item"
                onClick={() => { toggleSymbol(active!.id, a.symbol); setAddQuery('') }}>
                <CompanyLogo symbol={a.symbol} size={18} />
                <span className="t">{a.symbol}</span>
                <span className="n">{COMPANY_NAMES[a.symbol] || a.assetType}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Kolon başlığı */}
      <div className="wl-colhead"><span>Sembol</span><span>Son · Değ%</span></div>

      {/* Gövde: gruplanmış semboller */}
      <div className="wl-body">
        {(active?.symbols.length ?? 0) === 0 ? (
          <div className="wl-empty">
            Liste boş.<br />Üstteki <b>＋</b> ile sembol ekle.
          </div>
        ) : GROUPS.map(g => {
          const syms = grouped[g.type]
          if (!syms || syms.length === 0) return null
          const isCol = collapsed.has(g.type)
          return (
            <div key={g.type}>
              <div className="wl-group-head" onClick={() => toggleGroup(g.type)}>
                <span className="chev">{isCol ? '▶' : '▼'}</span>
                {g.label}
                <span className="cnt">{syms.length}</span>
              </div>
              {!isCol && syms.map(sym => <Row key={sym} sym={sym} />)}
            </div>
          )
        })}
      </div>
    </aside>
  )
}
