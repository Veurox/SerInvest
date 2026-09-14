// Görselleştirme ailesi — docs/PLAN_ARAYUZ.md §4.
// Hepsi jeton sürücülü (.ui2 kapsamında), iki temada da çalışır, SVG tabanlı.
//
// Ortak kural: GÖRSEL ÖNDE, SAYI YANINDA. Hiçbiri kesin değerin yerine
// geçmiyor; hepsi değeri ölçeğiyle/eşiğiyle birlikte veriyor.
export { Gauge } from './Gauge'
export type { GaugeBolge } from './Gauge'
export { DotStrip } from './DotStrip'
export { Donut } from './Donut'
export type { DonutDilim } from './Donut'
export { BarWithRef } from './BarWithRef'
export { MiniLine } from './MiniLine'
export { PriceBarriers } from './PriceBarriers'
export { ContribBars } from './ContribBars'
export { ReliabilityCurve } from './ReliabilityCurve'
export { OutcomeStrip } from './OutcomeStrip'
export { IntervalBar } from './IntervalBar'
export type { Kova } from './ReliabilityCurve'
export type { Katki } from './ContribBars'
