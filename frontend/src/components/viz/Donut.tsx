// =============================================================================
// Halka — parçanın bütüne oranı. Pasta grafiğin MEŞRU kullanım alanı.
//
// NEREDE DOĞRU (PLAN_ARAYUZ.md §4)
//   • Portföy dağılımı (sektör, varlık türü)
//   • 96 sembolün sinyal dağılımı (AL / TUT / SAT)
//   • Fon kategorileri
//   • Haber duyarlılığı payları
//
// NEREDE YANLIŞ — bu bileşen oralarda KULLANILMAZ
//   Büyüklük karşılaştırması, zaman içinde değişim, sıralama. Göz açıyı kötü
//   okur; birbirine yakın iki dilim ayırt edilemez. Onlar için çubuk, şerit
//   ya da çizgi var.
//
// Halka (delikli) tercih edildi: ortadaki boşluk toplamı yazmaya yer açıyor,
// ve ince halka açıdan çok YAY UZUNLUĞU okutuyor — göz uzunlukta daha iyi.
// Dilim sayısı 6'yı geçerse okunaksızlaşır; fazlası "Diğer"de toplanır.
// =============================================================================
import { useId } from 'react'

export interface DonutDilim {
  ad: string
  deger: number
  renk?: string
}

const SERI = ['var(--viz-1)', 'var(--viz-2)', 'var(--viz-3)',
              'var(--viz-4)', 'var(--viz-5)', 'var(--viz-6)']

const AZAMI_DILIM = 6

function yay(cx: number, cy: number, r: number, d1: number, d2: number) {
  const p = (d: number) => {
    const a = ((d - 90) * Math.PI) / 180
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
  }
  const [x1, y1] = p(d1)
  const [x2, y2] = p(d2)
  return `M ${x1} ${y1} A ${r} ${r} 0 ${d2 - d1 > 180 ? 1 : 0} 1 ${x2} ${y2}`
}

export function Donut({
  dilimler, boyut = 128, ortaUst, ortaAlt, lejant = true,
}: {
  dilimler: DonutDilim[]
  boyut?: number
  /** Halkanın ortasındaki büyük değer (verilmezse toplam) */
  ortaUst?: string
  ortaAlt?: string
  lejant?: boolean
}) {
  const id = useId()
  const gecerli = dilimler.filter(d => d.deger > 0)
  const toplam = gecerli.reduce((t, d) => t + d.deger, 0)

  // Altıdan fazlası okunmuyor: küçükler "Diğer"de toplanıyor.
  const sirali = [...gecerli].sort((a, b) => b.deger - a.deger)
  const gosterilen: DonutDilim[] = sirali.length > AZAMI_DILIM
    ? [...sirali.slice(0, AZAMI_DILIM - 1), {
        ad: 'Diğer',
        deger: sirali.slice(AZAMI_DILIM - 1).reduce((t, d) => t + d.deger, 0),
        renk: 'var(--u-flat)',
      }]
    : sirali

  const cx = boyut / 2
  const cy = boyut / 2
  const kalinlik = Math.max(10, Math.round(boyut * 0.155))
  const r = cx - kalinlik / 2 - 1

  let aci = 0
  const yaylar = gosterilen.map((d, i) => {
    const pay = toplam > 0 ? d.deger / toplam : 0
    const d1 = aci
    // Dilimler arasında ince bir boşluk: kenarları ayırmak için 1.2°
    const d2 = aci + pay * 360
    aci = d2
    return {
      ...d,
      pay,
      yol: yay(cx, cy, r, d1 + (pay < 0.02 ? 0 : 0.6), Math.max(d1 + 0.4, d2 - 0.6)),
      renk: d.renk ?? SERI[i % SERI.length],
    }
  })

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--u-s4)' }}>
      <svg width={boyut} height={boyut} viewBox={`0 0 ${boyut} ${boyut}`} role="img"
           aria-label={gosterilen.map(d => `${d.ad} ${d.deger}`).join(', ')}
           style={{ flexShrink: 0 }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--viz-track)" strokeWidth={kalinlik} />
        <g fill="none" strokeWidth={kalinlik} strokeLinecap="butt">
          {yaylar.map((y, i) => <path key={`${id}-${i}`} d={y.yol} stroke={y.renk} />)}
        </g>
        <text x={cx} y={cy - (ortaAlt ? 2 : -4)} textAnchor="middle"
              style={{ fontFamily: 'var(--u-mono)', fontSize: boyut * 0.20,
                       fontWeight: 700, fill: 'var(--u-text)' }}>
          {ortaUst ?? toplam}
        </text>
        {ortaAlt && (
          <text x={cx} y={cy + boyut * 0.14} textAnchor="middle"
                style={{ fontSize: boyut * 0.085, fill: 'var(--u-text-3)' }}>
            {ortaAlt}
          </text>
        )}
      </svg>

      {lejant && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
          {yaylar.map((y, i) => (
            <div key={`l-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: y.renk,
                             display: 'block', flexShrink: 0 }} />
              <span style={{ fontSize: 'var(--u-t-small)', color: 'var(--u-text-2)',
                             whiteSpace: 'nowrap', overflow: 'hidden',
                             textOverflow: 'ellipsis' }}>{y.ad}</span>
              <span className="u-num" style={{ fontSize: 'var(--u-t-small)',
                                               color: 'var(--u-text-3)', marginLeft: 'auto',
                                               paddingLeft: 8, flexShrink: 0 }}>
                {y.deger} · %{Math.round(y.pay * 100)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default Donut
