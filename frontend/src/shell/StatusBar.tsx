// =============================================================================
// SerInvest — Alt Durum Şeridi
// ULTRAPLAN ilke #8: "durum her zaman görünür". Dağınık yerlerdeki bilgiler
// (piyasa açık mı, veri ne kadar taze, model ne durumda) tek şeritte toplanır.
// =============================================================================
import { useEffect, useState } from 'react'
import type { SystemStatus } from '../lib/types'
import { isMarketOpen } from '../lib/format'

interface Props {
  status: SystemStatus | null
  assetCount: number
  oracleCount: number
  newsCount: number
  lastUpdate: string
}

export function StatusBar({ status, assetCount, oracleCount, newsCount, lastUpdate }: Props) {
  const [now, setNow] = useState(() => new Date())
  const [open, setOpen] = useState(() => isMarketOpen())

  useEffect(() => {
    const t = setInterval(() => { setNow(new Date()); setOpen(isMarketOpen()) }, 30_000)
    return () => clearInterval(t)
  }, [])

  const ready = status?.ready ?? false

  return (
    <footer className="statusbar" role="status">
      <span className="statusbar__item" title={open ? 'BIST seansı açık' : 'BIST seansı kapalı'}>
        <span className="statusbar__dot"
              style={{ background: open ? 'var(--profit)' : 'var(--text-disabled)' }} />
        {open ? 'Piyasa Açık' : 'Piyasa Kapalı'}
      </span>

      <span className="statusbar__item" title="Servislerin genel durumu">
        <span className="statusbar__dot"
              style={{ background: ready ? 'var(--profit)' : 'var(--warning)' }} />
        {ready ? 'Sistem hazır' : 'Başlatılıyor'}
      </span>

      <span className="statusbar__item" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {assetCount} sembol · {oracleCount} analiz · {newsCount} haber
      </span>

      {lastUpdate && (
        <span className="statusbar__item" title="Son veri yenilemesi"
              style={{ fontVariantNumeric: 'tabular-nums' }}>
          Son veri {lastUpdate}
        </span>
      )}

      <span className="statusbar__spacer" />

      <span className="statusbar__item" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
      </span>
    </footer>
  )
}
