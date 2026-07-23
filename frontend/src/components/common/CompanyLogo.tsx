// =============================================================================
// SerInvest — Şirket Logo Bileşeni
// Logo URL'lerini cascade ile dener; hepsi başarısız olursa renkli harf avatar.
// =============================================================================
import { useState } from 'react'
import { COMPANY_DOMAINS, logoColor, logoSources } from '../../lib/companies'

export function CompanyLogo({ symbol, size = 32 }: { symbol: string; size?: number }) {
  const domain  = COMPANY_DOMAINS[symbol]
  const sources = domain ? logoSources(domain) : []
  const [srcIdx, setSrcIdx] = useState(0)      // hangi kaynakta olduğumuzu tutar
  const col = logoColor(symbol)
  const fs  = Math.round(size * 0.38)
  const br  = Math.round(size * 0.22)           // border-radius: ~22% — köşe yuvarlama

  if (sources.length > 0 && srcIdx < sources.length) {
    return (
      <img
        className="co-logo"
        src={sources[srcIdx]}
        width={size} height={size}
        style={{ width: size, height: size, borderRadius: br, background: '#fff', flexShrink: 0 }}
        onError={() => setSrcIdx(i => i + 1)}   // sonraki kaynağa geç
        alt={symbol}
      />
    )
  }

  // Tüm kaynaklar tükendi → renkli harf avatar
  return (
    <div className="co-avatar" style={{
      width: size, height: size, fontSize: fs, borderRadius: br,
      background: col + '22', border: `1.5px solid ${col}44`, color: col,
      flexShrink: 0,
    }}>
      {symbol[0]}
    </div>
  )
}

export default CompanyLogo
