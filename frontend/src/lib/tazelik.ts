// =============================================================================
// SerInvest — Fiyat verisi ne kadar taze, analizle uyumlu mu?
//
// NEDEN VAR (16.09.2026)
// Kullanıcı programı akşam 21:22'de açtı. Ölçülen sıra şuydu:
//
//   21:22:46  oracle başladı, analizi HEMEN başlattı
//   21:23:16  analizler yazılmaya başladı   ← bugünün kapanışıyla
//   21:24:31  market-data fiyatları ancak yayınladı ← ekran ancak şimdi güncel
//
// Yani 1 dakika 45 saniye boyunca Sembol sayfası şunu gösterdi:
//   Fiyat:        127,80  (dünkü — veritabanından)
//   Hedef / Stop: 120,90 üzerinden hesaplanmış (bugünkü — oracle'dan)
//
// Hedef, ekrandaki fiyatın ALTINDA görünebiliyordu. Karar doğru
// hesaplanmıştı; ekranda iki farklı güne ait sayı yan yana duruyordu ve
// bunu söyleyen hiçbir şey yoktu.
//
// KÖK: aynı olguyu iki bağımsız kaynak çekiyor (oracle kendi yfinance
// çağrısını yapıyor, market-data kendi) ve aralarında tutarlılık kontrolü
// yok. İki dakika ayrıştılar, kullanıcı fark etti.
//
// NEDEN "FARK VARSA UYAR" DEĞİL
// Seans sürerken ekrandaki canlı fiyatla analizin baktığı kapanışın FARKLI
// olması normaldir — hata değil. Ölçülmesi gereken fark değil, SIRA:
// fiyat verisi analizden ESKİ mi? Öyleyse ekran geçmişi gösteriyordur.
// =============================================================================

/** Fiyat verisi bu kadar dakikadan eskiyse söylenir. Döngü 5 dakikada bir. */
export const BAYAT_DK = 15

export interface TazelikDurumu {
  /** Fiyat verisinin yaşı (dakika); okunamazsa null */
  yasDk: number | null
  /** Fiyat, analizden ÖNCE kaydedilmiş mi — asıl kusur bu */
  analizdenEski: boolean
  /** Gösterilecek uyarı; sorun yoksa null */
  mesaj: string | null
}

const dk = (a: number, b: number) => Math.round((a - b) / 60000)

const zaman = (s: string | null | undefined): number | null => {
  if (!s) return null
  // Arka uç UTC gönderiyor ama bazı alanlarda 'Z' eki yok; eklemezsek
  // tarayıcı yerel saat sanar ve yaş 3 saat kayar.
  const t = Date.parse(/[Zz]|[+-]\d\d:?\d\d$/.test(s) ? s : s + 'Z')
  return Number.isFinite(t) ? t : null
}

/**
 * Ekrandaki fiyat güvenilir mi?
 *
 * @param recordedAt  fiyat satırının kaydedilme anı (market-data)
 * @param analyzedAt  analizin üretilme anı (oracle) — yoksa sıra kontrolü atlanır
 * @param simdi       şimdi (test için enjekte edilebilir)
 */
export function tazelikDurumu(
  recordedAt: string | null | undefined,
  analyzedAt: string | null | undefined,
  simdi: number = Date.now(),
): TazelikDurumu {
  const kayit = zaman(recordedAt)
  const analiz = zaman(analyzedAt)

  if (kayit == null) {
    return { yasDk: null, analizdenEski: false, mesaj: null }
  }

  const yasDk = dk(simdi, kayit)

  // Sıra kontrolü: fiyat analizden eskiyse ekran geçmişi gösteriyor demektir.
  // Bir dakikalık tolerans var — iki servis aynı anda koşarken saniyelik
  // salınım normaldir, onu kusur diye göstermek gürültü olurdu.
  const analizdenEski = analiz != null && kayit < analiz - 60_000

  if (analizdenEski) {
    return {
      yasDk,
      analizdenEski: true,
      mesaj: 'Ekrandaki fiyat, modelin analiz ettiği andan daha eski — '
           + 'fiyat verisi henüz güncellenmemiş. Hedef ve stop analiz '
           + 'anındaki fiyattan hesaplandı.',
    }
  }

  if (yasDk >= BAYAT_DK) {
    return {
      yasDk,
      analizdenEski: false,
      mesaj: `Fiyat verisi ${sureYaz(yasDk).replace(' önce', '')} eski — piyasa verisi servisi `
           + 'geride kalmış olabilir.',
    }
  }

  return { yasDk, analizdenEski: false, mesaj: null }
}

// ── Fiyat LİSTESİ bayat mı? (28.09.2026) ────────────────────────────────────
//
// Program açılınca ekran fiyatı HEMEN istiyor; o an veritabanında hâlâ
// makinenin kapandığı günün fiyatları var (taze fiyatın gelmesi ~2 dk).
// Sonraki yenileme borsa kapalıyken 5 DAKİKA sonraydı. Ölçüldü: taze fiyat
// 19:13:47'de geldi, ekran 19:17'ye kadar eskisini gösterdi — izleme
// listesinde de sembol listesinde de. Açılışta toplam ~7 dk eski fiyat.
//
// Çözüm iki parça: (1) liste bayatken ekran sık sorar, tazelenince normal
// aralığa döner (App.tsx); (2) bayatken bunu SÖYLER (izleme listesi başlığı).

/** En yeni fiyat kaydının zamanı (ms, UTC); hiç okunamazsa null. */
export function enYeniKayit(varliklar: { recordedAt?: string | null }[]): number | null {
  let enYeni: number | null = null
  for (const v of varliklar) {
    const t = zaman(v.recordedAt)
    if (t != null && (enYeni == null || t > enYeni)) enYeni = t
  }
  return enYeni
}

/**
 * Listedeki EN YENİ fiyat bile bayatsa liste bayattır.
 * Tek tek sembolün eski olması normal (işlemi durmuş hisse); hepsinin eski
 * olması ise verinin henüz gelmediği ya da servisin durduğu anlamına gelir.
 */
export function fiyatlarBayat(
  varliklar: { recordedAt?: string | null }[], simdi: number = Date.now(),
): boolean {
  const t = enYeniKayit(varliklar)
  return t != null && dk(simdi, t) >= BAYAT_DK
}

/**
 * Dakikayı okunur süreye çevirir: "12 dk önce", "3 sa önce", "3 gün önce".
 * Eskiden rozet "4320 dk önce" yazacaktı — makine hafta sonu kapalı
 * kaldığında tam olarak bu oluyor.
 */
export function sureYaz(dakika: number | null): string {
  if (dakika == null) return '—'
  if (dakika < 60) return `${dakika} dk önce`
  if (dakika < 60 * 24) return `${Math.round(dakika / 60)} sa önce`
  return `${Math.round(dakika / (60 * 24))} gün önce`
}
