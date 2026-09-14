// =============================================================================
// SerInvest — Fon Detayı
//
// NEDEN VAR
// Fon tablosunda satıra tıklamak hiçbir şey yapmıyordu: hisse tablosunda
// satır grafik açıyor, fonlarda ölü uçtu. Oysa tablo tek bir ANIN sayılarını
// gösteriyor (getiri, oynaklık, akran sırası) — "bu fon nasıl bir yol
// izledi" sorusunun cevabı yok.
//
// ÜÇ SERİ, ÜÇ AYRI SORU
//   1. FİYAT   — ne kazandırdı? (yüzde değişime çevrili, çünkü pay fiyatının
//                mutlak değeri hiçbir şey anlatmaz: 1,30 ₺ bir fonu 45 ₺'lik
//                bir fondan iyi ya da kötü yapmaz)
//   2. BÜYÜKLÜK— para giriyor mu çıkıyor mu?
//   3. YATIRIMCI— kaç kişi? Büyüklük artarken kişi azalıyorsa fon birkaç
//                büyük yatırımcıya dayanıyor demektir; o para çıkarsa fon
//                varlık satmak zorunda kalır. Tabloda görünmeyen bir risk.
//
// GRAFİK MOTORU ORTAK (components/charts/PriceChart). Fon serisi OHLC değil,
// yalnız kapanış — dördü de aynı değere set edilip çizgi modunda veriliyor.
// Ayrı bir çizim kodu yazmak, aynı hatanın (zaman birimi, sıralama, tema)
// ikinci bir yerde yaşaması demekti.
//
// TARİH ARALIĞI VERİNİN KENDİSİNDEN. "Son 1 yıl" yazıp 3 aylık seri çizmek
// yanlış olurdu: depoda 13 aylık geçmiş var ama her fonun o kadar geçmişi
// yok (67 fonun 1 yıllık geçmişi yok — tarama ekranı da bunu söylüyor).
// =============================================================================
import { useEffect, useMemo, useState } from 'react'
import { API } from '../../lib/api'
import { fmt, yuzde } from '../../lib/format'
import { PriceChart } from '../charts/PriceChart'
import { toPercent, type Bar } from '../../lib/bars'

interface Nokta { t: string; f: number; buyukluk: number | null; kisi: number | null }
interface Seri {
  kod: string
  unvan: string
  kategori: string
  nokta: Nokta[]
  bulunamadi?: boolean
}

const GUN_SECENEK = [
  { g: 90, ad: '3A' },
  { g: 180, ad: '6A' },
  { g: 400, ad: '1Y' },
  { g: 2000, ad: 'Tümü' },
] as const

const buyuklukYaz = (v: number | null): string => {
  if (v == null) return '—'
  if (v >= 1e9) return `${fmt(v / 1e9, 2)} Mr ₺`
  if (v >= 1e6) return `${fmt(v / 1e6, 1)} Mn ₺`
  return `${fmt(v, 0)} ₺`
}

const kisiYaz = (v: number | null): string =>
  v == null ? '—' : `${fmt(v, 0)} kişi`

/** Serinin ilk ve son değerinden yüzde değişim. */
const degisim = (dizi: (number | null)[]): number | null => {
  const g = dizi.filter((x): x is number => x != null && Number.isFinite(x) && x !== 0)
  if (g.length < 2) return null
  return (g[g.length - 1] / g[0] - 1) * 100
}

