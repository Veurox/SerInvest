# SerInvest — TradingView Sınıfı Arayüz: ULTRAPLAN

> Tarih: 2026-08-03 · Hedef: mevcut "sayfa yığını" arayüzü, TradingView'in
> **grafik-merkezli çalışma alanı** modeline taşımak; üstüne bu projeye özgü
> **ML Model** katmanını eklemek.
>
> Bu belge bir **karar ve uygulama planıdır**; kod içermez, ama her kararın
> gerekçesi ve dosya düzeyinde karşılığı yazılıdır.

---

## 0. Yönetici Özeti

| | |
|---|---|
| **Grafik motoru** | TradingView **Lightweight Charts v5.2** (Apache-2.0, ~45 KB) |
| **Neden Advanced Charts değil** | Başvuru/onay gerektirir, ağırdır, kendi veri adaptörünü dayatır; bize gereken kontrolü elimizden alır |
| **Kendimiz yazacaklarımız** | Göstergeler (indicators), çizim araçları, layout kaydetme — Lightweight Charts bunları **içermez** |
| **Mimari değişim** | 11 sayfa → **4 çalışma alanı** (Grafik · Tarayıcı · Portföy · Model) |
| **Toplam iş** | 6 faz, ~28 iş paketi |
| **Bozulmayacak olan** | Backend API'leri, ML boru hattı, veri şeması — bu tamamen frontend işi |

---

## 1. Araştırma Bulguları

### 1.1 Grafik kütüphanesi seçimi

TradingView'in **iki** ayrı ürünü var; karıştırılıyor:

| | Lightweight Charts | Advanced Charts (Charting Library) |
|---|---|---|
| Lisans | **Apache 2.0**, serbest | Ücretsiz ama **başvuru + onay** gerekir |
| Boyut | ~45 KB | Birkaç MB |
| Göstergeler | **YOK** — kendin yazarsın | 100+ hazır |
| Çizim araçları | **YOK** | 80+ hazır |
| Seri tipleri | Area, Bar, Baseline, **Candlestick**, Histogram, Line | aynısı + fazlası |
| Panes (çoklu panel) | **VAR** (v4+) | VAR |
| Price line / marker / crosshair | VAR | VAR |
| Fiyat ölçeği modları | normal / **logaritmik** / **yüzde** | aynısı |
| Performans | 50.000+ mum akıcı | daha ağır |
| Veri kontrolü | **Sen verirsin**, adaptör yok | Kendi datafeed sözleşmesi |

**Karar: Lightweight Charts v5.2.**
Gerekçe: (a) onay süreci yok, (b) veri akışımız zaten kendi API'mizden geliyor —
Advanced Charts'ın datafeed sözleşmesine uydurmak saf angarya olurdu, (c) 45 KB
maliyetle profesyonel mum grafiği + crosshair + panes elde ediyoruz, (d) eksik
kalan iki şeyi (gösterge, çizim) zaten kendi tarzımızda yazmak istiyoruz.

