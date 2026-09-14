// =============================================================================
// Sonuç şeridi — geçmiş çağrılara ne olduğu, çağrı çağrı
//
// DotStrip'in çok kategorili kardeşi. Oradaki gerekçe burada da geçerli:
// "16 çağrının 6'sı hedefe" cümlesini okumak için bölme yapmak gerekiyor,
// ve 6/16 ile 60/160 aynı görünüyor. Her çağrı kendi işaretini alınca göz
// hem oranı hem kalabalığın büyüklüğünü aynı anda okuyor.
//
// SIRA KRONOLOJİK DEĞİL, SONUCA GÖRE GRUPLU. Zaman ekseni burada bir şey
// anlatmıyordu (çağrılar üst üste binen pencerelerde, ardışık iki işaret
// büyük ölçüde aynı fiyat hareketi); gruplama ise oranı tek bakışta veriyor.
// Zaman sırası isteyen için altındaki çağrı listesi var.
//
// BEKLEYENLER DE ÇİZİLİYOR. Sonucu belli olmayan çağrıyı gizlemek, sicili
// olduğundan kesin gösterirdi: "16 sonuç" ile "16 sonuç + 9 bekleyen" aynı
// şey değil.
// =============================================================================
import type { Sonuc } from '../../lib/sicil'

const RENK: Record<Sonuc, string> = {
  hedef:    'var(--u-up)',
  stop:     'var(--u-down)',
  ortada:   'var(--u-flat)',
  bekliyor: 'var(--viz-track)',
}

export const SONUC_AD: Record<Sonuc, string> = {
  hedef:    'hedefe değdi',
  stop:     'stopa değdi',
  ortada:   'ikisine de değmedi',
  bekliyor: 'sonucu bekleniyor',
}

/** Çizim sırası: iyi → kötü → belirsiz → bilinmiyor. */
const SIRA: Sonuc[] = ['hedef', 'stop', 'ortada', 'bekliyor']

export function OutcomeStrip({
  sayilar, genislik = 260, yukseklik = 26, bosluk = 2,
}: {
  sayilar: Record<Sonuc, number>
  genislik?: number
  yukseklik?: number
  bosluk?: number
}) {
  const toplam = SIRA.reduce((t, s) => t + (sayilar[s] || 0), 0)

  if (toplam === 0) {
    return (
      <div style={{ width: '100%', maxWidth: genislik, height: yukseklik,
                    borderRadius: 'var(--u-r-sm)', background: 'var(--viz-track)' }}
           role="img" aria-label="Bu hissede kayıtlı çağrı yok" />
    )
  }

  const etiket = SIRA.filter(s => sayilar[s] > 0)
    .map(s => `${sayilar[s]} ${SONUC_AD[s]}`).join(', ')

  // Çağrı başına düşen genişlik okunmaz hâle gelirse tek tek çizmeyi bırakıp
  // oransal bloklara geçiyoruz — yüzlerce ince çizgi gri bir lekedir.
  const birim = genislik / toplam
  const tekTek = birim >= 3.5

  let x = 0
  const parcalar: Array<{ x: number; g: number; renk: string }> = []
  for (const s of SIRA) {
    const n = sayilar[s] || 0
    if (n === 0) continue
    if (tekTek) {
      for (let i = 0; i < n; i++) {
        parcalar.push({ x, g: Math.max(1, birim - bosluk), renk: RENK[s] })
        x += birim
      }
    } else {
      parcalar.push({ x, g: Math.max(1, n * birim - bosluk), renk: RENK[s] })
      x += n * birim
    }
  }

  return (
    <svg viewBox={`0 0 ${genislik} ${yukseklik}`} width="100%"
         style={{ maxWidth: genislik, height: yukseklik, display: 'block' }}
         role="img" aria-label={etiket}>
      {parcalar.map((p, i) => (
        <rect key={i} x={p.x} y={0} width={p.g} height={yukseklik}
              rx={Math.min(2, p.g / 2)} fill={p.renk} />
      ))}
    </svg>
  )
}

export default OutcomeStrip
