# TEFAS Fonları — Keşif ve Karşılaştırma Planı

**Tarih:** 11.09.2026 · **Kapsam kararı:** kullanıcı (fon keşfi/karşılaştırma, belirli kategoriler)
**Durum:** Faz 0 (fizibilite) TAMAMLANDI — API doğrulandı, veri geldi

> Bu dosyanın amacı, TEFAS entegrasyonunun neden hisse hattının kopyası
> OLAMAYACAĞINI ve bunun yerine ne yapılacağını kayda geçirmek.

---

## 0. Amaç ve kapsam

**Amaç:** fon keşfi ve karşılaştırma. "Hangi kategoriler iyi gidiyor, bu fon
akranlarına göre nerede, ne tutuyor, ücreti getirisini ne kadar yiyor?"

**Kapsam DIŞI:** fonlar için AL/SAT tahmini. Gerekçe §5'te.

**Kategoriler** (TEFAS `sfonTurKod` ile doğrulandı):

| Kod | Kategori | Neden bu |
|---|---|---|
| 104 | Hisse Senedi Şemsiye Fonu | Projenin BIST odağıyla doğrudan bağlantılı |
| 105 | Kıymetli Madenler | Türkiye'de en yaygın alternatif; altın zaten sistemde |
| 101 | Değişken | Portföy dağılımı verisi burada en bilgilendirici |
| 107 | Para Piyasası | **Kıyas eşiği** — bkz. §4 |

---

## 1. Neden hisse hattının kopyası olamaz

Üç yapısal fark. Bunlar tercih değil, veri ve piyasa mekaniğinin sonucu.

### 1.1 Veri şekli — ölçüldü

TEFAS günde **tek bir birim pay değeri** yayımlar. Ne açılış/yüksek/düşük ne hacim.

20 özelliğin **18'i** yalnız kapanışla hesaplanabiliyor — sorun orada değil:

| Durum | Özellikler |
|---|---|
| Kapanış yeter (18) | rsi, rsi_slope, macd_hist, macd_hist_slope, bb_pct, bb_width, ema9_diff, ema20_diff, ema_alignment, above_ema200, ema200_trend, dist_ema50_z, ret_5d, ret_20d, ret_consistency, price_vs_52w_high, rel_strength_5d, rel_strength_20d |
| **Hesaplanamaz (2)** | `atr_pct` (High/Low ister), `vol_ratio` (hacim ister) |

Asıl kırılma **etiketlemede**: triple-barrier "TP'ye mi SL'ye mi önce değdi"
sorusunu sorar ve bu **gün-içi High/Low** ister. Fonda yok. Yani modelin kalbi
olan etiketleme bu hâliyle çalışmaz.

### 1.2 Emir körlemesine verilir

Hisse alırken fiyatı görürsün. Fonda emri verirsin, **henüz açıklanmamış** bir
birim pay değerinden gerçekleşir. Karar anında giriş fiyatı bilinmiyor — hisse
tarafında olmayan bir noktasal-zamanlılık sorunu.

> Kesim saatleri ve valör fon türüne göre değişir. Ezberden yazılmayacak; her
> fon için TEFAS/KAP'tan doğrulanacak.

### 1.3 Stop kurulamaz

Sistemin karar çıktısının tamamı "hedef X, stop Y, R:R 1.5". Fonda gün içi stop
yoktur. Yani mevcut karar formatı fona **uygulanamaz**.

**Sonuç:** hisse hattını fona kopyalamak, ekranda uygulanabilir görünen ama
uygulanamayan sayılar üretirdi. Bu, projenin en pahalıya öğrendiği hatanın
(ölçümün desteklemediği iddia) tekrarı olurdu.

---

## 2. Faz 0 — Fizibilite (TAMAMLANDI 11.09.2026)

Kod yazmadan önce API'nin gerçekten çalıştığı doğrulandı. Eski `.aspx` hattı
ölmüş; site Next.js'e geçmiş ve uç noktalar değişmiş.

### Doğrulanmış API sözleşmesi

