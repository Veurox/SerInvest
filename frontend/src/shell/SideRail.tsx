// =============================================================================
// SerInvest — Sol Araç Şeridi (42px, yalnız ikon)
// Faz 1: navigasyon + panel kontrolü. Çizim araçları Faz 5'te işlevsel olur;
// şu an devre dışı görünürler (ULTRAPLAN §3.2 — şeridin varlığı bile
// "profesyonel araç" algısını taşır, ama çalışmıyorsa bunu SAKLAMAYIZ).
// =============================================================================
import { useLocation, useNavigate } from 'react-router-dom'
import { Icon } from '../components/ui'
import type { IconName } from '../components/ui'
import { WORKSPACES, workspaceForPath } from './workspaces'

interface Props {
  dockOpen: boolean
  onToggleDock: () => void
  onOpenPalette: () => void
}

const DRAW_TOOLS: { icon: IconName; label: string }[] = [
  { icon: 'trending-up',   label: 'Trend çizgisi' },
  { icon: 'target',        label: 'Yatay çizgi' },
  { icon: 'search',        label: 'Ölçüm' },
]

export function SideRail({ dockOpen, onToggleDock, onOpenPalette }: Props) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const active = workspaceForPath(pathname)

  return (
    <nav className="rail" aria-label="Araç şeridi">
      {WORKSPACES.map(w => (
        <button key={w.id}
          className={`rail__btn${w.id === active.id ? ' is-active' : ''}`}
          title={w.label}
          aria-label={w.label}
          onClick={() => navigate(w.home)}>
          <Icon name={w.icon} size={16} />
        </button>
      ))}

      <div className="rail__sep" />

      {/* Çizim araçları — Faz 5'e kadar devre dışı (dürüstlük: gizlemiyoruz) */}
      {DRAW_TOOLS.map(t => (
        <button key={t.label} className="rail__btn" disabled
                title={`${t.label} — yakında`} aria-label={`${t.label} (yakında)`}>
          <Icon name={t.icon} size={16} />
        </button>
      ))}

      <div className="rail__sep" />

      <button className="rail__btn" onClick={onOpenPalette}
              title="Komut paleti (Ctrl+P)" aria-label="Komut paleti">
        <Icon name="search" size={16} />
      </button>

      {/* Alt: sağ paneli aç/kapat */}
      <button className={`rail__btn${dockOpen ? ' is-active' : ''}`}
              style={{ marginTop: 'auto' }}
              onClick={onToggleDock}
              title={dockOpen ? 'Sağ paneli gizle' : 'Sağ paneli göster'}
              aria-label="Sağ panel">
        <Icon name="list" size={16} />
      </button>
    </nav>
  )
}
