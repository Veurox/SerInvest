// =============================================================================
// SerInvest — Piyasa açık mı? Tek kaynak: arka uç takvimi (takvim.py)
//
// NEDEN (18.10.2026)
// Arayüz kendi hesabını yapıyordu: hafta içi 10:00–18:00, tatil YOK. Arka uç
// ise tatil ve arife yarım günlerini biliyor. 29 Ekim'de ekran "Piyasa açık"
// diyecek, arifede öğleden sonra da açık sanacaktı. Artık arka uca soruyor;
// ağ yoksa yerel hesaba düşüyor (kaynak: 'yerel').
// =============================================================================
import { useEffect, useState } from 'react'
import { ADMIN, adminFetch } from './api'
import { isMarketOpen } from './format'

export interface PiyasaDurumu {
  /** Şu an işlem sürüyor mu (kapanış seansı dahil) */
  islem: boolean
  /** Kapalıysa nedeni: "Hafta sonu", "Tatil: …", "Seans dışı", "Yarım gün: …" */
  sebep: string | null
  kaynak: 'sunucu' | 'yerel'
}

const yerel = (): PiyasaDurumu => ({ islem: isMarketOpen(), sebep: null, kaynak: 'yerel' })

export async function piyasaSor(): Promise<PiyasaDurumu> {
  try {
    const r = await adminFetch(`${ADMIN}/piyasa`)
    if (!r.ok) return yerel()
    const d = await r.json()
    return { islem: !!d.islem, sebep: d.sebep ?? null, kaynak: 'sunucu' }
  } catch {
    return yerel()
  }
}

/** Dakikada bir tazelenen piyasa durumu. */
export function usePiyasa(aralikMs = 60_000): PiyasaDurumu {
  const [d, setD] = useState<PiyasaDurumu>(yerel)
  useEffect(() => {
    let iptal = false
    const yukle = () => { piyasaSor().then(x => { if (!iptal) setD(x) }) }
    yukle()
    const t = setInterval(yukle, aralikMs)
    return () => { iptal = true; clearInterval(t) }
  }, [aralikMs])
  return d
}
