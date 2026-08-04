// =============================================================================
// SerInvest — Sağ Panel Yığını (RightDock)
// Sürüklenerek genişliği ayarlanır, genişlik localStorage'da kalır.
// Widget'lar katlanabilir; katlanma durumu da saklanır.
//
// Faz 1: çerçeve + İzleme Listesi + Detaylar.
// Faz 2: ML Modeli ve Haberler widget'ları eklenecek.
// =============================================================================
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

const W_KEY = 'si_dock_w'
const MIN_W = 240
const MAX_W = 520
const DEFAULT_W = 320

// ── Katlanır widget ──────────────────────────────────────────────────────────
export function DockWidget({ id, title, right, flush, children, defaultOpen = true }: {
  id: string
  title: string
  right?: ReactNode
  flush?: boolean
  children: ReactNode
  defaultOpen?: boolean
}) {
  const key = `si_dockw_${id}`
  const [open, setOpen] = useState<boolean>(() => {
    const v = localStorage.getItem(key)
    return v === null ? defaultOpen : v === '1'
  })
  const toggle = () => setOpen(o => { localStorage.setItem(key, o ? '0' : '1'); return !o })

  return (
    <section className="dockw">
      <button className="dockw__head" onClick={toggle} aria-expanded={open}>
        <span className={`dockw__caret${open ? ' is-open' : ''}`}>▸</span>
        {title}
        {right && <span style={{ marginLeft: 'auto', textTransform: 'none', letterSpacing: 0 }}>{right}</span>}
      </button>
      {open && <div className={`dockw__body${flush ? ' dockw__body--flush' : ''}`}>{children}</div>}
    </section>
  )
}

// ── Panel gövdesi ────────────────────────────────────────────────────────────
export function RightDock({ children }: { children: ReactNode }) {
  const [w, setW] = useState<number>(() => {
    const v = Number(localStorage.getItem(W_KEY))
    return Number.isFinite(v) && v >= MIN_W && v <= MAX_W ? v : DEFAULT_W
  })
  const [dragging, setDragging] = useState(false)
  const startX = useRef(0)
  const startW = useRef(0)

  const onDown = (e: React.MouseEvent) => {
    e.preventDefault()
    startX.current = e.clientX
    startW.current = w
    setDragging(true)
  }

  const onMove = useCallback((e: MouseEvent) => {
    // Panel SAĞDA: imleç sola giderse panel genişler → delta ters
    const next = Math.min(MAX_W, Math.max(MIN_W, startW.current + (startX.current - e.clientX)))
    setW(next)
  }, [])

  const onUp = useCallback(() => {
    setDragging(false)
    setW(cur => { localStorage.setItem(W_KEY, String(cur)); return cur })
  }, [])

  useEffect(() => {
    if (!dragging) return
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    // Sürükleme sırasında metin seçimi ve imleç titremesi olmasın
    const prev = document.body.style.cursor
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = prev
      document.body.style.userSelect = ''
    }
  }, [dragging, onMove, onUp])

  return (
    <>
      <div className={`dock__resizer${dragging ? ' is-dragging' : ''}`}
           onMouseDown={onDown} role="separator" aria-orientation="vertical"
           aria-label="Sağ panel genişliği" />
      <aside className="dock" style={{ width: w }} aria-label="Yan panel">
        {children}
      </aside>
    </>
  )
}
