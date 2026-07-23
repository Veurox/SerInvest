import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

/**
 * Command Palette — VS Code / Linear / Raycast tarzı
 * Cmd/Ctrl+P ile açılır, fuzzy search ile aksiyon başlatılır.
 */
export interface Command {
  id: string
  label: string
  hint?: string         // sağda gösterilen alt bilgi (kısayol vs.)
  group?: string        // grouplama (örn. "Navigasyon", "Sistem")
  icon?: ReactNode
  action: () => void
  keywords?: string[]   // arama için ek kelimeler
}

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  commands: Command[]
}

function fuzzyMatch(text: string, query: string): boolean {
  if (!query) return true
  const t = text.toLowerCase()
  const q = query.toLowerCase()
  let qi = 0
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++
  }
  return qi === q.length
}

export function CommandPalette({ open, onClose, commands }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // Açılınca input'a focus
  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIdx(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  // Filter
  const filtered = commands.filter(c => {
    const haystack = [c.label, c.hint, c.group, ...(c.keywords ?? [])].filter(Boolean).join(' ')
    return fuzzyMatch(haystack, query)
  })

  // Group'lara böl
  const grouped = new Map<string, Command[]>()
  for (const c of filtered) {
    const g = c.group ?? 'Genel'
    if (!grouped.has(g)) grouped.set(g, [])
    grouped.get(g)!.push(c)
  }
  const flatList = [...grouped.values()].flat()

  // Klavye navigasyonu
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
      else if (e.key === 'ArrowDown') {
        e.preventDefault(); setActiveIdx(i => Math.min(i + 1, flatList.length - 1))
      }
      else if (e.key === 'ArrowUp') {
        e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0))
      }
      else if (e.key === 'Enter') {
        e.preventDefault()
        const cmd = flatList[activeIdx]
        if (cmd) { cmd.action(); onClose() }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, flatList, activeIdx, onClose])

  if (!open) return null

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'var(--bg-overlay)',
      backdropFilter: 'blur(8px)', zIndex: 2000,
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      paddingTop: '15vh',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-strong)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-xl)',
        width: '90%', maxWidth: '600px',
        overflow: 'hidden',
        animation: 'fade-in 150ms ease-out',
      }}>
        {/* Search input */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
          padding: 'var(--space-3) var(--space-4)',
          borderBottom: '1px solid var(--border-default)',
        }}>
          <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-md)' }}>⌘</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value); setActiveIdx(0) }}
            placeholder="Komut ara veya aksiyon başlat..."
            style={{
              flex: 1,
              background: 'transparent', border: 'none', outline: 'none',
              fontSize: 'var(--text-base)', color: 'var(--text-primary)',
            }}
          />
          <span style={{
            fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
            background: 'var(--bg-surface-2)', padding: '2px 6px', borderRadius: 'var(--radius-xs)',
            border: '1px solid var(--border-default)',
          }}>ESC</span>
        </div>

        {/* Command list */}
        <div style={{ maxHeight: '400px', overflowY: 'auto', padding: 'var(--space-2) 0' }}>
          {flatList.length === 0 && (
            <div style={{ padding: 'var(--space-5)', textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
              Sonuç bulunamadı
            </div>
          )}

          {[...grouped.entries()].map(([group, cmds]) => (
            <div key={group}>
              <div style={{
                fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
                textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 'var(--fw-bold)',
                padding: 'var(--space-2) var(--space-4)',
              }}>{group}</div>
              {cmds.map(cmd => {
                const idx = flatList.indexOf(cmd)
                const isActive = idx === activeIdx
                return (
                  <div key={cmd.id}
                    onMouseEnter={() => setActiveIdx(idx)}
                    onClick={() => { cmd.action(); onClose() }}
                    style={{
                      padding: 'var(--space-2) var(--space-4)',
                      display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                      cursor: 'pointer',
                      background: isActive ? 'var(--bg-surface-2)' : 'transparent',
                      borderLeft: isActive ? '3px solid var(--accent)' : '3px solid transparent',
                    }}>
                    {cmd.icon && <span style={{ fontSize: 'var(--text-md)', width: '20px' }}>{cmd.icon}</span>}
                    <span style={{ flex: 1, fontSize: 'var(--text-sm)', fontWeight: isActive ? 'var(--fw-bold)' : 'var(--fw-medium)', color: 'var(--text-primary)' }}>
                      {cmd.label}
                    </span>
                    {cmd.hint && (
                      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                        {cmd.hint}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>

        {/* Footer help */}
        <div style={{
          padding: 'var(--space-2) var(--space-4)',
          borderTop: '1px solid var(--border-default)',
          fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
          display: 'flex', gap: 'var(--space-3)',
          background: 'var(--bg-surface-2)',
        }}>
          <span>↑↓ gez</span>
          <span>↵ çalıştır</span>
          <span>ESC kapat</span>
        </div>
      </div>
    </div>
  )
}
