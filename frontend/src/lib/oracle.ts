// =============================================================================
// SerInvest — Oracle analiz listesi üzerinde saf yardımcılar
//
// `latestBySymbol` eskiden components/terminal/DecisionCenter.tsx içindeydi.
// Terminal sayfası kaldırılınca (15.09.2026) o klasörün tamamı silindi, ama
// bu fonksiyonu Çoklu Grafik hâlâ kullanıyordu — yani bir SUNUM bileşeninin
// içinde, ona ait olmayan bir kural yaşıyormuş.
//
// Sembol sayfası da aynı hesabı kendi içinde ayrıca yapıyor. İkisi bugün
// aynı sonucu veriyor; ayrı yerlerde durdukça ayrışma riski var.
// =============================================================================
import type { OracleAnalysis } from './types'

/**
 * Sembol başına EN YENİ analiz.
 *
 * Oracle günde birden çok tur üretiyor ve tablo hepsini taşıyor; ekranda
 * hangisinin gösterileceği `analyzedAt`e göre belirlenir. Bu seçim
 * yapılmazsa aynı sembol için eski bir karar gösterilebilir.
 */
export function latestBySymbol(oracle: OracleAnalysis[]): Map<string, OracleAnalysis> {
  const m = new Map<string, OracleAnalysis>()
  for (const o of oracle) {
    const prev = m.get(o.symbol)
    if (!prev || o.analyzedAt > prev.analyzedAt) m.set(o.symbol, o)
  }
  return m
}