**Uç nokta:** `POST https://www.tefas.gov.tr/api/funds/fonGnlBlgSiraliGetir`
(eski `api/DB/BindHistoryInfo` artık **404**)

**Yük (JSON):**
```json
{
  "fonTipi": "YAT",          // yatırım fonu
  "fonKodu": null,           // tek fon istenirse kodu
  "aramaMetni": null,
  "fonTurKod": null,
  "fonGrubu": null,
  "sfonTurKod": "104",       // şemsiye fon türü (kategori)
  "basTarih": "20260901",    // YYYYMMDD
  "bitTarih": "20260905",
  "basSira": 1, "bitSira": 25,   // sayfalama
  "fonTurAciklama": null, "dil": "TR", "kurucuKod": null
}
```

**Cevap:**
```json
{ "errorMessage": null, "toplamSayi": 766,
  "resultList": [{
     "fonKodu": "AAV",
     "fonUnvan": "ATA PORTFÖY İKİNCİ HİSSE SENEDİ (TL) FONU ...",
     "tarih": "2026-09-04",
     "fiyat": 62.077527,          // birim pay değeri
     "tedPaySayisi": 1959962,
     "kisiSayisi": 1969,          // yatırımcı sayısı
     "portfoyBuyukluk": 121669593.47
  }] }
```

**Kategori listesi:** `POST /api/funds/fonTurGetir` → `sfonTuru` + açıklama.

### Öğrenilenler

- **Sunucu tarafı çekim çalışıyor.** Site F5/TSPD bot koruması kullanıyor ama
  oturum + gerçekçi başlıklarla (`User-Agent`, `Origin`, `Referer`) engellemiyor.
  Headless tarayıcıya GEREK YOK. Doğrulandı: konteynerden HTTP 200, veri geldi.
- **Bugünün verisi gün içinde YOK.** Birim pay değeri akşam yayımlanıyor;
  bugünü sorgulamak boş döner (hata değil).
- **Bonus veri:** `kisiSayisi` ve `portfoyBuyukluk` fon para akışını veriyor —
  planlamadığımız, hisse tarafında karşılığı olmayan bir sinyal.
- **Site HIZ SINIRLIYOR (HTTP 429).** 0,8 sn aralıkla art arda iki sorguda
  429 alındı. Bekleme 1,5 sn'ye çıkarıldı ve 5/15/45 sn üstel geri çekilme
  eklendi (`Retry-After` başlığı varsa ona uyulur). Bu bir "engel aşma" değil
  **kibarlık**: burası kamuya açık bir devlet servisi, yormak kaba olur ve
  engellenmeye davetiyedir. Sonsuz deneme YOK — üç denemede geçilemezse vazgeçilir.

### Doğrulanmış evren (10.09.2026, 4 günlük çekim)

| Kategori | Eşsiz fon |
|---|---|
| Hisse Senedi (104) | 192 |
| Değişken (101) | 173 |
| Para Piyasası (107) | 81 |
| Kıymetli Maden (105) | 27 |

Dört kategori, 4 gün → **1.890 kayıt, 25 saniye, sıfır hata**. Akran
karşılaştırması için kategori içi kalabalık fazlasıyla yeterli.

---

## 3. Faz 1 — Veri hattı

Yeni **`tefas-service`**. Ayrı servis olmasının gerekçesi: TEFAS resmi
belgelenmiş bir API değil, sitenin kendi uç noktası. Kırılgan; çökerse fiyat
hattını (market-data) düşürmemeli. Projedeki "her veri alanı kendi servisinde"
desenine de uyuyor.

- `shared/symbols.json`'a `fund` bölümü (mevcut `bist`/`commodity`/`forex` yanına),
  kategori etiketiyle
- Günlük birim pay değeri + fon büyüklüğü + yatırımcı sayısı
- **`event_ts` / `ingest_ts` ayrımı İLK GÜNDEN.** Sonradan eklenen
  noktasal-zamanlılık hiç tutmuyor — CNN Türk sızıntısında (MODEL_KANIT §8.2)
  bunu pahalıya öğrendik.
