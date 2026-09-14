// =============================================================================
// SerInvest — Haber Akışı
//
// Kategori + duyarlılık süzgeçli liste; her haber genişleyebilir kart.
//
// YENİ DİLE TAŞINDI (14.09.2026). Eski hâlinde renkler kodun içine gömülüydü
// (#22c55e, #ef4444, #94a3b8, #f97316) — tema değişince kartlar tek başına
// eski paletle kalıyordu. Artık hepsi jeton.
//
// SÜZGEÇLER TEK SATIRDA. Eskiden iki ayrı satır vardı (kategori, sonra
// duyarlılık) ve ikisinin arasında "200 haber gösteriliyor" yazıyordu; liste
// başlamadan üç sıra kumanda geliyordu. İkisi aynı şeyin iki ekseni, yan
// yana duruyorlar.
//
// "DAHA FAZLA" GERÇEK BİR DÜĞME. Eskiden liste 30'da kesiliyor ve altına
// "+170 daha fazla haber (API'den daha fazla çekmek için limit artırılabilir)"
// yazıyordu — kullanıcıya söylenmiş bir geliştirici notu. Veri zaten elde;
// düğme onu gösteriyor.
// =============================================================================
import { useMemo, useState } from 'react'
import type { NewsSignal } from '../../lib/types'
import { HABER_KATEGORILERI, duyarlilikBilgi, gecenSure, haberKategorisi,
         type HaberKategori } from '../../lib/haber'

/** Bir seferde gösterilen haber sayısı; "daha fazla" bu kadar ekler. */
const SAYFA = 30

function NewsCard({ item }: { item: NewsSignal }) {
  const [acik, setAcik] = useState(false)
  const d = duyarlilikBilgi(item.sentimentLabel)

  return (
    <div
      onClick={() => setAcik(a => !a)}
      role="button"
      tabIndex={0}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setAcik(a => !a) }
      }}
      style={{
        background: 'var(--u-panel)',
        borderRadius: 'var(--u-r-md)',
        padding: 'var(--u-s3) var(--u-s4)',
        cursor: 'pointer',
        minWidth: 0,
        // Duyarlılık SOL KENARDA bir şerit: kart içinde ayrı bir renkli rozet
        // daha az yer kaplıyor ve göz listeyi dikey tarayabiliyor.
        boxShadow: `inset 3px 0 0 ${d.renk}`,
      }}
    >
      <div style={{ display: 'flex', gap: 'var(--u-s3)', alignItems: 'flex-start', minWidth: 0 }}>
        <div style={{ flexGrow: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 'var(--u-t-body)', fontWeight: 'var(--u-w-med)',
            color: 'var(--u-text)', lineHeight: 'var(--u-lh-snug)',
            marginBottom: 'var(--u-s2)',
            overflow: 'hidden', display: '-webkit-box',
            WebkitLineClamp: acik ? 'unset' : 2, WebkitBoxOrient: 'vertical',
          }}>
            {item.headline || item.summary?.slice(0, 120) || '(Başlık yok)'}
          </div>

          <div style={{ display: 'flex', gap: 'var(--u-s2)', flexWrap: 'wrap',
                        alignItems: 'center', fontSize: 'var(--u-t-micro)',
                        color: 'var(--u-text-3)' }}>
            <span style={{ color: d.renk, fontWeight: 'var(--u-w-bold)' }}>
              {d.isaret} {d.ad}
            </span>
            <span>{item.entity}</span>
            <span style={{ color: 'var(--u-text-4)' }}>{item.source}</span>
            {item.isGeopolitical && (
              <span style={{ color: 'var(--u-warn)' }}>jeopolitik</span>
            )}
            <span style={{ marginLeft: 'auto', color: 'var(--u-text-4)' }}>
              {gecenSure(item.createdAt)}
            </span>
          </div>
        </div>
        <span style={{ flexShrink: 0, fontSize: 'var(--u-t-micro)',
                       color: 'var(--u-text-4)', paddingTop: 2 }}>
          {acik ? '▲' : '▼'}
        </span>
      </div>

      {acik && item.summary && (
        <div style={{
          marginTop: 'var(--u-s3)', paddingTop: 'var(--u-s3)',
          borderTop: '1px solid var(--u-line)',
          fontSize: 'var(--u-t-small)', color: 'var(--u-text-2)',
          lineHeight: 'var(--u-lh-base)',
        }}>
          {item.summary}
          {item.url && (
            <a href={item.url} target="_blank" rel="noopener noreferrer"
               onClick={e => e.stopPropagation()}
               style={{ display: 'inline-block', marginTop: 'var(--u-s2)',
                        fontSize: 'var(--u-t-micro)' }}>
              Habere git →
            </a>
          )}
        </div>
      )}
    </div>
  )
}

