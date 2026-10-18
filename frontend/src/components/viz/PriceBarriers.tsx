// =============================================================================
// Fiyat + AI bariyerleri — yeni arayüzün grafik sarmalayıcısı.
//
// ÇİZİM MOTORU ORTAK: components/charts/PriceChart. Eski Terminal grafiği ve
// çoklu grafik panosu da onu kullanıyor. Yeni bir motor yazmak, aynı hatanın
// (senkron, eksen, mum hizalama) iki ayrı yerde yaşaması demekti. Burası
// yalnız yeni dilin kabuğu: zaman dilimi seçici, üst bilgi, altyazı.
//
// BARİYERLER EĞİTİMLE AYNI TANIM
// Hedef = TP × ATR, Stop = SL × ATR, ufuk = triple-barrier ufku. Çarpanlar
// config'ten okunuyor; altyazıda yazıyor ki ekranda görülen çizgi ile modelin
// eğitimde kullandığı tanım aynı olsun. Bu grafiğin bütün değeri o eşitlikte:
// farklı olsalardı grafik "şuraya gidecek" diyen bir süs olurdu.
//
// SATIŞ/TUT ÇAĞRISINDA BARİYER ÇİZİLMEZ. Hedef ve stop yalnız ALIM kararının
// parçası; başka bir karara iliştirmek uygulanamayan bir sayı gösterirdi.
// =============================================================================
import { useMemo, useState } from 'react'
import { useGrafikVerisi } from '../../lib/useGrafikVerisi'
import { useConfig } from '../../lib/useConfig'
import { PriceChart, type CrosshairInfo, type Overlay } from '../charts/PriceChart'
import type { Bar } from '../../lib/bars'
import type { OracleAnalysis } from '../../lib/types'
import { yuzde } from '../../lib/format'

const DILIMLER = ['1D', '1W', '1M', '3M', '1Y'] as const
type Dilim = typeof DILIMLER[number]
const DILIM_AD: Record<Dilim, string> = {
  '1D': '1G', '1W': '1H', '1M': '1A', '3M': '3A', '1Y': '1Y',
}