**Lisans yükümlülüğü:** Apache-2.0 + NOTICE dosyası; ürün sayfasında
tradingview.com'a bağlantı verilmesi bekleniyor. Kişisel kullanımda dahi
uygulayacağız (footer'da tek satır).

### 1.2 TradingView arayüz anatomisi (referans model)

Dört araç çubuğu + merkez:

```
┌──────────────────────────────────────────────────────────────────────┐
│ ÜST: sembol ara · zaman dilimi · grafik tipi · göstergeler · uyarı   │
│      · karşılaştır · layout · geri/ileri                             │
├──┬────────────────────────────────────────────────────┬──────────────┤
│Ç │                                                    │ SAĞ WIDGET   │
│İ │                                                    │ ┌──────────┐ │
│Z │              ANA GRAFİK ALANI                      │ │İzleme    │ │
│İ │           (mum + göstergeler + ML katmanı)         │ │Listesi   │ │
│M │                                                    │ ├──────────┤ │
│  │  ────────────────────────────────────────────      │ │Detaylar  │ │
│A │              HACİM PANELİ                          │ ├──────────┤ │
│R │  ────────────────────────────────────────────      │ │Haberler  │ │
│A │              RSI / MACD PANELİ                     │ └──────────┘ │
│Ç │                                                    │              │
├──┴────────────────────────────────────────────────────┴──────────────┤
│ ALT: 1D 5G 1A 3A 6A 1Y 5Y TÜMÜ · tarih aralığı · log/% · saat        │
└──────────────────────────────────────────────────────────────────────┘
```

Bizim uyarlamamızda **beşinci** bir eleman var: sağ widget bar'da ve grafik
üstünde **ML katmanı** (tahmin, bariyerler, güven, meta sinyal).

### 1.3 Mevcut durumun envanteri

| | Değer |
|---|---|
| Bileşen sayısı | 53 `.tsx` |
| Toplam frontend kodu | ~12.000 satır |
| Sayfa/sekme | 11 rota |
| Grafik altyapısı | `ChartPanel.tsx` — **elle yazılmış SVG**, gerçek grafik kütüphanesi değil |
| İkincil grafikler | Recharts (Terminal, Model sayfaları) |
| Chart API | 7 zaman dilimi: `1H 1D 1W 1M 3M 1Y 5Y` → OHLCV JSON |
| Sunucu göstergeleri | RSI, MACD(line/signal/hist), Bollinger(U/M/L), EMA 9/20/50/200 — **ama yalnız son değer**, seri değil |

**Kritik boşluk:** Göstergeler yalnızca *anlık snapshot* olarak var; grafik için
**seri** gerekiyor. Çözüm: OHLCV zaten geliyor → göstergeleri **istemcide**
hesapla. Backend'e dokunmaya gerek yok, ağ trafiği artmaz.

---

## 2. Hedef Bilgi Mimarisi: 11 sayfa → 4 çalışma alanı

TradingView'de "grafik" uygulamanın kendisidir; geri kalan her şey panel veya
ikincil ekrandır. Aynısını yapıyoruz.

| Yeni çalışma alanı | Ne kapsıyor | Hangi eski sayfalar buraya gömülüyor |
|---|---|---|
| **1. Grafik** (ana) | Mum grafiği + göstergeler + çizim + ML katmanı + sağ widget bar | Terminal, Piyasa Genel, Değerlendir, (Haberler → sağ panel) |
| **2. Tarayıcı** (Screener) | Sütunlu/sıralanabilir/filtrelenebilir sembol tablosu + kayıtlı filtreler | AI Tavsiye, Dip Radarı, (Fırsat Radarı zaten kalktı), Temel Analiz |
| **3. Portföy** | Gerçek portföy + model portföyü sekmeli | Portföyüm, Model Portföyü |
| **4. Model** (bize özgü) | Künye, eğitim hikâyesi, sınav grafikleri, tahmin yaşam döngüsü, işler | Model, Tahmin Geçmişi |

Navigasyon: üstte **4 sekme**, 11 değil.

---

## 3. Özellik Envanteri — TradingView'de ne var, biz ne yapıyoruz

Öncelik: **P0** = onsuz "TradingView gibi" denemez · **P1** = güçlü katkı ·
**P2** = cila · **SKIP** = bilinçli dışarıda

### 3.1 Grafik çekirdeği

| Özellik | Öncelik | Karar |
|---|---|---|
| Mum / çubuk / çizgi / alan / baseline | **P0** | Lightweight Charts yerleşik |
| Heikin Ashi, Hollow candle | P1 | OHLCV'den türet, seri olarak besle |
| Logaritmik / yüzde ölçek | **P0** | Yerleşik (`priceScale.mode`) |
| Crosshair + OHLC veri kutusu | **P0** | Yerleşik crosshair + kendi "data window" bileşenimiz |
| Zoom / pan / fitContent | **P0** | Yerleşik |
| Çoklu pane (hacim, RSI, MACD ayrı) | **P0** | v5 `panes` desteği |
| Sembol karşılaştırma (overlay) | P1 | İkinci seri + yüzde ölçek |
| Otomatik ölçek / kilitli ölçek | P1 | Yerleşik |
| Saat dilimi | P2 | Yerleşik (Europe/Istanbul) |

### 3.2 Göstergeler (kendimiz yazacağız — kütüphanede yok)

| Gösterge | Öncelik | Pane |
|---|---|---|
| EMA 9/20/50/200, SMA | **P0** | ana |
| Bollinger Bantları | **P0** | ana |
| Hacim (renkli histogram) | **P0** | ayrı |
| RSI (+ 30/70 çizgileri) | **P0** | ayrı |
| MACD (line/signal/hist) | **P0** | ayrı |
| ATR | P1 | ayrı |
| VWAP | P1 | ana |
| Stochastic, ADX, OBV | P2 | ayrı |
| Gösterge ayar diyaloğu (periyot/renk) | P1 | — |
| Gösterge şablonları (kaydet/yükle) | P2 | — |

> Tasarım notu: göstergeler saf fonksiyon olarak `lib/indicators/` altında
> yazılacak (girdi: OHLCV dizisi → çıktı: seri). Böylece hem grafikte hem
> tarayıcıda hem testte aynı kod kullanılır. **Backend'deki ML özellik
> hesabıyla karıştırılmayacak** — o ayrı ve dokunulmaz.

### 3.3 Çizim araçları (kütüphanede yok — custom series/primitive olarak)

| Araç | Öncelik |
|---|---|
| Trend çizgisi, yatay çizgi, dikey çizgi | **P0** |
| Yatay ışın, kanal | P1 |
| Fibonacci geri çekilme | P1 |
| Dikdörtgen / bölge vurgulama | P1 |
| Metin notu, ok/işaret | P1 |
| Ölçüm aracı (fiyat/zaman/%) | P1 |
| Çizimlerin sembol bazlı kalıcılığı (localStorage) | **P0** |
| Fibonacci uzantı, Gann, Elliott | SKIP | aşırı; kişisel kullanımda gereksiz |

### 3.4 Sağ widget bar

| Widget | Öncelik | Not |
|---|---|---|
| İzleme listesi (çoklu liste, sıralama, sürükle) | **P0** | mevcut `WatchlistSidebar` yeniden kullanılabilir |
| Detaylar (fiyat, hacim, F/K, PD/DD, 52H) | **P0** | mevcut veri var |
| Haberler (sembole filtreli) | **P0** | mevcut `NewsFeed` + Faz 3 olay tipolojisi |
| **ML Paneli** (bize özgü) | **P0** | tahmin, güven, bariyer, meta durum |
| Hesap/pozisyon özeti | P1 | portföy verisi mevcut |

### 3.5 Üst araç çubuğu

| Eleman | Öncelik |
|---|---|
| Sembol arama (fuzzy, klavye) | **P0** |
| Zaman dilimi seçici | **P0** |
| Grafik tipi seçici | **P0** |
| Göstergeler menüsü | **P0** |
| Karşılaştırma ekle | P1 |
| Layout kaydet/yükle | P1 |
| Uyarılar (fiyat alarmı) | P1 |
| Geri/ileri (çizim undo) | P1 |
| Ekran görüntüsü / PNG dışa aktar | P2 |
| Replay (geçmişi oynat) | P2 |

### 3.6 Bilinçli DIŞARIDA bırakılanlar

- Gerçek zamanlı WebSocket akışı — veri kaynağımız yfinance, 15 dk gecikmeli
- Emir iletimi / broker entegrasyonu — sistem long-only kâğıt üstünde
- Sosyal akış, fikir paylaşımı, Pine Script
- Çoklu grafik ızgarası (2x2, 3x1) — tek grafik + karşılaştırma yeterli

---

## 4. Tasarım Dili

Mevcut `theme.css` token sistemi **korunacak** (hex yasak, token zorunlu).
Üzerine "terminal yoğunluğu" katmanı gelir.

| Boyut | Karar |
|---|---|
| Varsayılan tema | **Dark** (mevcut token seti hazır) |
| Yoğunluk | Kompakt: satır yüksekliği 22-26px, panel dolgusu 6-10px |
| Tipografi | Arayüz: sistem sans · **Sayılar: mono + `tabular-nums`** (zorunlu) |
| Renk semantiği | Yeşil/kırmızı yalnız yön için; neon yok, `--profit`/`--loss` |
| Kenarlık | 1px, `--border-subtle`; köşe yarıçapı 3-4px (keskin) |
| Grafik renkleri | Mum: profit/loss token · Göstergeler: `--info`, `--accent`, `--warning` |
| Boş alan | Geniş ekranda **doldurulur**, ortalanmaz (kullanıcı kararı 07/2026) |
| Ölçeklendirme | **1280 / 1920 / 2560'ta doğrulama zorunlu** — dar viewport'ta test edip geniş ekranda bozulma yaşandı (07/2026 dersi) |

---

## 5. Teknik Mimari

### 5.1 Yeni dizin yapısı

```
frontend/src/
  chart/                        ← YENİ: grafik motoru katmanı
    ChartHost.tsx               Lightweight Charts yaşam döngüsü (create/resize/destroy)
    useChart.ts                 chart örneği + pane yönetimi hook'u
    series/
      priceSeries.ts            mum/çubuk/çizgi/alan/baseline/heikin-ashi
      volumeSeries.ts
      overlaySeries.ts          EMA/BB/VWAP ana pane'e
      paneSeries.ts             RSI/MACD/ATR ayrı pane'e
    drawings/
      DrawingLayer.tsx          çizim primitive'leri (canvas overlay)
      tools/                    trend, yatay, fib, dikdörtgen, metin, ölçüm
      store.ts                  sembol bazlı kalıcılık (localStorage)
    ml/
      MlOverlay.tsx             hedef/stop bariyerleri, giriş işareti, tahmin bandı
  lib/indicators/               ← YENİ: saf fonksiyonlar
    ema.ts sma.ts rsi.ts macd.ts bollinger.ts atr.ts vwap.ts stochastic.ts
    index.ts                    kayıt defteri (ad → hesaplayıcı + varsayılan ayar)
  workspace/                    ← YENİ: 4 çalışma alanı
    ChartWorkspace.tsx
    ScreenerWorkspace.tsx
    PortfolioWorkspace.tsx
    ModelWorkspace.tsx
  panels/                       ← sağ widget bar
    WatchlistPanel.tsx DetailsPanel.tsx NewsPanel.tsx MlPanel.tsx
  toolbar/
    TopToolbar.tsx SymbolSearch.tsx TimeframePicker.tsx
    ChartTypePicker.tsx IndicatorMenu.tsx DrawingToolbar.tsx
```

### 5.2 Durum yönetimi

Mevcut yapı `useOutletContext` ile paylaşılan veri kullanıyor — **korunacak**.
Grafik durumu (sembol, tf, göstergeler, çizimler, layout) için tek bir
`workspaceStore` (Zustand veya basit Context+reducer; ekstra bağımlılık
istenmezse Context yeterli).

Kalıcılık: `localStorage`
- `si_ws_layout` — aktif çalışma alanı, panel genişlikleri, açık widget'lar
- `si_chart_{symbol}` — çizimler
- `si_indicators` — aktif gösterge seti + ayarları
- `si_watchlists` — mevcut (dokunulmaz)

### 5.3 Veri akışı (backend'e dokunulmaz)

```
core-api /api/market/{sym}/chart?tf=  → OHLCV
      ↓
  lib/indicators/*  (istemcide hesap)
      ↓
  chart/series/*    → Lightweight Charts panes
      ↑
core-api /api/oracle/overview         → ML tahmin (hedef/stop/güven)
core-api /api/signals/*               → haber + olay tipolojisi
oracle   /admin/*                     → model durumu, işler, hikâye
```

**Tek backend eklemesi (opsiyonel, P1):** chart endpoint'ine `&indicators=1`
parametresi — istemci hesabı yavaş kalırsa. Şimdilik gerek yok.

---

## 6. ML Katmanı — Bu Projenin Farkı

TradingView'de olmayan, bize özgü olan kısım. **Grafiğin içine gömülür**,
ayrı sayfaya sürgün edilmez.

### 6.1 Grafik üstü ML katmanı (`MlOverlay`)

| Eleman | Görsel |
|---|---|
| Tahmin anı | Dikey işaret + "8 Tem, AL, %53" etiketi |
| Hedef bariyeri | Yeşil yatay çizgi + `+3×ATR` etiketi |
| Stop bariyeri | Kırmızı yatay çizgi + `−2×ATR` |
| Süre bariyeri | Kesikli dikey çizgi (10 işlem günü sonrası) |
| Sonuçlanmış tahminler | Geçmişte: ✓ hedefe ulaştı / ✕ stopa takıldı işaretleri |
| Rejim bandı | RISK_OFF dönemleri arka planda soluk kırmızı şerit |

Bu, "modelin ne dediğini ve ne olduğunu" grafikte doğrudan gösterir —
tablolara bakmaya gerek kalmaz.

### 6.2 Sağ panel: ML widget'ı

```
┌─ MODEL · THYAO ──────────────┐
│ ALIM        kalibre güven %53│
│ ▓▓▓▓▓░░░░░                   │
│ Hedef  361.20   +9.8%        │
│ Stop   318.40   −6.5%        │
│ Boyut  %5.5   R:R 1.50       │
│ ─────────────────────────────│
│ Sürücüler                    │
│ ▲ EMA200 üstü  ▲ EMA hizası  │
│ ▼ Belirgin risk yok          │
│ ─────────────────────────────│
│ ⚠ Bu liste sıralı değil      │
│   (tüm sinyaller aynı güven) │
└──────────────────────────────┘
```

### 6.3 Model çalışma alanı (mevcut içerik korunur, kabuğu değişir)
Künye · eğitim yolculuğu · sınav grafiği · kalibrasyon eğrisi · terfi geçmişi ·
zamanlanmış işler · tahmin yaşam döngüsü · sonuçlanan tahminler.
Bunlar **zaten yazıldı** — yeni kabuğa taşınacak, yeniden yazılmayacak.

---

## 7. Uygulama Fazları

### Faz A — Grafik çekirdeği (temel; buna her şey bağlı)
- A1. `lightweight-charts` bağımlılığı + lisans NOTICE
- A2. `ChartHost` + `useChart` (yaşam döngüsü, resize gözlemcisi, tema token köprüsü)
- A3. Mum/çizgi/alan serisi + zaman dilimi değiştirme
- A4. Hacim pane'i
- A5. Crosshair + OHLC veri kutusu (sol üst)
- A6. Log/yüzde ölçek, fitContent, zoom kontrolleri
- **Çıktı:** çalışan profesyonel mum grafiği; `ChartPanel.tsx`'in yerini alır

### Faz B — Göstergeler
- B1. `lib/indicators/` saf fonksiyonlar + birim testleri
- B2. Overlay göstergeler (EMA/SMA/BB/VWAP)
- B3. Pane göstergeler (RSI/MACD/ATR)
- B4. Gösterge menüsü + ayar diyaloğu + aktif gösterge rozetleri
- B5. localStorage kalıcılık
- **Çıktı:** TradingView'deki gibi gösterge ekleyip çıkarma

### Faz C — Çalışma alanı kabuğu
- C1. `TopToolbar` (sembol arama, tf, tip, göstergeler, layout)
- C2. Sağ widget bar (izleme/detay/haber/ML) — sürüklenebilir genişlik
- C3. Alt zaman aralığı çubuğu
- C4. 4 çalışma alanına geçiş + rota yönlendirmeleri (eski rotalar korunur)
- **Çıktı:** TradingView düzeni tamam

### Faz D — ML katmanı
- D1. `MlOverlay` (bariyerler, tahmin işaretleri, rejim bandı)
- D2. `MlPanel` sağ bar widget'ı
- D3. Sonuçlanmış tahminlerin grafik üstünde işaretlenmesi
- **Çıktı:** projenin farkı görünür hale gelir

### Faz E — Çizim araçları
- E1. `DrawingLayer` altyapısı (canvas overlay + hit-test)
- E2. Trend/yatay/dikey çizgi
- E3. Fibonacci, dikdörtgen, metin, ölçüm
- E4. Sembol bazlı kalıcılık + undo/redo
- **Çıktı:** grafik üstünde analiz yapılabilir

### Faz F — Tarayıcı (Screener) ve cila
- F1. Sütunlu sanal tablo (50+ satır akıcı)
- F2. Filtre kurucu + kayıtlı filtreler
- F3. Uyarılar (fiyat alarmı, tarayıcı koşulu)
- F4. Klavye kısayolları haritası, PNG dışa aktarma
- F5. 1280/1920/2560 ölçek denetimi + erişilebilirlik geçişi

---

## 8. Riskler ve Önlemler

| Risk | Önlem |
|---|---|
| **Kapsam patlaması** — TradingView 10 yıllık ürün | Faz A-D "kullanılabilir ürün" sınırı; E-F opsiyonel |
| Çizim araçları en pahalı kısım | Faz E'ye ertelendi; P0 sadece 3 temel araç |
| Mevcut 12.000 satır kodun çöpe gitmesi | Bileşenler **taşınacak**, yeniden yazılmayacak (ModelStory, JobStatus, PredictionResults, NewsFeed, Watchlist hepsi kalır) |
| Gösterge hesabının ML özellikleriyle karışması | `lib/indicators/` yalnız **görsel**; backend ML özellikleri ayrı ve dokunulmaz |
| Geniş ekranda bozulma (yaşandı) | Her fazın kabul kriterinde 1280/1920/2560 doğrulaması |
| Performans (50 sembol × 250 bar × 6 gösterge) | Göstergeler memoize; Lightweight Charts zaten 50k mum kaldırıyor |
| Lisans | Apache-2.0 NOTICE + footer'da tradingview.com bağlantısı |

---

## 9. Kabul Kriterleri (her faz için geçerli)

1. `tsc -b` temiz
2. **1280 · 1920 · 2560** genişliklerde yatay taşma yok, metin okunur (≥11px)
3. Dark + light temada token uyumlu
4. Konsol hatası yok
5. Mevcut backend API'lerine hiçbir kırıcı değişiklik yok
6. Eski rotalar (`/terminal`, `/oracle`, `/history` …) çalışmaya devam eder

---

## 10. Kaynaklar

- [Lightweight Charts — GitHub](https://github.com/tradingview/lightweight-charts) (Apache-2.0, v5.2)
- [Lightweight Charts — Dokümantasyon](https://tradingview.github.io/lightweight-charts/docs)
- [Ürün karşılaştırması — TradingView](https://www.tradingview.com/charting-library-docs/latest/getting_started/product-comparison/)
- [Advanced Charts — TradingView](https://www.tradingview.com/advanced-charts/)
- [UI elemanları / araç çubukları — TradingView Docs](https://www.tradingview.com/charting-library-docs/latest/ui_elements/Toolbars/)
- [Lightweight Charts vs Chart.js vs TradingView (2026)](https://www.index.dev/skill-vs-skill/tradingview-vs-lightweight-charts-vs-chartjs)
