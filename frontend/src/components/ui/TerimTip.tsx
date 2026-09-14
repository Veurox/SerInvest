// =============================================================================
// SerInvest — Terim İpucu
//
// Ekrandaki kısaltmanın üstüne gelince kısa bir açıklama açar. İçerik
// lib/terimler.ts'te; burası yalnız sunum.
//
// NEDEN PORTAL (mevcut Tooltip yerine)
//   Mevcut `Tooltip` mutlak konumlu ve kapsayıcısının içinde kalıyor. Bu
//   terimlerin geçtiği yerlerin çoğu KIRPAN kapsayıcılar: `.sym-drawer`
//   (overflow-y:auto), tarayıcı tablosu (maxHeight + scroll), grafik paneli.
//   Oralarda mutlak konumlu bir ipucu kesilir — yani tam ihtiyaç duyulan
//   yerde görünmez. Portal + sabit konum bu sınıfın tamamını çözüyor.
//
// Ekranda dar yer olduğunda ipucu kendini yukarı/aşağı çevirir ve yatayda
// pencere içine sıkıştırılır; küçük ekranda taşmaz.
//
// PORTALIN BEDELİ: KAPSAM KAYBI
// <body> altına basmak, kutuyu yeni arayüzün `.ui2` kapsamının DIŞINA da
// çıkarıyordu. Sonuç: sayfa Space Grotesk ve sıcak paletteyken açılan
// balon eski Inter fontu ve mavi-gri paletle çiziliyordu — üstelik tam da
// finansal okuryazarlığı olmayan birine yardım etmesi beklenen yerde,
// "buraya ait değil" diye okunan bir kutu.
//
// Çözüm: tetikleyici `.ui2` içindeyse kutu da o sınıfı alıyor. Tespit
// kapsamdan yapılıyor, sabit bir bayraktan değil; henüz taşınmamış
// sayfalarda (Haberler, Çoklu Grafik) balon eski diliyle kalıyor, yani
// her sayfa kendi diline uygun ipucu gösteriyor.
// =============================================================================
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { terimBul } from '../../lib/terimler'

const GENISLIK = 300      // ipucu kutusunun azami genişliği (px)
const BOSLUK = 8          // tetikleyici ile kutu arası

interface Konum { x: number; y: number; ust: boolean }

export function TerimTip({ ad, children }: { ad: string; children?: ReactNode }) {
  const terim = terimBul(ad)
  const ref = useRef<HTMLSpanElement>(null)
  const [konum, setKonum] = useState<Konum | null>(null)
  /** Tetikleyici yeni arayüzün kapsamında mı? Balon aynı dili konuşsun. */
  const [yeniDil, setYeniDil] = useState(false)
  const id = useId()

  const ac = useCallback(() => {
    const el = ref.current
    if (!el) return
    setYeniDil(!!el.closest('.ui2'))
    const r = el.getBoundingClientRect()
    // Aşağıda yer yoksa yukarı çevir. 200px, en uzun metnin kabaca yüksekliği.
    const ust = r.bottom + 200 > window.innerHeight && r.top > 200
    const yari = GENISLIK / 2
    const x = Math.min(Math.max(r.left + r.width / 2, yari + 8),
                       window.innerWidth - yari - 8)
    setKonum({ x, y: ust ? r.top - BOSLUK : r.bottom + BOSLUK, ust })
  }, [])

  const kapat = useCallback(() => setKonum(null), [])

  // Sayfa kayarsa ipucu havada asılı kalmasın.
  useEffect(() => {
    if (!konum) return
    window.addEventListener('scroll', kapat, true)
    window.addEventListener('resize', kapat)
    return () => {
      window.removeEventListener('scroll', kapat, true)
      window.removeEventListener('resize', kapat)
    }
  }, [konum, kapat])

  // Sözlükte yoksa sessizce düz metin göster — eksik açıklama, yanlış
  // açıklamadan iyidir.
  if (!terim) return <>{children ?? ad}</>

  return (
    <>
      <span
        ref={ref}
        className="terim"
        tabIndex={0}
        aria-describedby={konum ? id : undefined}
        onMouseEnter={ac}
        onMouseLeave={kapat}
        onFocus={ac}
        onBlur={kapat}
        onKeyDown={e => { if (e.key === 'Escape') kapat() }}
      >
        {children ?? ad}
      </span>

      {konum && createPortal(
        <span
          id={id}
          className={`terim-pop${yeniDil ? ' ui2' : ''}`}
          role="tooltip"
          style={{
            left: konum.x,
            top: konum.y,
            transform: `translate(-50%, ${konum.ust ? '-100%' : '0'})`,
            width: GENISLIK,
          }}
        >
          <b className="terim-pop__baslik">{terim.baslik}</b>
          <span className="terim-pop__satir">{terim.ozet}</span>
          <span className="terim-pop__satir">
            <b>Nasıl okunur:</b> {terim.nasil}
          </span>
          {terim.uyari && (
            <span className="terim-pop__uyari">{terim.uyari}</span>
          )}
        </span>,
        document.body,
      )}
    </>
  )
}

export default TerimTip
