// =============================================================================
// SerInvest — Çalışma Alanı Sekmeleri (iki katmanlı)
//   Üst katman : 4 çalışma alanı (Grafik · Tarayıcı · Portföy · Model)
//   Alt katman : o alana ait bölümler — içerikler birleşene dek (Faz 4) erişim
//                kaybolmasın diye.
// =============================================================================
import { useLocation, useNavigate } from 'react-router-dom'
import { Icon } from '../components/ui'
import { WORKSPACES, workspaceForPath } from './workspaces'

interface Props {
  badges?: { oracle?: number; news?: number; fundamentals?: number }
}

export function WorkspaceTabs({ badges }: Props) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const active = workspaceForPath(pathname)

  return (
    <>
      <nav className="ws-tabs" aria-label="Çalışma alanları">
        {WORKSPACES.map(w => (
          <button key={w.id}
            className={`ws-tab${w.id === active.id ? ' is-active' : ''}`}
            onClick={() => navigate(w.home)}
            aria-current={w.id === active.id ? 'page' : undefined}>
            <Icon name={w.icon} size={15} />
            {w.label}
          </button>
        ))}
      </nav>

      {active.sections.length > 1 && (
        <div className="ws-subtabs" aria-label={`${active.label} bölümleri`}>
          {active.sections.map(s => {
            const on = s.end ? pathname === s.to : pathname === s.to
            const n = s.badgeKey ? badges?.[s.badgeKey] : undefined
            return (
              <button key={s.to}
                className={`ws-subtab${on ? ' is-active' : ''}`}
                onClick={() => navigate(s.to)}>
                {s.label}{n ? ` (${n})` : ''}
              </button>
            )
          })}
        </div>
      )}
    </>
  )
}
