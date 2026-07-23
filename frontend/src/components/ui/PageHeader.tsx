import type { ReactNode } from 'react'

/**
 * Tüm sekmelerde tutarlı sayfa başlığı: ikon + başlık + alt açıklama + sağ aksiyonlar.
 * Piyasa Genel'deki premium görünümü diğer sayfalara taşır.
 */
export function PageHeader({
  icon, title, subtitle, right,
}: {
  icon?: ReactNode
  title: string
  subtitle?: ReactNode
  right?: ReactNode
}) {
  return (
    <div className="page-header">
      <div className="ph-title-wrap">
        {icon != null && <span className="ph-icon">{icon}</span>}
        <div style={{ minWidth: 0 }}>
          <h1 className="ph-title">{title}</h1>
          {subtitle != null && <div className="ph-sub">{subtitle}</div>}
        </div>
      </div>
      {right != null && <div className="ph-right">{right}</div>}
    </div>
  )
}
