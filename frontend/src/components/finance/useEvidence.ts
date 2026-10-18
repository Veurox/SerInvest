// =============================================================================
// SerInvest — Model kanıtı (/admin/model-evidence) — paylaşılan hook
// ModelEvidence.tsx'ten ayrıldı (18.10.2026): bileşen dosyası yalnız bileşen
// dışa açarsa hızlı yenileme (HMR) güvenilir çalışır.
// =============================================================================
import { useEffect, useState } from 'react'
import { ADMIN, adminFetch } from '../../lib/api'

export interface Evidence {
  measured: boolean
  n_oos?: number; n_days?: number; date_range?: [string, string]
  ranking?: { spearman: number | null; t: number | null; proven: boolean }
  risk_filter?: {
    baseline_sharpe: number | null; lowvol_sharpe: number | null
    n_periods: number; sharpe_se: number | null; proven: boolean
  }
}

// Modül düzeyi önbellek — banner birden çok sayfada kullanılıyor.
let cache: Evidence | null = null

export function useEvidence(): Evidence | null {
  const [e, setE] = useState<Evidence | null>(cache)
  useEffect(() => {
    if (cache) return
    adminFetch(`${ADMIN}/model-evidence`)
      .then(r => r.ok ? r.json() : null)
      .then(j => { if (j) { cache = j; setE(j) } })
      .catch(() => {})
  }, [])
  return e
}