export function NewsFeed({ news }: { news: NewsSignal[] }) {
  const [kategori, setKategori] = useState<HaberKategori>('TÜM')
  const [duyarlilik, setDuyarlilik] = useState<string>('TÜM')
  const [limit, setLimit] = useState(SAYFA)

  const sayilar = useMemo(() => {
    const s: Record<HaberKategori, number> = {
      'TÜM': news.length, 'BIST': 0, 'EMTİA': 0, 'KÜRESEL': 0, 'MAKRO': 0,
    }
    for (const n of news) s[haberKategorisi(n)]++
    return s
  }, [news])

  const kategoriliste = useMemo(
    () => (kategori === 'TÜM' ? news : news.filter(n => haberKategorisi(n) === kategori)),
    [news, kategori])

  const gorunen = useMemo(
    () => (duyarlilik === 'TÜM' ? kategoriliste
                                : kategoriliste.filter(n => n.sentimentLabel === duyarlilik)),
    [kategoriliste, duyarlilik])

  if (news.length === 0) {
    return (
      <span className="u-sub">
        Henüz haber yok — analyst-engine toplamaya devam ediyor.
      </span>
    )
  }

  const sec = (k: HaberKategori) => {
    setKategori(k); setDuyarlilik('TÜM'); setLimit(SAYFA)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--u-s3)', minWidth: 0 }}>

      {/* Süzgeçler: iki eksen, tek satır */}
      <div style={{ display: 'flex', gap: 'var(--u-s2)', flexWrap: 'wrap',
                    alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          {HABER_KATEGORILERI.map(({ key, label }) => (
            <button key={key} className="u-seg" aria-pressed={kategori === key}
                    onClick={() => sec(key)}>
              {label}{sayilar[key] > 0 && ` ${sayilar[key]}`}
            </button>
          ))}
        </div>

        <span style={{ width: 1, height: 16, background: 'var(--u-line)' }} />

        <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          {[['TÜM', 'Hepsi'], ['BULLISH', '▲ Yükseliş'],
            ['NEUTRAL', '● Nötr'], ['BEARISH', '▼ Düşüş']].map(([k, ad]) => (
            <button key={k} className="u-seg" aria-pressed={duyarlilik === k}
                    onClick={() => { setDuyarlilik(k); setLimit(SAYFA) }}>
              {ad}
            </button>
          ))}
        </div>

        <span className="u-exact" style={{ marginLeft: 'auto' }}>
          {gorunen.length} haber
        </span>
      </div>

      {/* Liste */}
      {gorunen.length === 0 ? (
        <span className="u-sub">Bu süzgeçte haber yok.</span>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--u-s2)' }}>
          {gorunen.slice(0, limit).map(item => <NewsCard key={item.id} item={item} />)}
          {gorunen.length > limit && (
            <button className="u-seg" style={{ alignSelf: 'center', padding: '6px 14px' }}
                    onClick={() => setLimit(l => l + SAYFA)}>
              {gorunen.length - limit} haber daha göster
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default NewsFeed