- `assetType: "FUND"` ile mevcut varlık akışına katılır
- Kibar çekim: kategori başına sayfalı istek, istekler arası bekleme

---

## 4. Faz 2 — Tarama ve karşılaştırma

Mevcut `/tarayici` sayfasına **"Fonlar" görünümü** eklenir. Ayrı sayfa
AÇILMAZ — Faz F'de üç tarama sayfasını tek tabloda birleştirmiştik, o karar
bozulmayacak. Tablo altyapısı (sıralama, kolon seçici, CSV, kayıtlı görünüm) hazır.

| Kolon | İçerik |
|---|---|
| Fon · Kategori | kod + tür |
| Getiri | 1A · 3A · 1Y (dönem açıkça yazılı) |
| **Akran sırası** | kategori içinde yüzdelik dilim |
| Risk | oynaklık · maksimum düşüş |
| **Eşik farkı** | para piyasasına göre fazla getiri |
| Büyüklük · Yatırımcı | fon büyüklüğü ve kişi sayısı (akım göstergesi) |

Fonlar çoklu grafik panosuna da eklenebilir — orası fiyat serisi bekliyor,
fon serisi sorunsuz oturur.

### Neden para piyasası "eşik"

Enflasyonlu bir ortamda bir hisse fonunu %0'la kıyaslamak anlamsız. Anlamlı
soru: *"para piyasası fonunda dursaydım ne olurdu?"* Projede `TCMB_RATE_PCT`
var ama gerçek para piyasası fonu getirisi daha dürüst bir eşiktir — çünkü
ulaşılabilir bir alternatiftir.

Bu, MODEL_KANIT §5'teki dersin fon tarafındaki karşılığı: *nominal getiri tek
başına beceri göstergesi değildir.*

---

## 5. Ölçüm disiplini — hisse tarafıyla AYNI kurallar

İki farklı standart oluşmasın diye projenin kazandığı alışkanlıklar aynen taşınır.

**Akran sırası noktasal-zamanlı olmalı.** Bugünün sırası bugün bilinen veriyle;
geçmiş sıralar geçmiş veriyle. Aksi hâlde "bu fon hep birinciydi" gibi geriye
dönük bir yalan üretilir.

**Hayatta kalma yanlılığı fonlarda DAHA AĞIR** ve açıkça etiketlenecek. Fonlar
kapanır ve birleşir; kapanma nedeni genelde kötü performanstır. Bugünün
listesiyle geriye bakmak hisseden **daha fazla** şişirir. Ekranda "bu
karşılaştırma bugün yaşayan fonlar üzerinden" notu duracak.

**Dönem her zaman yazılı.** "%42 getiri" anlamsız; "son 12 ayda %42, aynı
dönemde para piyasası %38" anlamlı.

---

## 6. Kapsam dışı: tahmin

Fon tarafında AL/SAT sinyali **üretilmeyecek**. Üç gerekçe:

1. **Uygulanamaz.** Hedef/stop kurulamaz (§1.3), giriş fiyatı karar anında
   bilinmez (§1.2).
2. **Etiketleme yeniden tasarlanmalı** (§1.1) — aylık ufuk, kapanıştan kapanışa,
   kategori-içi kesitsel rank. Ayrı bir model demek.
3. **Beklenti düşük.** Fon getirisi zaten çeşitlendirilmiş bir portföyün
   getirisi — hisse seçiminden daha da düzleşmiş bir sinyal. Hisse tarafında
   20 göstergeyle kenar bulunamadı (MODEL_KANIT §2, gün-içi Spearman ≈ 0);
   fonda bulunma ihtimali daha düşük.

Bir değişmez bu kuralı koruyacak: fon ekranlarında hedef/stop/AL alanları
gösterilmeyecek.

Faz 3 (tahmin) ileride açılırsa, bu dosyaya gerekçesiyle yazılacak — sessizce
kapsam genişletilmeyecek.
