// =============================================================================
// SerInvest — Gezinme Çubuğu (TEK satır, keskin — 17.08.2026 yeniden tasarım)
//
// Eskiden ÜÇ katman vardı: sol ikon şeridi (üst sekmelerin birebir kopyası +
// 3 devre dışı çizim aracı), birincil sekme satırı ve yuvarlak hap alt menü.
// Kopya şerit kaldırıldı, iki satır teke indi, hap/dolgu yok — aktiflik 2px
// alt çizgi. Şeridin işlevsel iki düğmesi (palet, sağ panel) satırın sağına
// taşındı. Çizim araçları gerçek olduğunda (Faz 5) grafiğin üstünde YEREL
// araç çubuğu olarak gelir — boş vaat olarak kabukta durmaz.
// =============================================================================
import { useLocation, useNavigate } from 'react-router-dom'
import { Icon } from '../components/ui'
import { WORKSPACES, workspaceForPath } from './workspaces'
import type { WorkspaceSection } from './workspaces'

interface Props {
  badges?: { oracle?: number; news?: number; fundamentals?: number }
  dockOpen: boolean
  onToggleDock: () => void
  onOpenPalette: () => void
}

export function WorkspaceTabs({ badges, dockOpen, onToggleDock, onOpenPalette }: Props) {
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const active = workspaceForPath(pathname)

  // Bölüm aktifliği: sorgulu rotalar (/tarayici?g=dip) TAM adresle karşılaştırılır.
  // Eski kod yalnız pathname'e bakıyordu — sorgulu bölümler hiç aktif olmuyor,
  // üstelik s.end dalı iki kolda da aynı ifadeyi içeriyordu (ölü koşul).
  // Sorgusuz bölüm, sorgulu kardeşi aktifken yanmamalı: /tarayici?g=dip
  // açıkken "AI Tavsiye" (/tarayici) sönük kalmalı.
  const here = pathname + search
  const isOn = (s: WorkspaceSection): boolean => {
    if (s.to.includes('?')) return here === s.to
    if (pathname !== s.to) return false
    return !active.sections.some(x => x.to.includes('?') && here === x.to)
  }

  return (
    <nav className="ws-bar" aria-label="Gezinme">
      {WORKSPACES.map(w => (
        <button key={w.id}
          className={`ws-tab${w.id === active.id ? ' is-active' : ''}`}
          onClick={() => navigate(w.home)}
          aria-current={w.id === active.id ? 'page' : undefined}>
          <Icon name={w.icon} size={14} />
          {w.label}
        </button>
      ))}

      {active.sections.length > 1 && (
        <>
          <span className="ws-bar__sep" aria-hidden />
          {active.sections.map(s => {
            const on = isOn(s)
            const n = s.badgeKey ? badges?.[s.badgeKey] : undefined
            return (
              <button key={s.to}
                className={`ws-sec${on ? ' is-active' : ''}`}
                aria-current={on ? 'page' : undefined}
                onClick={() => navigate(s.to)}>
                {s.label}
                {n ? <span className="ws-sec__n">{n}</span> : null}
              </button>
            )
          })}
        </>
      )}

      <span className="ws-bar__spacer" />
      <button className="ws-tool" onClick={onOpenPalette}
              title="Komut paleti (Ctrl+P)" aria-label="Komut paleti">
        <Icon name="search" size={15} />
      </button>
      <button className={`ws-tool${dockOpen ? ' is-active' : ''}`}
              onClick={onToggleDock}
              title={dockOpen ? 'Sağ paneli gizle' : 'Sağ paneli göster'}
              aria-label="Sağ panel">
        <Icon name="list" size={15} />
      </button>
    </nav>
  )
}