export function FonDetay({ kod, onKapat }: { kod: string; onKapat: () => void }) {
  const [gun, setGun] = useState<number>(400)
  const [seri, setSeri] = useState<Seri | null>(null)
  const [yukleniyor, setYukleniyor] = useState(true)
  const [hata, setHata] = useState<string | null>(null)

  useEffect(() => {
    let dur = false
    setYukleniyor(true); setHata(null)
    fetch(`${API}/fon/seri/${encodeURIComponent(kod)}?gun=${gun}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j: Seri) => {
        if (dur) return
        if (j.bulunamadi || !j.nokta?.length) { setHata('Bu fon için kayıtlı seri yok.'); setSeri(null) }
        else setSeri(j)
      })
      .catch(e => { if (!dur) { setHata(String(e.message ?? e)); setSeri(null) } })
      .finally(() => { if (!dur) setYukleniyor(false) })
    return () => { dur = true }
  }, [kod, gun])

  // `seri`ye bağlanıyor, `seri?.nokta ?? []` ifadesine değil: ikincisi her
  // render'da yeni bir dizi kimliği üretiyor ve aşağıdaki memo boşa çalışıyordu.
  const nokta = useMemo(() => seri?.nokta ?? [], [seri])

  // PriceChart OHLC bekliyor; fonun yalnız pay fiyatı var — dördü de aynı.
  //
  // DİKKAT: PriceChart'ın `percent` bayrağı yalnız EKSEN ETİKETİNİ değiştirir,
  // veriyi DÖNÜŞTÜRMEZ — normalizasyon çağıranın işi (ChartTile de böyle
  // yapıyor). Bunu atlayınca grafik ham pay fiyatını yüzde diye yazıyordu:
  // 3,039939 ₺ ekranda "+3,04%" olarak görünüyordu, oysa dönem değişimi
  // +%44,99'du. Üstelik sessizce: ne konsolda hata vardı ne de grafik boş
  // çizildi — yalnızca sayılar yanlıştı.
  const barlar: Bar[] = useMemo(() => toPercent(nokta.map(n => ({
    t: Date.parse(`${n.t}T00:00:00Z`),
    o: n.f, h: n.f, l: n.f, c: n.f, v: null,
  }))), [nokta])

  const fiyatDeg = degisim(nokta.map(n => n.f))
  const buyuklukDeg = degisim(nokta.map(n => n.buyukluk))
  const kisiDeg = degisim(nokta.map(n => n.kisi))
  const son = nokta[nokta.length - 1] ?? null
  const ilk = nokta[0] ?? null

  // Büyüklük artarken kişi azalıyorsa fon birkaç büyük yatırımcıya dayanıyor.
  const yogunlasma = buyuklukDeg != null && kisiDeg != null
    && buyuklukDeg > 5 && kisiDeg < -5

  return (
    <div style={{ background: 'var(--u-panel)', borderRadius: 'var(--u-r-lg)',
                  padding: 'var(--u-s4)', marginTop: 'var(--u-s2)',
                  display: 'flex', flexDirection: 'column', gap: 'var(--u-s3)',
                  minWidth: 0 }}>

      {/* Başlık satırı */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--u-s3)',
                    flexWrap: 'wrap' }}>
        <b className="u-num" style={{ fontSize: 'var(--u-t-lead)' }}>{kod}</b>
        <span className="u-sub" style={{ flexGrow: 1, minWidth: 0 }}>
          {seri?.unvan || '—'}
        </span>
        <div style={{ display: 'flex', gap: 2 }}>
          {GUN_SECENEK.map(s => (
            <button key={s.g} className="u-seg" aria-pressed={gun === s.g}
                    onClick={() => setGun(s.g)}>{s.ad}</button>
          ))}
        </div>
        <button className="u-seg" onClick={onKapat} aria-label="Detayı kapat">Kapat</button>
      </div>

      {yukleniyor && <span className="u-sub">Seri yükleniyor…</span>}
      {hata && <span className="u-sub" style={{ color: 'var(--u-warn)' }}>{hata}</span>}

      {!yukleniyor && !hata && nokta.length > 0 && (
        <>
          {/* Üç ölçü, üç ayrı soru */}
          <div style={{ display: 'grid', gap: 'var(--u-s4)',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
            <Olcu ad="Pay fiyatı" deger={fmt(son?.f ?? null, 6)}
                  alt={`dönem değişimi ${yuzde(fiyatDeg, 2, true)}`}
                  renk={fiyatDeg == null ? undefined : fiyatDeg >= 0 ? 'var(--u-up)' : 'var(--u-down)'} />
            <Olcu ad="Fon büyüklüğü" deger={buyuklukYaz(son?.buyukluk ?? null)}
                  alt={`dönem değişimi ${yuzde(buyuklukDeg, 1, true)}`}
                  renk={buyuklukDeg == null ? undefined : buyuklukDeg >= 0 ? 'var(--u-up)' : 'var(--u-down)'} />
            <Olcu ad="Yatırımcı sayısı" deger={kisiYaz(son?.kisi ?? null)}
                  alt={`dönem değişimi ${yuzde(kisiDeg, 1, true)}`}
                  renk={kisiDeg == null ? undefined : kisiDeg >= 0 ? 'var(--u-up)' : 'var(--u-down)'} />
          </div>

          {yogunlasma && (
            <span className="u-sub" style={{ color: 'var(--u-warn)' }}>
              Bu dönemde fon büyürken yatırımcı sayısı azaldı — fon birkaç büyük
              yatırımcıya dayanıyor olabilir. O para çıkarsa fon varlık satmak
              zorunda kalır; tablodaki getiri sayısı bu riski göstermez.
            </span>
          )}

          {/* Fiyat serisi — yüzde değişim modunda: pay fiyatının mutlak
              değeri fonlar arası hiçbir şey anlatmıyor. */}
          <div style={{ height: 220, background: 'var(--u-panel-2)',
                        borderRadius: 'var(--u-r-md)', minWidth: 0 }}>
            <PriceChart bars={barlar} kind="line" height={220} percent precision={2} />
          </div>

          <div style={{ display: 'flex', gap: 'var(--u-s4)', flexWrap: 'wrap',
                        fontSize: 'var(--u-t-micro)', color: 'var(--u-text-3)' }}>
            <span>Dikey eksen: dönem başından yüzde değişim</span>
            <span style={{ marginLeft: 'auto' }}>
              {ilk?.t} – {son?.t} · {nokta.length} işlem günü
            </span>
          </div>

          {nokta.length < 60 && (
            <span className="u-sub" style={{ color: 'var(--u-text-4)' }}>
              Bu fonun depodaki geçmişi {nokta.length} gün — oynaklık ve
              risk-düzeltilmiş getiri gibi ölçüler bu kadar kısa geçmişle
              güvenilir değil.
            </span>
          )}
        </>
      )}
    </div>
  )
}

function Olcu({ ad, deger, alt, renk }: {
  ad: string; deger: string; alt: string; renk?: string
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      <span className="u-label">{ad}</span>
      <span className="u-num" style={{ fontSize: 'var(--u-t-num)', fontWeight: 600 }}>
        {deger}
      </span>
      <span className="u-sub" style={{ color: renk }}>{alt}</span>
    </div>
  )
}

export default FonDetay
