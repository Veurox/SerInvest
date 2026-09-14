// =============================================================================
// Piyasa ruh hali — TEK formül.
//
// docs/SAGLAMLIK_PLANI.md K2'nin aynısı: "aynı sayı iki yerde yazılı" hatası.
// Bu hesap SentimentRadar'ın içinde gömülüydü; yeni Bugün sayfası da aynı
// göstergeyi kullanacağı için buraya alındı. İki kopya olsaydı biri
// değiştiğinde diğeri sessizce eski kalırdı — ve iki ekran aynı anda farklı
// bir "ruh hali" gösterirdi.
// =============================================================================

export interface AggRow {
  entity: string
  assetType: string
  score: number          // decay-ağırlıklı sentiment [-1, +1]
  count: number
  geoCount: number
  noveltyScore: number   // yenilik×decay ağırlıklı (tekrar haber şişirmez)
  meanNovelty: number
  positiveEvents: number
  negativeEvents: number
}

/** Piyasa geneli varlıklar — ruh hali yalnız bunlardan hesaplanır. */
export const PIYASA_VARLIKLARI = ['BIST100', 'GLOBAL']

export interface RuhHali {
  /** 0-100. Veri yoksa null — 50 yazmak "nötr" gibi okunur, o bir yalan olurdu. */
  puan: number | null
  etiket: string
  haberSayisi: number
  jeopolitik: number
}

export function ruhHaliHesapla(rows: AggRow[]): RuhHali {
  const piyasa = rows.filter(r => PIYASA_VARLIKLARI.includes(r.entity))
  const haberSayisi = rows.reduce((s, r) => s + r.count, 0)
  const jeopolitik = rows.reduce((s, r) => s + r.geoCount, 0)

  if (piyasa.length === 0) {
    return { puan: null, etiket: 'veri yok', haberSayisi, jeopolitik }
  }
  const ham = piyasa.reduce((s, r) => s + (r.noveltyScore || r.score), 0) / piyasa.length
  const puan = Math.round(((ham + 1) / 2) * 100)
  return { puan, etiket: ruhHaliEtiket(puan), haberSayisi, jeopolitik }
}

export function ruhHaliEtiket(puan: number): string {
  if (puan <= 25) return 'Aşırı korku'
  if (puan <= 42) return 'Korku'
  if (puan < 58)  return 'Nötr'
  if (puan < 75)  return 'İyimser'
  return 'Açgözlülük'
}
