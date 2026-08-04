# SerInvest — TradingView Görünümlü Arayüz: ULTRAPLAN

> Tarih: 2026-08-03 · Kapsam: **yalnızca arayüz tasarımı.**
> TradingView'in *görünüşü ve çalışma mantığı* referans alınır; onlardan
> kütüphane/API/servis **alınmaz**. Mevcut grafik altyapımız ve backend
> olduğu gibi kalır.
>
> Hedef: dağınık "sayfa yığını" hissini bırakıp, tek ekranda yoğun bilgi veren
> **profesyonel terminal** görünümüne geçmek + bu projeye özgü ML bölümünü
> arayüzün doğal parçası yapmak.

---

## 0. Yönetici Özeti

| | |
|---|---|
| **Kapsam** | Frontend görsel/etkileşim tasarımı |
| **Dokunulmayacak** | Backend API'leri, ML boru hattı, veri şeması, grafik motoru |
| **Yeni bağımlılık** | **Yok** (mevcut React + theme.css token sistemi yeterli) |
| **Ana değişim** | 11 sayfa → **4 çalışma alanı**; sabit sayfa düzeni → **panelli terminal** |
| **Yeniden yazılmayacak** | ModelStory, JobStatus, PredictionResults, NewsFeed, Watchlist, ChartPanel — hepsi taşınır |
| **Fazlar** | 5 faz · 22 iş paketi |

---

## 1. Referans: TradingView Neden "Profesyonel" Hissettiriyor?

Araştırmada çıkan tasarım ilkeleri — kopyalayacağımız şey bunlar:

### 1.1 Dört çerçeve + merkez
Ekran sabit bir iskelete oturur; içerik değişir, iskelet değişmez.

```
┌──────────────────────────────────────────────────────────────────────┐
│ ÜST ARAÇ ÇUBUĞU   sembol · zaman · tip · göstergeler · layout        │
├──┬────────────────────────────────────────────────┬──────────────────┤
│S │                                                │ SAĞ PANEL        │
│O │                                                │ ┌──────────────┐ │
│L │            ANA İÇERİK (grafik)                 │ │ İzleme       │ │
│  │                                                │ ├──────────────┤ │
│A │                                                │ │ Detaylar     │ │
│R │  ──────────────────────────────────────        │ ├──────────────┤ │
│A │            YARDIMCI PANEL                      │ │ ML Modeli    │ │
│Ç │                                                │ ├──────────────┤ │
│  │                                                │ │ Haberler     │ │
│L │                                                │ └──────────────┘ │
├──┴────────────────────────────────────────────────┴──────────────────┤
│ ALT ŞERİT   zaman aralığı · ölçek · durum · saat                     │
└──────────────────────────────────────────────────────────────────────┘
```

### 1.2 Kopyalanacak sekiz tasarım ilkesi

| # | İlke | Bizde şu an | Hedef |
|---|---|---|---|
| 1 | **Sabit iskelet, değişen içerik** | Her sayfa kendi düzenini kurar | Tek kabuk; çalışma alanları merkezde değişir |
| 2 | **Yoğunluk** — piksel israfı yok | Geniş boşluklar, kartlar arası büyük gap | Satır 22-26px, dolgu 6-10px, gap 8px |
| 3 | **Panel mantığı** — her şey daraltılıp genişletilebilir | Sabit bloklar | Sürüklenebilir genişlik, katlanabilir, kapatılabilir |
| 4 | **Sayı disiplini** | Kısmen | Mono + `tabular-nums` **zorunlu**; hizalı ondalık |
| 5 | **Renk = anlam** | Kısmen | Yeşil/kırmızı yalnız yön; vurgu tek accent; gerisi gri tonları |
| 6 | **Sessiz kenarlık** | Bazı yerlerde ağır | 1px `--border-subtle`, köşe 3-4px (keskin) |
| 7 | **Klavye öncelikli** | Ctrl+P var | Sembol ara, zaman dilimi, panel aç/kapa hepsi kısayollu |
| 8 | **Durum her zaman görünür** | Dağınık | Alt şeritte: bağlantı, son güncelleme, piyasa açık/kapalı, model durumu |

---

## 2. Bilgi Mimarisi: 11 sayfa → 4 çalışma alanı

TradingView'de "grafik" uygulamanın kendisidir; gerisi paneldir. Aynısını yapıyoruz.

| Çalışma alanı | İçerik | Hangi sayfalar burada eriyor |
|---|---|---|
| **1 · Grafik** | Ana grafik + yardımcı panel + sağ panel yığını | Terminal, Piyasa Genel, Değerlendir, Haberler |
| **2 · Tarayıcı** | Sütunlu, sıralanabilir, filtrelenebilir sembol tablosu | AI Tavsiye, Dip Radarı, Temel Analiz |
| **3 · Portföy** | Gerçek portföy / Model portföyü (sekmeli) | Portföyüm, Model Portföyü |
| **4 · Model** | Künye, eğitim hikâyesi, sınav, tahmin döngüsü, işler | Model, Tahmin Geçmişi |

