// =============================================================================
// Kadran — 0-100 arası tek bir değeri bölgeleriyle birlikte gösterir.
// Kullanım: piyasa ruh hali (korku ↔ açgözlülük).
//
// NEDEN KADRAN
// "37" tek başına bir şey söylemiyor: iyi mi kötü mü, nereye yakın? Kadran
// değeri ÖLÇEĞİYLE birlikte veriyor — 37'nin korku bölgesinde ve ortaya uzak
// olduğu bakınca görülüyor. Kesin değer yine de yazıyor (PLAN_ARAYUZ.md §4:
// "görsel önde, sayı yanında").
//
// Yay 180° değil 220°: yarım daire uçlarda neredeyse dikey gidiyor ve ibrenin
// 0'a mı 5'e mi baktığı ayırt edilemiyor.
// =============================================================================
import { useId } from 'react'

export interface GaugeBolge {
  /** Bölgenin bittiği değer (0-100). Sıralı verilir. */
  bit: number
  renk: string
  ad: string
}

const VARSAYILAN: GaugeBolge[] = [
  { bit: 25,  renk: 'var(--u-down)', ad: 'Aşırı korku' },
  { bit: 45,  renk: 'var(--u-down)', ad: 'Korku' },
  { bit: 55,  renk: 'var(--u-flat)', ad: 'Nötr' },
  { bit: 75,  renk: 'var(--u-up)',   ad: 'İyimser' },
  { bit: 100, renk: 'var(--u-up)',   ad: 'Açgözlülük' },
]

const YAY = 220                       // derece
// Yay TEPEYE simetrik oturur: 0° tepe olduğuna göre başlangıç 360 - YAY/2.
// İlk yazımda 270 - YAY/2 yazılmıştı; yay çeyrek tur kayıyor ve viewBox'ın
// altına taşıp kırpılıyordu — ekranda kadran gibi görünüyordu ama ibre yanlış
// yerdeydi. Geometriyi gözle doğrulamak yetmiyor, sayı ile bakmak gerekti.
const BAS = 360 - YAY / 2
const UC_SIN = Math.sin(((BAS - 90) * Math.PI) / 180)   // yay uçlarının düşey payı

function nokta(cx: number, cy: number, r: number, derece: number) {
  const a = ((derece - 90) * Math.PI) / 180
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
}

function yayYolu(cx: number, cy: number, r: number, d1: number, d2: number) {
  const [x1, y1] = nokta(cx, cy, r, d1)
  const [x2, y2] = nokta(cx, cy, r, d2)
  const buyuk = d2 - d1 > 180 ? 1 : 0
  return `M ${x1} ${y1} A ${r} ${r} 0 ${buyuk} 1 ${x2} ${y2}`
}

export function Gauge({
  deger, etiket, bolgeler = VARSAYILAN, genislik = 172,
}: {
  /** 0-100 */
  deger: number | null
  /** Değerin altında yazan bölge adı; verilmezse bölgelerden bulunur */
  etiket?: string
  bolgeler?: GaugeBolge[]
  genislik?: number
}) {
  const id = useId()
  // Ölçüler GEOMETRİDEN türetiliyor, göz kararı katsayıdan değil: yayın en
  // alt noktası (uçlar) ve çizgi kalınlığı viewBox'a tam sığsın.
  const w = genislik
  const cx = w / 2
  const r = w * 0.40
  const kalinlik = Math.max(7, Math.round(w * 0.055))
  const cy = r + kalinlik / 2 + 1
  const h = Math.ceil(cy + r * UC_SIN + kalinlik / 2 + 1)

  const v = deger == null ? null : Math.max(0, Math.min(100, deger))
  const bolge = v == null ? null
    : bolgeler.find(b => v <= b.bit) ?? bolgeler[bolgeler.length - 1]
  const ad = etiket ?? bolge?.ad ?? ''

  // Veri yoksa boş kadran + açık "veri yok" — sıfır çizmek yalan olurdu.
  const ibre = v == null ? null : BAS + (v / 100) * YAY

  // Her dilim bir öncekinin bittiği yerden başlar — dış değişken yok.
  const diller = bolgeler.map((b, i) => {
    const onceki = i > 0 ? bolgeler[i - 1].bit : 0
    const d1 = BAS + (onceki / 100) * YAY
    const d2 = BAS + (b.bit / 100) * YAY
    return { yol: yayYolu(cx, cy, r, d1, d2), renk: b.renk, ad: b.ad }
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img"
           aria-label={v == null ? 'Veri yok' : `${v} · ${ad}`}>
        <g strokeWidth={kalinlik} strokeLinecap="butt" fill="none">
          {diller.map((d, i) => (
            <path key={i} d={d.yol} stroke={d.renk} opacity={v == null ? 0.18 : 0.30} />
          ))}
          {/* Değerin bulunduğu dilim tam opaklıkta — göz oraya gitsin */}
          {v != null && bolge && (
            <path d={diller[bolgeler.indexOf(bolge)].yol} stroke={bolge.renk} opacity={1} />
          )}
        </g>

        {ibre != null && (() => {
          const [ix, iy] = nokta(cx, cy, r + kalinlik * 0.95, ibre)
          const [jx, jy] = nokta(cx, cy, r - kalinlik * 0.95, ibre)
          return (
            <g key={id}>
              <line x1={jx} y1={jy} x2={ix} y2={iy}
                    stroke="var(--u-text)" strokeWidth={3} strokeLinecap="round" />
            </g>
          )
        })()}

        <text x={cx} y={cy + r * 0.16} textAnchor="middle"
              style={{ fontFamily: 'var(--u-mono)', fontSize: w * 0.20,
                       fontWeight: 700, fill: v == null ? 'var(--u-text-4)' : 'var(--u-text)' }}>
          {v == null ? '—' : Math.round(v)}
        </text>
      </svg>
      {ad && (
        <span style={{ fontSize: 'var(--u-t-small)', fontWeight: 600,
                       color: bolge?.renk ?? 'var(--u-text-3)' }}>{ad}</span>
      )}
    </div>
  )
}

export default Gauge
