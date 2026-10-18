// =============================================================================
// SerInvest — Eşiklerin tek kaynağı (frontend tarafı)
// docs/SAGLAMLIK_PLANI.md K2: "aynı sayı iki yerde yazılı".
//
// 08/2026'da arayüzde "77/30" ve "600/200" yazıyordu; backend eşikleri
// değişince metinler güncellenmedi ve kullanıcıya YANLIŞ bilgi gösterildi.
// Artık sayılar `/admin/config`ten gelir. Buradaki DEFAULTS yalnızca ilk
// render / servis kapalı hâli içindir — ml/config.py ile aynı olmalıdır.
// =============================================================================
import { useEffect, useState } from 'react'
import { ADMIN, adminFetch } from './api'

export interface AppConfig {
  model: {
    horizon_days: number; buy_threshold: number; strong_buy_p: number
    tp_atr_mult: number; sl_atr_mult: number
    transaction_cost_pct: number; kelly_fraction: number
  }
  evaluation:  { min_age_days: number }
  drift:       { min_rows: number; min_days: number; psi_watch: number; psi_alert: number }
  calibration: { min_required: number; min_days: number }
  meta:        { min_samples: number; min_auc: number; veto_p: number }
  promotion:   { min_edge: number; min_samples: number; min_precision: number
                 min_fresh_days: number; windows: number }
  jobs:        { overdue_hours: Record<string, number> }
  /** Faz A — kural docs/PLAN_2026-08.md §A0'da önceden çivilendi. */
  risk_filter: {
    on: boolean; top_pct: number; min_symbols: number
    coverage_target: [number, number]
    criteria: string[]; decision_date: string
    /** Sharpe farkı 1 standart hatanın içinde — bugün kanıtlanmış DEĞİL. */
    proven: boolean
  }
  schedule:    { cycle_min: number; close_scan: string; evaluate: string
                 health: string; selftest: string; promote: string }
}

export const DEFAULTS: AppConfig = {
  model: { horizon_days: 10, buy_threshold: 0.58, strong_buy_p: 0.65,
           tp_atr_mult: 3, sl_atr_mult: 2, transaction_cost_pct: 0.002, kelly_fraction: 0.25 },
  evaluation:  { min_age_days: 20 },
  drift:       { min_rows: 200, min_days: 20, psi_watch: 0.10, psi_alert: 0.25 },
  calibration: { min_required: 150, min_days: 10 },
  meta:        { min_samples: 300, min_auc: 0.55, veto_p: 0.40 },
  promotion:   { min_edge: 0.02, min_samples: 200, min_precision: 0.50,
                 min_fresh_days: 30, windows: 3 },
  jobs:        { overdue_hours: { analyze: 4, evaluate: 36, health: 36, promote: 192 } },
  risk_filter: { on: true, top_pct: 0.30, min_symbols: 20,
                 coverage_target: [0.20, 0.40],
                 criteria: ['düşük oynaklık (atr_pct)', '52h zirveye yakınlık'],
                 decision_date: '2027-02-12', proven: false },
  schedule:    { cycle_min: 30, close_scan: '18:10', evaluate: '19:00',
                 health: '19:20', selftest: '19:25', promote: 'Pazar 20:00' },
}

// Modül düzeyi önbellek — her bileşen ayrı istek atmasın.
let cache: AppConfig | null = null
let inflight: Promise<AppConfig> | null = null
const subs = new Set<(c: AppConfig) => void>()

function fetchConfig(): Promise<AppConfig> {
  if (cache) return Promise.resolve(cache)
  if (inflight) return inflight
  inflight = adminFetch(`${ADMIN}/config`)
    .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
    .then((j: Partial<AppConfig>) => {
      // Backend yeni bir alan eklemediyse DEFAULTS'tan tamamla (kısmi birleştirme).
      const merged = { ...DEFAULTS } as AppConfig
      for (const k of Object.keys(DEFAULTS) as (keyof AppConfig)[]) {
        if (j[k]) (merged as unknown as Record<string, object>)[k] = { ...(DEFAULTS[k] as object), ...(j[k] as object) }
      }
      cache = merged
      subs.forEach(f => f(merged))
      return merged
    })
    .catch(() => DEFAULTS)          // servis kapalıysa sessizce varsayılan
    .finally(() => { inflight = null })
  return inflight
}

/** Eşikleri okur. Servis yanıt verene kadar DEFAULTS döner (asla undefined değil). */
export function useConfig(): AppConfig {
  const [cfg, setCfg] = useState<AppConfig>(() => cache ?? DEFAULTS)
  useEffect(() => {
    let alive = true
    const onUpdate = (c: AppConfig) => { if (alive) setCfg(c) }
    subs.add(onUpdate)
    fetchConfig().then(onUpdate)
    return () => { alive = false; subs.delete(onUpdate) }
  }, [])
  return cfg
}