const px = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const hacim = (v: number | null) => {
  if (v == null) return '—'
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)} Mr`
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)} Mn`
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)} B`
  return String(Math.round(v))
}


export function PriceBarriers({
  sembol, analiz, yukseklik = 300, ondalik = 2, ekSeviyeler = [], onBarlar,
}: {
  sembol: string
  analiz: OracleAnalysis | null
  yukseklik?: number
  ondalik?: number
  /** Grafiğe çizilecek ek yatay seviyeler (tanımlı fiyat seviyeleri). */
  ekSeviyeler?: Array<{ ad: string; fiyat: number; renk?: string }>
  /** Barlar yüklendiğinde çağrılır — sayfa aynı veriyi ikinci kez çekmesin. */
  onBarlar?: (b: Bar[]) => void
}) {
  const cfg = useConfig()
  const [dilim, setDilim] = useState<Dilim>('3M')
  const [tur, setTur] = useState<'candle' | 'line'>('candle')
  const [imlec, setImlec] = useState<CrosshairInfo | null>(null)
  // Geri çağrıyı ref'te tutuyoruz: çağıran satır içi bir lambda geçerse her
  // render'da kimliği değişir ve efekt veriyi yeniden çekerdi. Bağımlılıkta
  // olmaması da sessiz bir bayatlama riskiydi; ref ikisini birden çözüyor.
  // onBarlar hook içinde ref'te tutulur: satır içi lambda geçilse de istek
  // yinelenmez (eskiden burada elle yapılıyordu).
  const { bars: barlar, yukleniyor, hata } = useGrafikVerisi(sembol, dilim, onBarlar)

  // Sembol ya da dilim değişince imleç okuması temizlenir (render sırasında).
  const anahtar = `${sembol}:${dilim}`
  const [oncekiAnahtar, setOncekiAnahtar] = useState(anahtar)
  if (anahtar !== oncekiAnahtar) {
    setOncekiAnahtar(anahtar)
    setImlec(null)
  }

  const alim = !!analiz && analiz.recommendation.includes('ALIM')
  const hedef = alim ? analiz?.shortTermTarget ?? null : null
  const stop  = alim ? analiz?.shortTermStop ?? null : null
  const giris = alim ? analiz?.priceAtAnalysis ?? null : null

  const ilk = barlar.length ? barlar[0].c : null
  const son = barlar.length ? barlar[barlar.length - 1].c : null
  const degisim = son != null && ilk ? ((son - ilk) / ilk) * 100 : null

  const katmanlar = useMemo<Overlay[]>(() => {
    const o: Overlay[] = []
    if (hedef != null) o.push({ price: hedef, color: 'var(--u-up)', label: `Hedef ${px.format(hedef)}` })
    if (stop  != null) o.push({ price: stop,  color: 'var(--u-down)', label: `Stop ${px.format(stop)}` })
    if (giris != null) o.push({ price: giris, color: 'var(--u-accent)', label: `Analiz ${px.format(giris)}` })
    // Tanımlı fiyat seviyeleri — bariyerlerden AYIRT EDİLSİN diye soluk ve
    // kesikli. Bariyer modelin iddiası, bunlar yalnız tanımlı fiyatlar.
    for (const e of ekSeviyeler) {
      o.push({ price: e.fiyat, color: e.renk ?? 'var(--u-text-4)',
               label: e.ad, dashed: true })
    }
    return o
  }, [hedef, stop, giris, ekSeviyeler])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--u-s2)', minWidth: 0 }}>

      {/* Üst satır: imleç varsa OHLC, yoksa dönem değişimi */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--u-s3)', flexWrap: 'wrap' }}>
        {imlec ? (
          <span className="u-exact" style={{ display: 'flex', gap: 'var(--u-s3)' }}>
            <span>A <b style={{ color: 'var(--u-text-2)' }}>{px.format(imlec.o ?? 0)}</b></span>
            <span>Y <b style={{ color: 'var(--u-text-2)' }}>{px.format(imlec.h ?? 0)}</b></span>
            <span>D <b style={{ color: 'var(--u-text-2)' }}>{px.format(imlec.l ?? 0)}</b></span>
            <span>K <b style={{ color: 'var(--u-text)' }}>{px.format(imlec.c ?? 0)}</b></span>
            {imlec.v != null && <span>H <b style={{ color: 'var(--u-text-2)' }}>{hacim(imlec.v)}</b></span>}
          </span>
        ) : (
          <span className="u-sub">
            {DILIM_AD[dilim]} içinde{' '}
            {degisim == null ? '—' : (
              <b className={`u-num ${degisim >= 0 ? 'u-up' : 'u-down'}`}>
                {yuzde(degisim, 2, true)}
              </b>
            )}
          </span>
        )}

        <div style={{ flexGrow: 1 }} />

        <button onClick={() => setTur(t => (t === 'candle' ? 'line' : 'candle'))}
                className="u-seg" aria-pressed={tur === 'candle'}
                title={tur === 'candle' ? 'Çizgiye geç' : 'Muma geç'}>
          {tur === 'candle' ? 'Mum' : 'Çizgi'}
        </button>
        <div style={{ display: 'flex', gap: 2 }}>
          {DILIMLER.map(d => (
            <button key={d} onClick={() => setDilim(d)} className="u-seg"
                    aria-pressed={dilim === d}>{DILIM_AD[d]}</button>
          ))}
        </div>
      </div>

      {/* Grafik */}
      <div style={{ height: yukseklik, position: 'relative', minWidth: 0,
                    background: 'var(--u-panel)', borderRadius: 'var(--u-r-md)' }}>
        {(yukleniyor || hata) && (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
                        fontSize: 'var(--u-t-small)', color: 'var(--u-text-3)', zIndex: 1 }}>
            {yukleniyor ? 'Grafik yükleniyor…' : `Grafik alınamadı (${hata})`}
          </div>
        )}
        {barlar.length > 0 && (
          <PriceChart bars={barlar} kind={tur} overlays={katmanlar}
                      precision={ondalik} onCrosshair={setImlec} height={yukseklik} />
        )}
      </div>

      {/* Altyazı: çizgilerin TANIMI. Grafiğin değeri buradaki eşitlikte. */}
      <div style={{ display: 'flex', gap: 'var(--u-s4)', flexWrap: 'wrap',
                    fontSize: 'var(--u-t-micro)', color: 'var(--u-text-3)' }}>
        {hedef != null && <span className="u-up">— Hedef = {cfg.model.tp_atr_mult}×ATR</span>}
        {stop  != null && <span className="u-down">— Stop = {cfg.model.sl_atr_mult}×ATR</span>}
        {!alim && analiz && <span>Bu karar ALIM değil — hedef/stop çizilmez.</span>}
        <span style={{ marginLeft: 'auto' }}>
          {cfg.model.horizon_days} günlük triple-barrier · eğitimdeki tanımla aynı
        </span>
      </div>
    </div>
  )
}

export default PriceBarriers
