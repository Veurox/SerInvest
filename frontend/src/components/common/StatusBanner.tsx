// =============================================================================
// SerInvest — Sistem Durumu Paneli
// Sistem servisleri hazır olana kadar gösterilen başlangıç banner'ı.
// =============================================================================
import type { SystemStatus } from '../../lib/types'

export function StatusBanner({
  status, assetsReady, oracleReady, newsReady,
}: {
  status: SystemStatus | null
  assetsReady: boolean
  oracleReady: boolean
  newsReady: boolean
}) {
  // Her şey hazırsa hiçbir şey gösterme
  if (assetsReady && oracleReady) return null

  // Status API'den gelen detay (yoksa veri durumundan çıkar)
  const dbOk        = status ? status.db === 'ok'         : true
  const marketState = status ? status.market_data_service : (assetsReady ? 'ok' : 'waiting')
  const newsState   = status ? status.analyst_engine      : (newsReady   ? 'ok' : 'waiting')
  const oracleState = status ? status.oracle_service      : (oracleReady ? 'ok' : 'training')

  const rows: [string, string][] = [
    ['Veritabanı',    dbOk ? 'ok' : 'error'],
    ['Piyasa Verisi', marketState],
    ['Haber Motoru',  newsState],
    ['AI Oracle (ML)', oracleState],
  ]

  const Dot = ({ s }: { s: string }) => {
    const color = s === 'ok' ? '#22c55e' : s === 'error' ? '#ef4444' : '#fbbf24'
    const label = s === 'ok' ? 'Hazır' : s === 'error' ? 'Hata' : s === 'training' ? 'Eğitim...' : 'Bekleniyor'
    return <span style={{ color, fontWeight: 700 }}>● {label}</span>
  }

  return (
    <div style={{
      background: 'rgba(251,191,36,.07)', border: '1px solid rgba(251,191,36,.25)',
      borderRadius: '10px', padding: '.875rem 1.25rem', marginBottom: '1.5rem',
    }}>
      <div style={{ fontSize: '.8rem', fontWeight: 700, color: 'var(--accent)', marginBottom: '.75rem', letterSpacing: '.05em' }}>
        SİSTEM BAŞLATILIYOR
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: '.5rem' }}>
        {rows.map(([label, s]) => (
          <div key={label} style={{ fontSize: '.82rem', color: 'var(--text-dim)', display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
            <span>{label}</span><Dot s={s} />
          </div>
        ))}
      </div>

      {/* Oracle eğitim mesajı */}
      {!oracleReady && (
        <div style={{ marginTop: '.875rem', borderTop: '1px solid var(--tint-4)', paddingTop: '.875rem', fontSize: '.8rem', color: 'var(--text-muted)', lineHeight: 1.7 }}>
          <strong style={{ color: 'var(--accent)' }}>Oracle modeli ilk kez eğitiliyor</strong> —
          ~90 sembol × 2 yıl tarihsel veri indiriliyor. Bu işlem <strong style={{ color: 'var(--text)' }}>~30–60 dakika</strong> sürer ve yalnızca bir kez yapılır.<br />
          Terminalde takip etmek için:&nbsp;
          <code style={{ background: 'var(--tint-4)', padding: '.15rem .5rem', borderRadius: '5px', fontSize: '.78rem' }}>
            docker logs serinvest-oracle -f
          </code>
        </div>
      )}

      {/* Piyasa verisi bekleniyor */}
      {!assetsReady && oracleReady && (
        <div style={{ marginTop: '.875rem', borderTop: '1px solid var(--tint-4)', paddingTop: '.875rem', fontSize: '.8rem', color: 'var(--text-muted)' }}>
          Piyasa verisi bekleniyor — market-data-service ilk çalıştırmada ~2–3 dakika sürer.
        </div>
      )}
    </div>
  )
}

export default StatusBanner
