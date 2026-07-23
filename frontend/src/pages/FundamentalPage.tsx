// =============================================================================
// SerInvest — Temel Analiz Sayfası  (route: /fundamental)
// PageHeader + FundamentalTab. Not: ml v3 modeli saf teknik — temel veriler
// burada yalnızca BİLGİ amaçlı sunulur, sinyale dönüştürülmez.
// =============================================================================
import { useOutletContext } from 'react-router-dom'
import { PageHeader, Icon } from '../components/ui'
import { FundamentalTab } from '../tabs/FundamentalTab'
import type { SharedData } from '../App'

export default function FundamentalPage() {
  const { fundamentals } = useOutletContext<SharedData>()
  return (
    <div style={{ paddingTop: 'var(--space-2)' }}>
      <PageHeader
        icon={<Icon name="fundamental" size={20} />}
        title="Temel Analiz"
        subtitle={<>BIST temel göstergeleri — F/K, PD/DD, ROE, FAVÖK · {fundamentals.length} şirket <span style={{ color: 'var(--text-disabled)' }}>· bilgi amaçlı (model saf teknik)</span></>}
      />
      <FundamentalTab data={fundamentals} />
    </div>
  )
}
