// =============================================================================
// SerInvest — bir sembolün grafik barları (/market/{sembol}/chart?tf=…)
//
// NEDEN ORTAK (18.10.2026)
// Çoklu grafik hücresi (ChartTile) ve fiyat-bariyer grafiği (PriceBarriers)
// aynı isteği aynı biçimde yapıyor, ikisi de efektin içinde "yükleniyor"
// durumunu elle sıfırlıyordu. Artık sonuç hangi istekten geldiğini (anahtar)
// taşır; yükleniyor/hata ondan TÜRETİLİR. Yeni sembol ya da aralık yüklenirken
// önceki grafik ekranda kalır — eskiden de öyleydi; hata ise yalnız güncel
// isteğe aittir.
// =============================================================================
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { API } from './api'
import type { Bar } from './bars'

interface Cevap { symbol?: string; points?: Bar[]; error?: string }

export interface GrafikVerisi {
  bars: Bar[]
  yukleniyor: boolean
  hata: string | null
}

const BOS: Bar[] = []

/**
 * @param onYuklendi  veri geldiğinde bir kez çağrılır (ör. üst bileşene barları
 *                    bildirmek için). Kimliği değişse de istek yinelenmez.
 */
export function useGrafikVerisi(sembol: string, tf: string,
                                onYuklendi?: (bars: Bar[]) => void): GrafikVerisi {
  const anahtar = `${sembol}:${tf}`
  const [sonuc, setSonuc] = useState<{ anahtar: string; bars: Bar[]; hata: string | null } | null>(null)
  const cb = useRef(onYuklendi)
  useLayoutEffect(() => { cb.current = onYuklendi })

  useEffect(() => {
    let dur = false
    fetch(`${API}/market/${encodeURIComponent(sembol)}/chart?tf=${tf}`)
      .then(r => r.json())
      .then((j: Cevap) => {
        if (dur) return
        if (j.error || !j.points?.length) {
          setSonuc({ anahtar, bars: BOS, hata: j.error || 'veri yok' })
        } else {
          setSonuc({ anahtar, bars: j.points, hata: null })
          cb.current?.(j.points)
        }
      })
      .catch(e => { if (!dur) setSonuc({ anahtar, bars: BOS, hata: String(e) }) })
    return () => { dur = true }
  }, [anahtar, sembol, tf])

  const guncel = sonuc?.anahtar === anahtar ? sonuc : null
  return {
    bars: guncel ? guncel.bars : (sonuc?.bars ?? BOS),
    yukleniyor: guncel == null,
    hata: guncel?.hata ?? null,
  }
}
