// =============================================================================
// Terminal — Sinyal Bandı (haber olayları)
// Son haberler; Faz 3 olay tipolojisi rozetleriyle (TEMETTU, FAIZ_KARARI, ...).
// =============================================================================
import type { NewsSignal } from '../../lib/types'

// Backend artık eventType/novelty gönderiyor (Faz 3) — eski kayıtlarda olmayabilir.
type NewsWithEvents = NewsSignal & { eventType?: string; novelty?: number }

const EVENT_TR: Record<string, string> = {
  TEMETTU: 'TEMETTÜ', GERI_ALIM: 'GERİ ALIM', BEDELLI: 'BEDELLİ',
  KAR_ACIKLAMA: 'BİLANÇO', SOZLESME: 'SÖZLEŞME', YATIRIM: 'YATIRIM',
  YONETIM: 'YÖNETİM', CEZA_SORUSTURMA: 'CEZA/SORUŞTURMA',
  DERECELENDIRME: 'DERECELENDİRME', FAIZ_KARARI: 'FAİZ', ENFLASYON: 'ENFLASYON',
  JEOPOLITIK: 'JEOPOLİTİK', MAKRO_VERI: 'MAKRO',
}

function ago(iso: string): string {
  const mins = Math.max(0, (Date.now() - new Date(iso.endsWith('Z') ? iso : iso + 'Z').getTime()) / 60000)
  if (mins < 60) return `${Math.round(mins)}dk`
  if (mins < 60 * 24) return `${Math.round(mins / 60)}sa`
  return `${Math.round(mins / 1440)}g`
}

export function EventTape({ news }: { news: NewsSignal[] }) {
  const items = (news as NewsWithEvents[]).slice(0, 16)

  return (
    <section className="t-panel t-area-tape" aria-label="Haber sinyal bandı">
      <div className="t-panel__head">
        <span className="t-panel__title">Sinyal Bandı · NLP Olay Akışı</span>
        <span className="t-panel__meta">{items.length} sinyal</span>
      </div>
      <div className="t-tape">
        {items.map(n => {
          const evt = n.eventType && n.eventType !== 'GENEL' ? EVENT_TR[n.eventType] ?? n.eventType : null
          const s = n.sentimentScore
          const cls = s > 0.15 ? 't-up' : s < -0.15 ? 't-down' : 't-flat'
          return (
            <a key={n.id} className="t-tape__item" href={n.url || undefined} target="_blank" rel="noreferrer"
               style={{ textDecoration: 'none' }}>
              <div className="t-tape__head">
                <span style={{ fontWeight: 800, fontSize: 10.5, color: 'var(--text-primary)' }}>{n.entity}</span>
                {evt && <span className={`t-eventchip ${n.eventType === 'JEOPOLITIK' ? 't-eventchip--geo' : ''}`}>{evt}</span>}
                {n.isGeopolitical && !evt && <span className="t-eventchip t-eventchip--geo">JEOPOLİTİK</span>}
                <span className={`t-num ${cls}`} style={{ fontSize: 10.5, fontWeight: 700, marginLeft: 'auto' }}>
                  {s >= 0 ? '+' : ''}{s.toFixed(2)}
                </span>
                <span className="t-num" style={{ fontSize: 9.5, color: 'var(--text-disabled)' }}>{ago(n.createdAt)}</span>
              </div>
              <span className="t-tape__headline">{n.headline}</span>
            </a>
          )
        })}
        {items.length === 0 && (
          <div style={{ padding: 12, fontSize: 11.5, color: 'var(--text-muted)' }}>Haber akışı bekleniyor…</div>
        )}
      </div>
    </section>
  )
}
