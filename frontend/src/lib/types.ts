// =============================================================================
// SerInvest — Paylaşılan TypeScript tipler
// App.tsx içindeki interface tanımlarını buradan import edin.
// =============================================================================

export interface SystemStatus {
  db: string; redis: string
  market_data_service: string; tracked_assets: number
  analyst_engine: string;      news_signals: number
  oracle_service: string;      oracle_analyses: number
  last_price_update?: string;  last_oracle_update?: string
  ready: boolean
}

export interface SysLog {
  level: string; message: string; timestamp: string; accuracy: number
}

export interface PriceData {
  id: string; symbol: string; assetType: string
  close: number | null; open: number | null; high: number | null; low: number | null; volume: number | null
  rsi: number | null; macdLine: number | null; macdSignal: number | null; macdHistogram: number | null
  bbUpper: number | null; bbMiddle: number | null; bbLower: number | null
  ema9: number | null; ema20: number | null; ema50: number | null; ema200: number | null
  signal: 'BUY' | 'SELL' | 'NEUTRAL'; signalStrength: number; recordedAt: string
}

export interface NewsSignal {
  id: string; entity: string; source: string; assetType: string
  sentimentLabel: string; sentimentScore: number; isGeopolitical: boolean
  headline: string; summary: string; url: string; createdAt: string
}

export interface OracleAnalysis {
  id: string; symbol: string; assetType: string; priceAtAnalysis: number | null
  recommendation: string; confidence: number
  shortTermBias: string; shortTermTarget: number | null; shortTermStop: number | null
  positionSizePct: number | null
  riskRewardRatio: number | null
  longTermBias: string; longTermTarget: number | null
  reasoning: string; keyDrivers: string; risks: string; watchPoints: string
  technicalScore: number; newsScore: number; macroScore: number
  fundamentalScore: number
  regime?: string
  analyzedAt: string
}

export interface FundamentalData {
  id: string; symbol: string; assetType: string
  companyName: string; sector: string
  peRatio: number | null; forwardPe: number | null; pbRatio: number | null
  roe: number | null; eps: number | null; forwardEps: number | null
  ebitda: number | null; ebitdaMargin: number | null; netDebtEbitda: number | null
  tcmbRatePct: number | null
  debtToEquity: number | null; beta: number | null
  revenueGrowth: number | null; earningsGrowth: number | null
  dividendYield: number | null; marketCap: number | null; position52W: number | null
  fundamentalScore: number
  lastKapTitle: string; lastKapDate: string
  updatedAt: string
}

// ── Portföy Özeti (/api/portfolio/summary) ──────────────────────────────────
export interface AllocationSlice { symbol: string; value: number; weight: number }
export interface SectorSlice { sector: string; value: number; weight: number }
export interface PortfolioWarning { type: string; severity: string; message: string }
export interface PortfolioSummary {
  totalCost: number; totalCurrent: number
  unrealizedPnl: number; unrealizedPnlPct: number
  realizedPnl: number; totalDividends: number
  allTimePnl: number; allTimePnlPct: number; historicalCostBasis: number
  openPositionCount: number; closedPositionCount: number
  bestPosition: { symbol: string; pnl: number; pnlPct: number } | null
  worstPosition: { symbol: string; pnl: number; pnlPct: number } | null
  allocation: AllocationSlice[]
  sectorAllocation: SectorSlice[]
  warnings: PortfolioWarning[]
}

// ── Admin / MLOps ────────────────────────────────────────────────────────────
export interface PredRow {
  timestamp: string; symbol: string; predicted: string; confidence: number
  close: number; evaluated: boolean; actual: string; return: string; correct: boolean | null
  // Sonuç tablosu alanları (07/2026): "10 gün sonra ne oldu?"
  target?: number | null; stop?: number | null
  exit_price?: number | null      // 10 işlem günü sonundaki fiyat
  outcome?: string                // UP | DOWN | NEUTRAL
}

export interface PredSummary {
  total: number; evaluated: number; pending: number; correct: number
  directional: number; neutral_outcomes: number
  accuracy: number | null; buy_accuracy: number | null; sell_accuracy: number | null
  buy_n: number; sell_n: number
  top_symbols: { symbol: string; accuracy: number; n: number }[]
  worst_symbols: { symbol: string; accuracy: number; n: number }[]
}

// ── Admin & MLOps Sekmeleri ──────────────────────────────────────────────────
export interface TrainingInfo {
  walkforward?: {
    completed_at: string; n_symbols: number; n_steps: number
    n_predictions: number; overall_accuracy: number
    step_stats: { step: number; train_days: number; accuracy: number }[]
    top_symbols: { symbol: string; accuracy: number; n: number }[]
  }
  training_csv?: {
    total_rows: number; n_features: number; file_size_mb: number
    modified_at: string; label_balance: { up_pct: number; down_pct: number }
    label_counts: Record<string, number>
  }
  live_accuracy?: {
    overall: number | null; total_evaluated: number; total_correct: number; last_eval: string
    base_rate?: number | null; lift?: number | null; breakeven?: number | null; al_signals?: number
  }
  symbols?: { bist: string[]; commodity: string[]; forex: string[]; total: number }
  // Şampiyon model künyesi (champion_meta.json)
  champion?: {
    trained_at?: string; n_rows?: number; horizon?: number; buy_threshold?: number
    date_min?: string; date_max?: string; up_pct?: number; xsec_rank?: boolean
    tp_atr_mult?: number; sl_atr_mult?: number
    top_features?: { name: string; pct: number }[]
  }
}

export interface AdminStatus {
  model_loaded: boolean
  n_features: number
  n_symbols: number
  bist_count: number
  model_age_hours: number | null
  training: { running: boolean; task: string | null; started_at: string | null }
  wf_accuracy: number | null
  wf_buy_accuracy: number | null
  wf_sell_accuracy: number | null
  wf_n_predictions: number | null
  wf_completed_at: string | null
}

export interface SymbolList {
  bist: { ticker: string; yf: string }[]
  commodity: { ticker: string; yf: string }[]
  forex: { ticker: string; yf: string }[]
  total: number
}
