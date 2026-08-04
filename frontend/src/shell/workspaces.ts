// =============================================================================
// SerInvest — Çalışma Alanı Haritası
// docs/UI_ULTRAPLAN.md §2: 11 sayfa → 4 çalışma alanı.
//
// Faz 1'de içerikler HENÜZ BİRLEŞMEDİ (o Faz 4). Bu yüzden her çalışma alanı
// birincil bir rotaya, altındaki bölümler de mevcut sayfalara işaret eder —
// böylece yapı bugünden kurulur ama hiçbir sayfaya erişim kaybolmaz.
// =============================================================================
import type { IconName } from '../components/ui'

export interface WorkspaceSection {
  to: string
  label: string
  end?: boolean
  badgeKey?: 'oracle' | 'news' | 'fundamentals'
}

export interface Workspace {
  id: string
  label: string
  icon: IconName
  /** Sekmeye tıklanınca gidilecek rota */
  home: string
  /** Bu alana ait bölümler (ikincil sekmeler) */
  sections: WorkspaceSection[]
}

export const WORKSPACES: Workspace[] = [
  {
    id: 'chart', label: 'Grafik', icon: 'overview', home: '/terminal',
    sections: [
      { to: '/terminal',      label: 'Terminal' },
      { to: '/',              label: 'Piyasa Genel', end: true },
      { to: '/degerlendirme', label: 'Sembol İncele' },
      { to: '/news',          label: 'Haberler', badgeKey: 'news' },
    ],
  },
  {
    id: 'screener', label: 'Tarayıcı', icon: 'target', home: '/oracle',
    sections: [
      { to: '/oracle',      label: 'AI Tavsiye', badgeKey: 'oracle' },
      { to: '/dip-radar',   label: 'Dip Radarı' },
      { to: '/fundamental', label: 'Temel Analiz', badgeKey: 'fundamentals' },
    ],
  },
  {
    id: 'portfolio', label: 'Portföy', icon: 'briefcase', home: '/portfolio',
    sections: [
      { to: '/portfolio',     label: 'Portföyüm' },
      { to: '/model-portfoy', label: 'Model Portföyü' },
    ],
  },
  {
    id: 'model', label: 'Model', icon: 'mlops', home: '/model',
    sections: [
      { to: '/model',   label: 'Durum & Künye' },
      { to: '/history', label: 'Tahmin Geçmişi' },
    ],
  },
]

/** Bir rota hangi çalışma alanına ait? (bilinmiyorsa ilk alan) */
export function workspaceForPath(pathname: string): Workspace {
  const exact = WORKSPACES.find(w => w.sections.some(s => s.to === pathname))
  if (exact) return exact
  // Eski/bilinmeyen rotalar (ör. /radar, /mlops, /admin) → Grafik alanı
  return WORKSPACES[0]
}
