// Tek import noktası — `import { Button, KPI, PageHeader } from './components/ui'`
//
// 08/2026 temizliği: Badge, Card/CardHeader, Input/Select, CountUp ve InfoTip
// hiçbir yerde kullanılmıyordu (329 satır) — silindi. Barrel yalnızca gerçekten
// kullanılan bileşenleri yayınlar; kullanılmayanı burada tutmak "var ama yok"
// izlenimi yaratıyordu.
export { Button } from './Button'
export { KPI } from './KPI'
export { PageHeader } from './PageHeader'
export { Icon } from './Icon'
export type { IconName } from './Icon'
export { EmptyState } from './EmptyState'
export { ToastProvider, useToast } from './Toast'
export { Tooltip } from './Tooltip'
export { CommandPalette } from './CommandPalette'
export type { Command } from './CommandPalette'
export { DataTable } from './DataTable'
export type { Column } from './DataTable'
