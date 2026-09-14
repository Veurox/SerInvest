// =============================================================================
// SerInvest — Haberler  (route: /news)
// docs/PLAN_ARAYUZ.md · Bugün alanının bir bölümü
//
// Tek soruyu cevaplar: BUGÜN NE KONUŞULUYOR?
//
// NEDEN ÖNCE GÖRSEL, SONRA LİSTE
// Eski hâlinde sayfa "200 haber · ▲81 ●18 ▼101" diye açılıyordu: üç sayı,
// hiçbiri ölçeğiyle birlikte değil. 81 çok mu az mı, 101'e göre nerede
// duruyor — bölme yapmadan okunmuyordu. Halka oranı tek bakışta veriyor,
// sayılar yanında duruyor ("görsel önde, sayı yanında").
//
// DUYARLILIK BİR ÖLÇÜM DEĞİL, BİR SAYIM. Kaç haberin olumlu etiketlendiğini
// söyler; piyasanın ne yapacağını söylemez. Bunu ekranda yazıyoruz, çünkü
// büyük bir halka grafiği kolayca "piyasa düşecek" diye okunuyor.
// =============================================================================
import { useMemo } from 'react'
import { useOutletContext } from 'react-router-dom'
import { NewsFeed } from '../components/news/NewsFeed'
import { Donut } from '../components/viz'
import type { SharedData } from '../App'

export default function NewsPage() {
  const { news } = useOutletContext<SharedData>()

  const say = useMemo(() => {
    let olumlu = 0, olumsuz = 0, notr = 0, jeo = 0
    for (const n of news) {
      if (n.sentimentLabel === 'BULLISH') olumlu++
      else if (n.sentimentLabel === 'BEARISH') olumsuz++
      else notr++
      if (n.isGeopolitical) jeo++
    }
    return { olumlu, olumsuz, notr, jeo }
  }, [news])

  const egilim = news.length > 0 ? (say.olumlu - say.olumsuz) / news.length : null

  return (
    <div className="ui2" style={{ minHeight: '100%',
                                  padding: 'var(--u-s4) var(--u-s5) var(--u-s5)' }}>

      <div className="u-band">
        <div className="u-band__head">
          <h1 className="u-band__q">Bugün ne konuşuluyor?</h1>
          {/* Sayıyı halkanın ortası söylüyor; burada tekrarlanmıyor.
              Zaman aralığı da YAZILMIYOR: uç nokta /signals/latest?limit=200,
              yani "en son 200 kayıt" — belirli bir pencere değil. "Son 48
              saat" yazmak ölçmediğimiz bir şeyi iddia etmek olurdu. */}
          <span className="u-sub">
            BIST, emtia, küresel ve makro kaynaklardan · en son kayıtlar
          </span>
        </div>

        <div style={{ display: 'flex', gap: 'var(--u-s6)', alignItems: 'center',
                      flexWrap: 'wrap' }}>
          {/* Halkanın ortasında TOPLAM duruyor, eğilim değil.
              İlk yazımda orta "%17 · olumsuz ağır" diyordu (net farkın toplama
              oranı). Doğru bir sayıydı ama yanlış okunuyordu: "haberlerin
              %17'si olumsuz" gibi — oysa olumsuz oranı %54. Eğilim cümleyle
              söyleniyor, dilimlerin yüzdeleri zaten lejantta. */}
          <Donut
            boyut={132}
            ortaUst={String(news.length)}
            ortaAlt="haber"
            dilimler={[
              { ad: 'Olumlu', deger: say.olumlu, renk: 'var(--u-up)' },
              { ad: 'Nötr', deger: say.notr, renk: 'var(--u-flat)' },
              { ad: 'Olumsuz', deger: say.olumsuz, renk: 'var(--u-down)' },
            ]}
          />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--u-s2)',
                        maxWidth: 460, minWidth: 0 }}>
            <span className="u-sub">
              Etiketlerin dağılımı{' '}
              <b style={{ color: 'var(--u-text-2)' }}>
                {egilim == null ? '—'
                  : egilim > 0.02 ? 'olumsuzdan çok olumlu tarafta'
                  : egilim < -0.02 ? 'olumludan çok olumsuz tarafta'
                  : 'iki tarafa dengeli'}</b>.{' '}
              Bu bir <b style={{ color: 'var(--u-text-2)' }}>sayım</b>, ölçüm değil:
              kaç haberin olumlu ya da olumsuz etiketlendiğini söyler. Piyasanın
              ne yapacağını söylemez — modelin haber skoru da zaten
              hesaplanmıyor (saf teknik model).
            </span>
            {say.jeo > 0 && (
              <span className="u-sub" style={{ color: 'var(--u-text-4)' }}>
                {say.jeo} haber jeopolitik olarak işaretli.
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="u-band">
        <NewsFeed news={news} />
      </div>
    </div>
  )
}