Navigasyon: üstte **4 sekme**. Eski rotalar çalışmaya devam eder (yer imi kırılmaz).

---

## 3. Bileşen Tasarım Şartnamesi

### 3.1 Üst araç çubuğu (`TopBar`)
Yükseklik 40px, tek satır, sola hizalı.

| Bölge | Eleman |
|---|---|
| Sol | Logo (kompakt) · **sembol arama** (fuzzy, `/` kısayolu) |
| Orta | Zaman dilimi düğmeleri · grafik tipi · gösterge menüsü |
| Sağ | Çalışma alanı sekmeleri · tema · komut paleti (`Ctrl+P`) |

Tasarım: düğmeler 26px yüksek, arka plan yok, yalnız aktif olan `--accent-bg`.

### 3.2 Sol araç şeridi (`SideRail`)
Genişlik 40px, yalnız ikon. Grafik çalışma alanında görünür.
İçerik: imleç · trend çizgisi · yatay çizgi · dikdörtgen · metin · ölçüm · sil.

> Not: Bu fazda **görsel şerit** kurulur; çizim işlevi Faz E'de gelir.
> Şeridin varlığı bile "profesyonel araç" algısını taşır.

### 3.3 Sağ panel yığını (`RightDock`)
Genişlik 300-380px, sürüklenerek ayarlanır, `localStorage`'da saklanır.
Widget'lar katlanabilir, sırası sürüklenerek değişir.

| Widget | Kaynak |
|---|---|
| İzleme Listesi | mevcut `WatchlistSidebar` (taşınır) |
| Detaylar | fiyat, hacim, değişim, F/K, PD/DD, 52H aralığı |
| **ML Modeli** | tahmin, kalibre güven, hedef/stop, boyut, sürücüler |
| Haberler | mevcut `NewsFeed` + olay tipolojisi rozetleri |

### 3.4 Alt durum şeridi (`StatusBar`)
Yükseklik 24px, 11px yazı.
`● Piyasa Açık 18:32` · `Son veri 2 dk önce` · `Model: güncel` · `600/200 tahmin` · saat

### 3.5 Ana içerik (grafik alanı)
- Mevcut `ChartPanel` **korunur**, kabuğu değişir (çerçeve, başlık, ölçek düğmeleri dışarı alınır)
- Üstünde ince bir "sembol künyesi" satırı: `THYAO · 316,75 ▼ −0,24% · Hac 14,6M`
- Altında yardımcı panel yuvası (hacim/RSI için — ileride)

### 3.6 Tarayıcı (`Screener`)
- Sanal kaydırmalı tablo (50+ satır akıcı)
- Sütun başlığından sıralama, sütun seçici
- Üstte filtre çipleri: `AL sinyali` · `RSI<30` · `Dip skoru ≥3` · `F/K<10`
- Satıra tıkla → Grafik çalışma alanına o sembolle geç

---

## 4. Görsel Dil (theme.css üzerine)

| Boyut | Kural |
|---|---|
| Tema | Dark varsayılan; light korunur (token sistemi hazır) |
| Yazı — arayüz | 12-13px sistem sans |
| Yazı — sayı | **mono + `tabular-nums`**, ondalık hizalı |
| Başlık | 10-11px, `letter-spacing .08em`, UPPERCASE, `--text-muted` |
| Satır yüksekliği | Tablolarda 24px, listelerde 26px |
| Dolgu | Panel 8-10px, hücre 4-6px |
| Kenarlık | 1px `--border-subtle`; köşe 3-4px |
| Renk | Yön: `--profit`/`--loss` · Vurgu: `--accent` (tek) · Gerisi gri |
| Hareket | 120-160ms; sayı değişiminde flash yok (titreme yapar) |
| Geniş ekran | İçerik **doldurulur**, ortalanmaz; 1280/1920/2560 doğrulaması zorunlu |

---

## 5. Fazlar

### Faz 1 — Kabuk (`AppShell`)
- 1.1 `AppShell` iskeleti: TopBar + SideRail + içerik + RightDock + StatusBar
- 1.2 Panel genişliği sürükleme + `localStorage` kalıcılık
- 1.3 4 çalışma alanı sekmesi + rota yönlendirmeleri
- 1.4 Yoğunluk geçişi: global spacing/typography token ayarı
- **Çıktı:** uygulama artık "terminal" gibi duruyor, içerik henüz eski

