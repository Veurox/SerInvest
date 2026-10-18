// =============================================================================
// SerInvest — Alt Durum Şeridi
// ULTRAPLAN ilke #8: "durum her zaman görünür". Dağınık yerlerdeki bilgiler
// (piyasa açık mı, veri ne kadar taze, model ne durumda) tek şeritte toplanır.
// =============================================================================
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { SystemStatus } from '../lib/types'
import type { PiyasaDurumu } from '../lib/piyasa'
import { ADMIN, adminFetch } from '../lib/api'

// ── Öz denetim rozeti ────────────────────────────────────────────────────────
// docs/SAGLAMLIK_PLANI.md K1: "sessiz başarısızlık" örüntüsünü kırar.
// Bir değişmez ihlal edilirse kullanıcı hangi sayfada olursa olsun görür.
function SelfTestChip() {
  const [d, setD] = useState<{ overall: string; counts: Record<string, number> } | null>(null)

  useEffect(() => {
    const load = () => adminFetch(`${ADMIN}/selftest`)
      .then(r => r.ok ? r.json() : null)
      .then(j => j && !j.error && setD(j))
      .catch(() => {})
    load()
    const t = setInterval(load, 300_000)
    return () => clearInterval(t)
  }, [])

  if (!d) return null
  const fails = d.counts?.FAIL ?? 0
  const warns = d.counts?.WARN ?? 0
  if (!fails && !warns) return null   // her şey yolundaysa şeridi meşgul etme

  return (
    <Link to="/model" className="statusbar__item"
          title="Öz denetim ayrıntıları — Model sayfası"
          style={{ color: fails ? 'var(--loss)' : 'var(--warning)',
                   fontWeight: 700, textDecoration: 'none' }}>
      <span className="statusbar__dot"
            style={{ background: fails ? 'var(--loss)' : 'var(--warning)' }} />
      {fails ? `${fails} değişmez ihlali` : `${warns} denetim uyarısı`}
    </Link>
  )
}

interface Props {
  /** Arka uç takviminden (App.tsx usePiyasa) — tatil ve arifeyi bilir */
  piyasa: PiyasaDurumu
  status: SystemStatus | null
  assetCount: number
  oracleCount: number
  newsCount: number
  lastUpdate: string
}

export function StatusBar({ piyasa, status, assetCount, oracleCount, newsCount, lastUpdate }: Props) {
  const [now, setNow] = useState(() => new Date())
  const open = piyasa.islem

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(t)
  }, [])

  const ready = status?.ready ?? false

  return (
    <footer className="statusbar" role="status">
      <span className="statusbar__item"
            title={open ? 'BIST seansı açık' : `BIST seansı kapalı${piyasa.sebep ? ` — ${piyasa.sebep}` : ''}`}>
        <span className="statusbar__dot"
              style={{ background: open ? 'var(--profit)' : 'var(--text-disabled)' }} />
        {open ? 'Piyasa Açık'
          : piyasa.sebep?.startsWith('Tatil') ? piyasa.sebep.replace('Tatil: ', 'Tatil · ')
          : 'Piyasa Kapalı'}
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

      <SelfTestChip />

      <span className="statusbar__spacer" />

      <span className="statusbar__item" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
      </span>
    </footer>
  )
}
