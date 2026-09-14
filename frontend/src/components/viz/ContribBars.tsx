// =============================================================================
// Katkı çubukları — "hangi etken kararı ne yöne, ne kadar itti"
//
// Sıfır ekseni ORTADA: artı sağa, eksi sola. Tek yönlü çubuklarla çizilseydi
// yön yalnız renkten okunurdu ve renk körlüğünde kaybolurdu; burada yön
// KONUMDAN da belli.
//
// Ölçek en büyük MUTLAK değere göre. Böylece "en güçlü etken hangisi"
// sorusunun cevabı çubuk uzunluğundan doğrudan okunuyor — sayıları
// karşılaştırmaya gerek kalmıyor.
//
// ÖLÇÜLEMEYEN SATIR ÇUBUKSUZ KALIR. Sayısı çıkarılamamış bir etken için
// çubuk uydurmak, olmayan bir ölçümü varmış gibi göstermek olurdu; o satır
// düz metin olarak durur ve bunu kullanıcı da görür.
// =============================================================================
import { fmt } from '../../lib/format'

export interface Katki {
  ad: string
  /** Artı = karara lehte, eksi = aleyhte. null = ölçülemedi. */
  deger: number | null
  /** Uzun açıklama (ipucu olarak). */
  baslik?: string
}

export function ContribBars({
  ogeler, yukseklik = 9, ondalik = 2,
}: {
  ogeler: Katki[]
  yukseklik?: number
  ondalik?: number
}) {
  const olculen = ogeler.filter(o => o.deger != null) as Array<Katki & { deger: number }>
  const enBuyuk = olculen.length
    ? Math.max(...olculen.map(o => Math.abs(o.deger)))
    : 0

  if (ogeler.length === 0) {
    return <span className="u-sub">Bu karar için gerekçe kaydı yok.</span>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--u-s2)' }}>
      {ogeler.map((o, i) => {
        const v = o.deger
        const oran = v != null && enBuyuk > 0 ? Math.abs(v) / enBuyuk : 0
        const artida = (v ?? 0) >= 0
        return (
          <div key={`${o.ad}-${i}`}
               style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 132px 54px',
                        alignItems: 'center', gap: 'var(--u-s3)' }}
               title={o.baslik ?? o.ad}>
            <span style={{ fontSize: 'var(--u-t-small)', color: 'var(--u-text-2)',
                           whiteSpace: 'nowrap', overflow: 'hidden',
                           textOverflow: 'ellipsis' }}>{o.ad}</span>

            {/* Çubuk alanı: ortada sıfır ekseni */}
            <div style={{ position: 'relative', height: yukseklik }}>
              <div style={{ position: 'absolute', left: '50%', top: -2, bottom: -2,
                            width: 1, background: 'var(--viz-ref)' }} />
              {v != null && (
                <div style={{
                  position: 'absolute', top: 0, height: yukseklik,
                  width: `${oran * 50}%`,
                  [artida ? 'left' : 'right']: '50%',
                  background: artida ? 'var(--u-up)' : 'var(--u-down)',
                  borderRadius: artida
                    ? `0 ${yukseklik / 2}px ${yukseklik / 2}px 0`
                    : `${yukseklik / 2}px 0 0 ${yukseklik / 2}px`,
                } as React.CSSProperties} />
              )}
            </div>

            <span className="u-num"
                  style={{ fontSize: 'var(--u-t-small)', textAlign: 'right',
                           color: v == null ? 'var(--u-text-4)'
                                 : artida ? 'var(--u-up)' : 'var(--u-down)' }}>
              {v == null ? 'ölçülemedi'
                : `${v >= 0 ? '+' : ''}${fmt(v, ondalik)}`}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export default ContribBars