### Faz 2 — Sağ panel yığını
- 2.1 `RightDock` + katlanabilir/sıralanabilir widget çerçevesi
- 2.2 İzleme listesi taşınır
- 2.3 Detaylar widget'ı (yeni)
- 2.4 **ML Modeli widget'ı** (yeni — projenin farkı)
- 2.5 Haberler widget'ı taşınır
- **Çıktı:** tek ekranda sembol + fiyat + model + haber

### Faz 3 — Grafik alanı kabuğu
- 3.1 Sembol künyesi satırı
- 3.2 Zaman dilimi / grafik tipi / ölçek düğmeleri üst çubuğa taşınır
- 3.3 `ChartPanel` çerçevesizleştirilir (kabuk artık dışarıda)
- 3.4 Sol araç şeridi (görsel; işlev Faz 5)
- **Çıktı:** grafik ekranı TradingView düzeninde

### Faz 4 — Tarayıcı + Portföy + Model çalışma alanları
- 4.1 `Screener` sanal tablo + sütun seçici + filtre çipleri
- 4.2 AI Tavsiye / Dip Radarı / Temel Analiz içerikleri filtre olarak erir
- 4.3 Portföy: gerçek + model sekmeli tek ekran
- 4.4 Model: mevcut bileşenler yeni kabuğa taşınır (yeniden yazım yok)
- **Çıktı:** 11 sayfa → 4 çalışma alanı tamam

### Faz 5 — Etkileşim cilası
- 5.1 Klavye kısayolları (`/` ara, `1-4` alan, `\` panel, `Ctrl+P` palet)
- 5.2 Sol şerit çizim araçları işlevsel (trend/yatay/dikdörtgen/metin)
- 5.3 Fiyat alarmı
- 5.4 Erişilebilirlik + 1280/1920/2560 son denetim

---

## 6. ML Bölümü — Bu Projenin Farkı

TradingView'de olmayan kısım. İki yerde görünür:

**A) Sağ panelde widget** (her zaman görünür, sembole bağlı)
```
┌ MODEL · THYAO ───────────────┐
│ ALIM         kalibre güven %53│
│ ▓▓▓▓▓░░░░░                    │
│ Hedef 361,20  +9,8%           │
│ Stop  318,40  −6,5%           │
│ Boyut %5,5    R:R 1,50        │
│ ▲ EMA200 üstü ▲ EMA hizalanma │
│ ⚠ Sıralama yok (tüm sinyaller │
│   aynı güvende)               │
└───────────────────────────────┘
```

**B) Model çalışma alanı** — mevcut içerik yeni kabukta:
künye · eğitim yolculuğu · sınav grafiği · kalibrasyon eğrisi · terfi geçmişi ·
zamanlanmış işler · tahmin yaşam döngüsü · sonuçlanan tahminler.

---

## 7. Riskler

| Risk | Önlem |
|---|---|
| Mevcut kodun çöpe gitmesi | Bileşenler **taşınır**, yeniden yazılmaz |
| Kapsam büyümesi | Faz 1-3 "kullanılabilir" sınırı; 4-5 sonra |
| Geniş ekranda bozulma (yaşandı) | Her fazın kabul kriterinde 1280/1920/2560 |
| Yoğunluk artınca okunabilirlik düşmesi | Min yazı 11px; ölçüm DOM'dan yapılır, göz kararı değil |
| Eski yer imlerinin kırılması | Eski rotalar korunur, yönlendirilir |

---

## 8. Kabul Kriterleri (her faz)

1. `tsc -b` temiz
2. **1280 · 1920 · 2560**'da yatay taşma yok, metin ≥11px okunur
3. Dark + light temada token uyumlu
4. Konsol hatası yok
5. Backend'e sıfır değişiklik
6. Eski rotalar çalışır

---

## 9. Açık Karar: Grafik motoru

Bu plan **mevcut grafiği koruyor** (`ChartPanel`, elle yazılmış SVG).
Sonradan mum grafiği/crosshair/çoklu panel istenirse iki seçenek olur:

- **A)** Mevcut SVG'yi geliştirmek — bağımlılık yok, iş yükü yüksek
- **B)** Açık kaynak bir finans grafik kütüphanesi eklemek — iş yükü düşük

Bu karar **şimdi verilmiyor**; tasarım fazları grafiğin içinden bağımsız
ilerleyecek şekilde kurgulandı.

---

## 10. Kaynak

- [TradingView — UI elemanları / araç çubukları](https://www.tradingview.com/charting-library-docs/latest/ui_elements/Toolbars/)
- [TradingView — Supercharts kullanım rehberi](https://www.tradingview.com/support/solutions/43000746464-getting-started-with-supercharts/)
- [TradingView — Layout ve çalışma alanı mantığı](https://www.tradingview.com/support/solutions/43000692404-layouts-charts-drawings-indicators-and-their-interaction/)
