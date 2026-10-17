# Model Kanıt Dosyası — "Bu model gerçekten bir şey biliyor mu?"

**Tarih:** 07.08.2026 · **Durum:** teşhis tamamlandı
**Yeniden üretim:** her bölümdeki `python -m ml.experiment_*` komutu

> Bu dosyanın amacı: aynı soruları bir daha sıfırdan araştırmamak. Her iddia
> ölçümle ve ölçümün zayıflığıyla birlikte yazılıdır.

---

## 0. Tek cümlelik sonuç

Yazılım sağlam ve doğrulanmış durumda; **model ise hisse seçemiyor** — 21 günlük
teknik göstergeyle BIST-50 üzerinde ekonomik olarak kullanılabilir kesitsel kenar
bulunamadı. Ölçülebilen tek tutarlı etki *getiri* değil **risk** tarafında.

---

## 1. Yanlış başlayan analiz (kendi hatam, kayda geçsin)

İlk canlı analiz "modelin en emin olduğu dilim en kötü sonucu veriyor" dedi.
**Yanlıştı.** Sonuçlanmış 249 tahmin vardı ama yalnızca **5 bağımsız gün**.
Olasılık dilimleri günlerle örtüştüğü için ölçülen şey sıralama gücü değil,
"13 Temmuz kötü bir gündü" gerçeğiydi.

| Gün | Ort. olasılık | Gerçekleşen ort. getiri |
|---|---|---|
| 2026-07-08 | 0.715 | %+2.77 |
| 2026-07-09 | 0.851 | %+2.27 |
| 2026-07-10 | 0.874 | %−0.05 |
| 2026-07-13 | 0.887 | %−0.91 |
| 2026-07-16 | 0.349 | %−5.42 |

Bu, PSI yanlış alarmıyla **aynı hata sınıfı**: aynı günün 50 satırını bağımsız
gözlem saymak. Bundan sonraki tüm ölçümler gün bazında bağımsızdır.

---

## 2. Asıl test: gün içinde sıralayabiliyor mu?

`ml/experiment_ranking.py` — walk-forward OOS, **19.939 tahmin · 487 gün**.

> ⚠ **Bu bölüm 04.09.2026'da YENİDEN ÖLÇÜLDÜ.** Önceki rakamlar `usdtry_ret5`
> özelliğinin gün kimliği sızdırdığı modelden geliyordu (bkz. §8.7). Özellik
> çıkarılıp şampiyon yeniden eğitilince tablo değişti — ve **tek "anlamlı"
> bulgu kayboldu**. Eski değerler karşılaştırma için parantez içinde bırakıldı.

| Ölçüt | Değer | t | Yargı |
|---|---|---|---|
| Gün-içi Spearman(p, sonuç) | +0.0084 *(eski −0.0073)* | +0.95 | şanstan ayırt edilemez |
| En iyi 1/3 − en kötü 1/3 | +0.0044 *(eski −0.0175)* | +0.50 | şanstan ayırt edilemez |
| Günler arası zamanlama (r) | +0.0223 *(eski −0.0416)* | — | yok |

Strateji karşılaştırması (günlük lift = precision − o günün tabanı):

| Strateji | Kapsam | Precision | Lift | t | Yargı |
|---|---|---|---|---|---|
| sabit eşik p≥0.58 | %16 | %51.3 | +0.0168 | **+1.70** *(eski +2.13)* | şans |
| kesitsel en iyi %5 | %5 | %52.6 | +0.0218 | +1.66 | şans |
| kesitsel en iyi %10 | %10 | %52.1 | +0.0174 | +1.81 | şans |
| kesitsel en iyi %20 | %20 | %51.4 | +0.0096 | +1.38 | şans |
| kesitsel en iyi %30 | %30 | %50.6 | +0.0017 | +0.31 | şans |
| kesitsel en iyi %50 | %50 | %50.5 | +0.0010 | +0.30 | şans |
| hepsini al (taban) | %100 | %50.4 | 0 | — | — |

**Artık HİÇBİR strateji anlamlı değil.** Eskiden sabit eşiğin t=2.13'ü tek
sınırda-anlamlı bulguydu ve zaten Bonferroni'yi (≈2.7) geçmiyordu; sızıntı
kalkınca t=1.70'e indi — düzeltmesiz bile anlamlı değil.

İki not:
- Sızıntı kalkınca **negatif lift'ler pozitife döndü** (%20 kesitsel: −0.0012 →
  +0.0096). Yani gün kimliği gürültüsü kesitsel stratejileri aşağı çekiyormuş.
  Yön değişti ama büyüklük hâlâ şans aralığında.
- Gün-içi Spearman'ın işareti de değişti (−0.0073 → +0.0084). İkisi de sıfırdan
  ayırt edilemiyor; işaret değişimi "iyileşme" değil, gürültünün doğal salınımı.

---

## 3. Sorun model mimarisinde mi? — Hayır

`ml/experiment_objective.py` — aynı walk-forward, beş varyant.

Hipotez şuydu: günlük UP oranının standart sapması **30 puan** (min %0, maks
%100) ve etiket varyansının **%36'sı saf gün etkisi**. Özellikler `XSEC_RANK`
ile kesitsel rank'e çevrildiği için gün bilgisi kasten siliniyor — yani model,
açıklaması imkânsız bir gürültüyü tahmin etmeye çalışıyor.

| Varyant | Gün-içi Spearman | t |
|---|---|---|
| A · baseline (mevcut) | −0.0073 | −0.78 |
| B · gün-ağırlıklı binary | +0.0085 | +0.96 |
| C · LambdaRank (grup=gün) | +0.0031 | +0.37 |
| D · 3 özellik — **yanlı seçim** | +0.0237 | +2.63 |
| **D2 · 3 özellik — dürüst seçim** | **−0.0029** | **−0.29** |
| E · lojistik (rank, C=0.05) | +0.0001 | +0.01 |
| F · küçük LGBM + gün-ağırlık | +0.0038 | +0.43 |

**D → D2 farkı bu dosyanın en önemli satırı.** Özellikleri tüm veriye bakarak
seçince t=2.63 çıkıyor; aynı seçimi her adımda yalnız geçmiş veriyle yapınca
t=−0.29. Aradaki fark tamamen **seçim yanlılığı**. Hiperparametre veya mimari
değiştirmek bunu kurtarmaz.

---

## 4. Ufuk yanlış mıydı? — Örtüşme tuzağı

`ml/experiment_horizon.py` ilk bakışta ufukla güçlenen bir sinyal gösterdi
(`price_vs_52w_high`: 10g'de t=+6.8, 60g'de t=+14.3). **Bu rakamlar şişkindi:**
h günlük ileri getiride komşu günlerin pencereleri örtüşür; 60 günlük ufukta
697 gün ≈ 11 bağımsız dönem demektir.

`ml/experiment_horizon2.py` — örtüşmeyen örnekleme + maliyet düşümü:

| Özellik | Ufuk | Bağımsız dönem | Spearman | t | Uzun %20 fazla getiri | Net/yıl |
|---|---|---|---|---|---|---|
| price_vs_52w_high | 1g | 691 | +0.033 | **+4.17** ✓ | +0.02% | −45.9% |
| atr_pct | 1g | 737 | −0.026 | **−3.85** ✓ | −0.06% | −64.8% |
| price_vs_52w_high | 5g | 139 | +0.040 | +2.23 | −0.09% | −14.6% |
| price_vs_52w_high | 10g | 69 | +0.057 | +2.18 | −0.01% | −5.4% |
| price_vs_52w_high | 20g | 34 | +0.081 | +1.76 | +0.22% | +0.3% |
| price_vs_52w_high | 60g | 11 | +0.076 | +1.69 | +0.99% | +3.3% |

✓ = Bonferroni sonrası anlamlı (|t| ≥ 3.6)

**Sıkışma buradadır:** sinyal ancak 1 günlük ufukta istatistiksel olarak
kanıtlanabiliyor — orada da büyüklüğü **2 baz puan**, işlem maliyeti ise
**20 baz puan**. Maliyet sinyalin 10 katı. Maliyetin sorun olmadığı uzun
ufuklarda ise bağımsız dönem sayısı (11–34) kanıt için yetersiz.

---

## 5. Karşılaştırma tabanı — bağlam

| | Değer |
|---|---|
| Hepsini al, 10 gün tut | %+0.95 / 10 gün |
| Eşit ağırlıklı 50 hisse, 3 yıl | %+56 toplam · **yıllık %+15.9** |

Türkiye yüksek enflasyon ortamında; **nominal getiri tek başına beceri
göstergesi değildir.** Sistem fiilen %98–100 kapsamla çalıştığı için pratikte
eşit ağırlıklı bir endeks fonu gibi davranıyor — yalnızca öyle olduğunu
söylemiyor.

---

## 6. Ölçülebilen tek etki: getiri değil, RİSK

`ml/experiment_lowvol.py` — aylık dengelenen portföyler, maliyet dâhil, 37 dönem.

| Strateji | Yıllık | Oynaklık | Sharpe | En kötü ay |
|---|---|---|---|---|
| eşit ağırlık (taban) | %28.9 | %26.8 | 0.96 | −%12.1 |
| **en düşük oynaklık %20** | %30.6 | %24.3 | **1.11** | −%10.1 |
| en düşük oynaklık %40 | %29.7 | %27.4 | 0.96 | −%12.3 |
| en YÜKSEK oynaklık %20 | %18.0 | %28.6 | **0.58** | −%17.8 |
| 52h zirveye yakın %20 | %30.4 | %29.8 | 0.90 | −%15.6 |
| 52h zirveden uzak %20 | %17.9 | %32.7 | **0.51** | −%14.2 |

**Nasıl okunmalı — dürüst hâli:**

- Sıralama teoriyle uyumlu ve **monoton**: düşük oynaklık (1.11) > taban (0.96)
  > yüksek oynaklık (0.58). Düşük oynaklık anomalisi literatürde sağlamdır.
- Ama **düşük oynaklık ile tabanın farkı kanıtlanmış değildir**: +0.15 Sharpe,
  37 dönemde standart hata ≈0.23. Bir standart hatanın içinde.
- **Kanıta en yakın olan negatif bulgulardır** ve fark büyüktür: yüksek
  oynaklıklı %20'yi almak (0.58) ve 52 haftalık zirveden en uzak %20'yi almak
  (0.51) tabana göre belirgin şekilde kötü.
- 6 strateji denendi → çoklu-deneme yanlılığı riski var.
- 3 yıl, tek ülke, tek rejim (enflasyonlu boğa). Başka rejimde geçerliliği
  bilinmiyor.

Yani savunulabilir ifade şudur: **"kötüden kaçınmak", "iyiyi seçmek"ten daha
güvenilir biçimde ölçülebiliyor.**

---

## 7. Neden alternatif veri şu an çözüm değil

Proje haber ve temel veriyi topluyor ama modele vermiyor. Geriye dönük test
edilebilirlik kontrol edildi:

| Kaynak | Kayıt | Gerçek derinlik |
|---|---|---|
| `MarketSignals` (haber) | 10.448 | **~37 gün** (Tem 2026: 30 gün, Ağu: 7) |
| `FundamentalData` | 2.468 | **17 gün** (8 Tem 2026'dan itibaren) |

Öncesi birkaç dağınık kayıttan ibaret. **Bu veriyle geriye dönük doğrulama
yapılamaz.** Anlamlı bir test için noktasal-zamanlı (point-in-time) birikimin
aylarca sürmesi gerekir — Faz 1 altyapısı bunu zaten topluyor.

---

## 8. Bir daha denenmemesi gerekenler

| Deneme | Sonuç | Neden tekrar denemeye değmez |
|---|---|---|
| LGBM hiperparametre ayarı | — | Sorun kapasitede değil, bilgi setinde (§3) |
| LambdaRank / sıralama hedefi | t=+0.37 | Denendi |
| Gün-ağırlıklı loss | t=+0.96 | Denendi |
| Lojistik regresyon | t=+0.01 | Denendi |
| Elle özellik seçimi | t=−0.29 | Dürüst seçimde sinyal yok (§3) |
| Ufuk değiştirmek | — | Maliyet/kanıt sıkışması (§4) |
| Haber/temel özellik eklemek | — | **Şimdilik** test edilemez (§7) |

---

## 8.1 Meta-labeling neden kapatıldı (13.08.2026)

`META_ENABLED = False`. **Kod silinmedi.**

Meta katmanın işi "modelin AL sinyallerinden hangileri tutar" sorusunu haber ve
rejim bağlamıyla cevaplamaktı. Ama §2'de ölçüldüğü gibi ana model zaten hisse
**sıralayamıyor** (gün-içi Spearman −0.007, t = −0.78, 485 gün). Sıralayamayan
bir sinyal kümesini veto etmek ölçülebilir katkı üretmiyor; karar zincirine bir
kat daha karmaşıklık ve bir log dosyası daha ekliyordu.

**Plandan bilinçli sapma:** `docs/PLAN_2026-08.md` §G "meta_log.csv yazımı durur"
diyordu; **durdurulmadı.** O log meta katmanın gelecekteki eğitim verisidir;
yazımı durdurmak 180 güne ulaşma saatini sıfırlar ve katmanı hiç ölçemez hâle
getirirdi. Yazım sürüyor, yalnız veto ve boyut çarpanı devre dışı.

**Ne zaman tekrar açılır:** haber özelliği derinliği 180 güne ulaşınca
(`GET /admin/data-depth`, Model → Kanıt sekmesinde görünür) katmanın katkısı
ölçülebilir hâle gelir. 13.08.2026'da 18 gündü.

---

## 8.2 Noktasal-zamanlılık denetimi (B1) — bulunan sızıntı

Son 30 günün 9.163 haber kaydı denetlendi. `event_ts` (PublishedAt) ve
`ingest_ts` (CreatedAt) her kayıtta dolu; yakalama kesintisiz çalışıyor.

**Ama 182 kayıtta (%1,99) `published_at > ingest_at`** — haber, alındığından
*sonra* yayınlanmış görünüyor. Fiziksel olarak imkânsız.

| | |
|---|---|
| Etkilenen kaynak | **yalnız CNN Türk Ekonomi** (182/182) |
| En büyük ileri fark | **180 dakika** (tam 3 saat) |
| Ortalama | 138 dakika |

Teşhis: kaynak, saat dilimi bilgisi olmayan bir `pubDate` yayınlıyor;
`feedparser` bunu UTC sanıyor, oysa yerel saat (UTC+3). Ayrıştırma kodumuz
doğru — veri kalitesi sorunu.

**Neden önemli:** eğitimde as-of join `published_at` ile yapılıyor. Kırpılmazsa
o kaynağın haberleri 3 saat erken "biliniyor" sayılır — gizli geleceğe bakma
sızıntısı.

**Düzeltme:** `_entry_published_utc` artık `min(published, now)` döndürüyor.
Gerekçe ilkenin kendisi: *bir bilgiyi aldığından önce bilmiş sayılamazsın.*

---

## 8.3 Genel denetim (17.08.2026) — kalibratör gerçeği yalanlıyor

Denetimin en önemli bulgusu. Sağlık kontrolü "KALİBRASYON SAPMIŞ" derken öz
denetim **11/11 PASS** veriyordu ve Kelly, ölçümün yanlışladığı bir olasılıkla
pozisyon açmaya devam ediyordu. Hiçbir değişmez bunu yakalamıyordu: I6
kalibratörün **yapısını** sınıyor (monoton mu, aralık makul mu), **çıktısını
gerçekleşmeyle karşılaştırmıyordu**.

**Önce yöntemi düzelttim.** Rapor ECE'yi 401 tahmin üzerinden hesaplıyordu ama
bu tahminler **10 güne** yayılıyor; aynı günün 50 sembolü aynı piyasa hareketini
paylaşır. Bu §1'deki hatanın aynısı. Gün düzeyinde yeniden ölçüldü:

| Gün | Gözlenen UP | Gün | Gözlenen UP |
|---|---|---|---|
| 07-08 | %57,9 | 07-19 | %22,5 |
| 07-09 | %56,4 | 07-23 | %13,6 |
| 07-10 | %43,6 | 07-24 | %26,8 |
| 07-13 | %38,5 | 07-27 | %29,7 |
| 07-16 | %17,8 | 07-28 | %41,0 |

Gün ortalaması **%34,8** · sd 0,153 · standart hata 0,048 (n=10 gün).

**Sapma gerçek — kümelenmeye rağmen ayakta kalıyor:**

| Karşılaştırma | Fark | t | Sonuç |
|---|---|---|---|
| Kalibratörün dediği %52,8 | −0,185 | **−3,73** | sapma KANITLI |
| Başabaş olasılık %42,0 | −0,072 | −1,49 | **kanıtlanmadı** |

İkinci satır önemli: gözlenen oran başabaşın *altında* görünüyor ama 10 günle
bu **istatistiksel olarak gösterilemiyor**. Yani "açılan tüm pozisyonlar
negatif-EV" demek aşırı iddia olur — nokta tahmini öyle diyor, güven aralığı
demiyor.

**Sonucun ağırlığı — sapma boyutu değil, kararın İŞARETİNİ değiştiriyor:**

| p | EV (R) | Kelly boyutu |
|---|---|---|
| 0,533 (kalibratörün dediği) | **+0,57** | **%5,55 → pozisyon açılır** |
| 0,348 (gün düzeyinde gözlenen) | −0,40 | **%0 → hiç açılmaz** |

**Düzeltmeler:**
- Kalibrasyon kararı artık gün ortalamaları üzerinde t-testi (|t| > 2), havuzlanmış
  ECE değil. ECE raporlanmaya devam eder ama "anlamlılık için KULLANILMAZ" notuyla.
- `MIN_EVAL_DAYS = 10` — satır eşiği tek başına yetmez.
- **Yeni değişmez I12**: kalibratör ölçülmüş olarak sapmışken boyutlandırmayı
  besliyorsa **FAIL**. Bugün FAIL veriyor; sorun artık sessiz değil.
- Standart hataya **binom tabanı**: günlerin oranı birebir aynı çıktığında sd
  kayan nokta artığı kadar kalıyor, se ~1e-17 oluyor ve t 1e14'e patlıyordu.

**Karar (17.08.2026, kullanıcı yetki verdi — "önerilerine göre uygula"):**
Kelly'ye kapı eklemek yerine kök neden çözüldü: kalibratör walk-forward ile
tazelendi (24 adım, 19.725 OOS tahmin, yeni dönem dahil).

| | Eski (08.07) | Yeni (17.08) |
|---|---|---|
| Kalibre tavan | 0,5331 | **0,5251** |
| Fit verisi | Temmuz'a kadar | Ağustos ortasına kadar |

Tavan p için EV hâlâ pozitif (+0,53R) → sistem işlem açmaya devam eder, biraz
daha küçük boyutla. Bu bilinçli: yeni kalibratör 19.725 OOS örnekle fit edildi,
10 günlük kötü canlı dönem o havuzda azınlıkta. Ölçüm ne derse o.

**Kapsam kuralı (yeni):** kalibrasyon raporu artık yalnız **mevcut kalibratörün
ürettiği** tahminleri yargılar (`fitted_at` sonrası — I11'in `RISK_FILTER_SINCE`
deseninin aynısı). Eski kalibratörün 401 tahmini kapsam dışı; onları yenisinin
suçu saymak düzeltilemez bir suçlama olurdu. I12 bu yüzden FAIL'den SKIP'e
döndü: "yeni kalibratör henüz ölçülmedi, birikiyor". Değerlendirme ~20 gün
gecikmeli aktığı için ilk dürüst okuma Eylül ortasında gelir; sapma tekrar
çıkarsa I12 yine FAIL verir.

---

## 8.4 Ölçülemeyen ölçüt, ölçüt değildir (17.08.2026)

§A0'da 2027-02-12 için ölçütler önceden çivilenmişti (Sharpe, en kötü ay) ama
**hiçbir kod onları hesaplamıyordu**. Karar günü elle hesaplamak, tam o anda
"şöyle hesaplayalım" kararının sızmasına kapı açar — önceden kayıt böylece
değerini yitirir. İki kusur çıktı:

**1. "En kötü ay" ölçütü yapısal olarak yanlıydı.** İki defterin kaldıracı aynı
değil (ölçüm: ana %43,6 · gölge %74,7 yatırımda, oran sabit 0,583). Sharpe sabit
kaldıraca duyarsızdır (oran sadeleşir) ama en kötü ay duyarlıdır: ana defter
**filtre hiçbir şey yapmasa bile** ~0,58 katı iyi görünürdü. Ölçüt maruziyete
göre normalize edildi. Gölge defterde **0 kapanmış işlem** varken düzeltildi —
sonuç bilinmiyordu, gol direği kaydırılmadı.

**2. Sharpe düzensiz örneklemeyi yok sayıyordu.** Bilgisayar sürekli açık değil:
40 takvim gününde 16 günlük kayıt, boşluklar 1,1,**14**,3,1,1,1,1,3,1,1,2,**5**,1,**4** gün.
Ardışık kayıtları "günlük getiri" saymak 14 günlük hareketi 1 güne sıkıştırır.
Gerçekleşen varyans yaklaşımıyla düzeltildi (r/√Δd, iş günü bazında):

| | Sharpe |
|---|---|
| Boşluk düzeltmesiz | −0,912 |
| Boşluk düzeltmeli | **−0,555** |

%39 fark. Karar günü bu fark yönü değiştirebilirdi.

Ölçütler artık `/admin/filter-decision` ile okunuyor; hesap sonuç bilinmezken
sabitlendi ve testlerle çivilendi.

**İkinci tur düzeltmesi (aynı gün):** doğrulama turunda kendi kodumda üçüncü
bir kusur çıktı — ana defterin serisi 08.07'den başlıyordu, filtre ise 14.08'de
doğdu. Plan "AYNI dönemde" karşılaştırma şart koşarken ana defterin Sharpe'ına
**filtresiz geçen 5 hafta** karışıyordu. Ölçüm penceresi artık iki defter için
de `RISK_FILTER_SINCE` (2026-08-14) ile başlar; `window_start` çıktıda görünür.
Pencere uygulanınca bugünkü dürüst durum: her iki defterde 1 günlük kayıt —
"günlük kayıt yetersiz". Ölçüm gerçekten bugün başlıyor; Şubat'a kadar birikecek.

---

## 8.5 Dürüstlük katmanının kendisi yalan söylüyordu (17.08.2026)

Boot sırasında **öz denetim, sağlık kontrolünden ÖNCE** çalışıyordu. Sonuç: bir
önceki kapanıştan kalan bayat `drift_report` okunuyor, I10 "health 3,8 gün
gecikmiş" diyor, rapor 2 saniye sonra tazeleniyordu. Sonuç diske yazıldığı ve
durum çubuğu **önbellekten** okuduğu için bu sahte uyarı akşam 19:25'e kadar
ekranda kalıyordu — her gün.

Sıra düzeltildi (sağlık → öz denetim; zamanlayıcıdaki 19:20 → 19:25 sırasının
aynısı). Ayrıca I10 metni saatleri gün olarak yazdığı için 4 saatlik `analyze`
sınırını **"0 gün sınırı"**, 36 saatlik `health` sınırını "2 gün sınırı" diye
gösteriyordu; `_dur()` ile düzeltildi.

Ders: uyarı üreten katmanın kendi girdisinin tazeliğini garanti etmesi gerekir.

---

## 8.6 Kalibratör kuyruğu ve üç ölçüm hatası (26.08.2026)

Gidişat değerlendirmesi sırasında bulundu. Model kâğıt üzerinde **iyileşmiş**
görünüyor (AUC 0,529 → 0,563; gün düzeyi lift +2,32 puan, t=2,13 — ilk kez
sıfırdan ayrı), ama dört ayrı kusur çıktı.

### Kalibratörün üst ucu uydurmaydı

17.08 tazelemesinden sonra isotonic eğrisi:

| ham p | kalibre p |
|---|---|
| 0,345 – 0,725 | **0,5251 (tamamen düz)** |
| 0,875 | 0,965 |
| ≥ 0,90 | **0,990** |

Düz kısım dürüsttür — "bu aralıkta ayrım yok" der ve sıralama sonucuyla
(Spearman ≈ 0) birebir tutarlıdır. Sorun uçtaydı: **350 canlı tahminin 52'si
(%14,9) p_cal ≥ 0,90 aldı** ve Kelly bunları **%10 tavanına** taşıdı (0,5251'de
%5,2 idi). Oysa o bölgeyi içeren üst kutunun (n=2466) gözlenen oranı **%57,2**.
Isotonic kuyruğu ezberlemişti. %99'luk bir kalibre olasılık, AUC 0,56 olan bir
modelle bağdaşmaz.

**Düzeltme — desteklenmeyen basamak iddia edilmez.** Her isotonic basamağının
arkasında en az `MIN_CALIB_SUPPORT` (200) satır **ve** `MIN_CALIB_SUPPORT_DAYS`
(10) **bağımsız gün** olmalı. Gün kapısı şart: 200 satır tek haftadan gelebilir —
PSI (600 satır / 8 gün) ve kalibrasyon raporu (401 satır / 10 gün) hatalarının
aynısı. Bunun için OOS tarihleri walk-forward'dan kalibratöre kadar taşındı.

Sonuç (26.08 fit, 19.726 OOS): **tavan 0,6425**, 161 OOS örneği tavana indi.

| ham p | önce | sonra |
|---|---|---|
| 0,60 | 0,5378 | 0,5378 *(dürüst kısım korundu)* |
| 0,85 | 0,7500 | **0,6425** |
| 0,95 | 0,9900 | **0,6425** |

EV +2,85R → +1,11R. **Not:** Kelly, p_cal ≥ 0,64'te `MAX_POSITION_PCT` tavanına
dayandığı için en üstteki pozisyonlar hâlâ %10. Kırpma *iddiayı* düzeltti,
*tavanı* değil — 0,6425 gerçekten 200+ satır ve 10+ günle desteklenen bir
seviye. Tavanı düşürmek ayrı bir karardır ve kullanıcıya aittir.

### I11 filtreyi yapmadığı şeyden suçluyordu

26.08'de kapsam %0'a düştü ve I11 uyardı. Ama sebep filtre **değildi**: ham
p'nin tamamı `BUY_THRESHOLD`'un (0,58) altındaydı — maksimum 0,5165 — yani
filtre hiç devreye girmedi. Rejim kapısı da RISK_ON'du. Filtreyi kaldırsak o gün
yine %0 olurdu.

Bu önemli çünkü §A0'daki başarısızlık ölçütü "10 gün bant dışı → filtre
KALDIRILIR" diyor. Ölçüm düzeltilmeseydi ölçüt, filtreyi ilgisiz bir sebeple
kaldırabilirdi. Artık `rec_dir_nofilter` (filtre öncesi yön) loglanıyor ve I11
bir günü ancak **filtre öncesi kapsam bantta iken filtre sonrası bandın altına
indiyse** filtreye yazıyor. Atfedilemeyen günler ayrıca ve **ayrı bir cümleyle**
raporlanıyor — "bilmiyorum" ile "ölçtüm, sebebi bu değil" karıştırılmamalı.

### I2 sahte sapma veriyordu (kendi düzeltmemin eksiği)

I2, bir döngünün tahminlerini **bir sonraki döngünün** özellik fotoğrafıyla
eşleştirip "39/50 sembolde sapma" dedi. Eşleştirme koşulu mutlak farka bakıyordu
(`|a−b| ≤ 600`), oysa bir döngüde önce özellikler yazılır sonra tahminler — yani
eşleşen tahmin fotoğraftan **sonra** olmalı. Koşul `0 ≤ (b−a) ≤ 600` oldu.
Kesitsel rank kullanıldığı için 5 dakikalık fiyat hareketi bile sıraları oynatıp
p'yi belirgin değiştiriyor; sahte sapmanın büyüklüğü (0,4465) bundan.

### Gölge defter ana defterin işlemlerini gösteriyordu

`_read_trades` yolu doğru hesaplıyor, varlığını doğru kontrol ediyor, sonra
modül düzeyindeki `TRADES_FILE`'ı (ana defter) açıyordu. Gölge defter, ana
defterin 37 işlemini kendi istatistiği gibi gösteriyordu; gerçekte 2 işlemi
vardı. Defterleri parametreleştirirken atlanan tek satır.

Sharpe ve en kötü ay `equity_history`'den geldiği için **2027-02-12 ölçütleri
etkilenmemişti**; bozulan yalnız işlem türevli göstergelerdi (sayı, kazanma
oranı, profit factor).

### Kâğıt portföyün güncel durumu

| Defter | Getiri | Ölçüt | Fark | İşlem |
|---|---|---|---|---|
| Ana (filtre + Kelly) | +%1,22 | +%2,84 | **−1,6 p** | 37 |
| Gölge (filtresiz, eşit ağırlık) | +%5,32 | +%3,97 | +1,4 p | 2 |

13 günlük veri — hiçbir şey kanıtlamaz, ama yön şu an filtrenin aleyhine.

### Canlı kanıt hâlâ eski rejimi anlatıyor

Canlı lift +2,02 puan görünüyor; ama değerlendirilen 624 tahminin **574'ü (%92)
AL sinyaliydi**. %92 kapsamda "AL" bir seçim değil, "hepsini al" demektir. Gün
düzeyinde ölçülünce lift **+0,15 puan** (t=2,09) — sıfırdan ayrı ama %42 başabaş
ve işlem maliyeti karşısında ekonomik olarak hiç. Kapsamın %20-30'a indiği yeni
rejimden **henüz olgunlaşmış tek sonuç yok**; ilk dürüst okuma Eylül ortası.

---

## 8.7 Kod incelemesi ve sızıntı testleri (04.09.2026)

Kıdemli FinML incelemesi. Şimdiye kadar walk-forward'un dürüstlüğü **kod
okuyarak** savunuluyordu; ilk kez **sınandı** (`ml/experiment_leakage.py`).

### Sızıntı testi — üç senaryo

| Test | AUC | Beklenen | Yargı |
|---|---|---|---|
| Referans (gerçek etiket, gerçek purge) | 0,5459 | — | — |
| **A** · etiketler global karıştırıldı | **0,4977** | ≈0,500 | ✓ temiz |
| **B** · etiketler GÜN İÇİNDE karıştırıldı | **0,5506** | ≈0,500 | ✗ **beklenmedik** |
| **C** · purge sıfırlandı (kasıtlı sızıntı) | 0,5667 | referanstan yüksek | ✓ purge iş görüyor |

**A geçti:** klasik anlamda özellik–etiket sızıntısı YOK. **C geçti:** purge
gerçekten koruma sağlıyor (kaldırılınca skor +0,021 sıçrıyor), yani walk-forward
mimarisi çalışıyor.

**B kaldı ve asıl bulgu bu.** Gün içi karıştırma, gün etkisini korur ama
kesitsel bağı koparır. AUC yine de 0,5506 çıktı — üstelik gerçek etiketlerden
(0,5459) **yüksek**. Anlamı: havuzlanmış AUC seçicilik değil, **gün etkisi**
ölçüyor. §2'deki gün-içi Spearman ≈ 0 bulgusuyla bağımsız yoldan aynı sonuca
varıyor.

### Sebep: kesitsel rank dejenerasyonu

B'nin sebebi arandı ve bulundu. `usdtry_ret5` **piyasa geneli** bir seri —
aynı gün tüm sembollerde AYNI değer. `XSEC_RANK` bunu gün-içi percentile'a
çevirince hepsi berabere kalıyor ve pandas ortalama sırayı veriyor:

> rank_pct = (n + 1) / (2n),  n = o günkü sembol sayısı

Ölçüldü — gözlenen değerler formülle **birebir**:

| n | gözlenen | (n+1)/(2n) |
|---|---|---|
| 1 | 1,000000 | 1,000000 |
| 9 | 0,555556 | 0,555556 |
| 25 | 0,520000 | 0,520000 |
| 29 | 0,517241 | 0,517241 |

27 farklı değer, 0,510–1,000 aralığında, sembol sayısıyla korelasyon −0,45.

İki sonucu var:

1. **Özellik sıfır bilgi taşıyor** ama şampiyon künyesinde **%7,3 ağırlıkla
   3. sırada**. Model kapasitesinin bir kısmı boşa gidiyor.
2. **Gün kimliğini sızdırıyor.** Saf kesitsel olması gereken modele "bugün
   hangi gün" bilgisi giriyor — B testinin 0,50'ye düşmemesinin sebebi.

Bu bir **geleceğe bakma sızıntısı değil** (evren büyüklüğü o gün bilinir), ama
havuzlanmış AUC'yi "hisse seçme becerisi" diye okumayı geçersiz kılar.

`ml/experiment_xsec.py` bu özelliğin MUTLAK hâlinin de zararlı olduğunu zaten
ölçmüştü (AUC 0,46, lift −4,2p). Yani ne ham ne rank'li hâli işe yarıyordu.

### ÇIKARILDI ve hipotez doğrulandı (04.09.2026)

Özellik `FEATURE_NAMES`'ten silindi (21 → 20), şampiyon yeniden eğitildi,
kalibratör tazelendi. Sonuç hipotezi **kanıtladı**:

| | Sızıntılı | Temiz | Fark |
|---|---|---|---|
| Havuzlanmış AUC | 0,5459 | **0,5078** | −0,038 |
| Yön doğruluğu | %52,6 | %50,3 | −2,3 p |
| Havuzlanmış lift | +0,0331 | +0,0130 | −0,020 |

**Sıfır bilgi taşıyan bir özelliği çıkarmak AUC'yi 0,546'dan 0,508'e düşürdü.**
Bu, farkın gerçek tahmin gücü değil gün kimliği olduğunun doğrudan kanıtıdır.
AUC artık 0,50'ye komşu — yani modelin GERÇEK kesitsel ayrım gücü bu.

Bunun önemi: §2'deki gün düzeyi Spearman ölçümü (≈0) ile havuzlanmış AUC (0,546)
birbiriyle **çelişiyordu** ve bu çelişki açıklanmamıştı. Artık çelişki yok —
ikisi de "kesitsel beceri yok" diyor. Çelişkinin sebebi bu özellikmiş.

§2 yeniden ölçüldü: dosyadaki tek "anlamlı" bulgu (sabit eşik t=2,13) **t=1,70'e
indi ve anlamlılığını kaybetti**. Model künyesinde boşalan %7,3 ağırlık gerçek
özelliklere dağıldı (ema200_trend 6,3→7,7; atr_pct 5,9→6,9).

**Permütasyon testi neden yapılmadı:** t=2,13'ün ampirik p-değerini ölçmek için
planlanmıştı. O iddia artık yok (en yüksek t=1,81, hiçbiri anlamlı değil).
Hiçbir kararı değiştiremeyecek bir testi çalıştırmak ölçüm değil ritüel olurdu.

**Yan bulgu — I9 sahte İHLAL verdi.** Şampiyon yeniden eğitilince kesim tarihi
ileri kaydı ve I9, GEÇMİŞTE dürüst yapılmış terfi kontrolünü yeni kesime göre
yargılayıp "pencere 2026-06-24, kesim 2026-08-21 ÖNCESİNDE" dedi. Terfi kaydı
o anki kesimi `champion_cutoff` olarak zaten saklıyor; referans ona çevrildi.
Bu, I11'in `RISK_FILTER_SINCE` ve kalibrasyon raporunun `fitted_at` kurallarıyla
aynı ilke: **bir bileşen ancak kendi döneminin verisiyle yargılanır.**

Not: gün içi sabit olan TEK özellik bu (21 özellik tarandı). Dejenere günler
(n<20) ihmal edilebilir: 31.086 satırın 11'i.

### Hayatta kalma yanlılığı — bu dosyanın eksiğiydi

`ml/universe.py`'deki `BIST50_TICKERS` **bugün** kürasyonu yapılmış sabit bir
liste; eğitim seti 2023-09 → 2026-08. 2023'te likit olup sonradan endeksten
düşen, birleşen veya işlem görmez hâle gelen semboller veri setinde **yok**.

Bu dosya beş yanlılığı (seçim, örtüşme, çoklu deneme, gün kümelenmesi, rejim)
titizlikle sayıyordu ama bunu anmıyordu. Etkisi tek yönlü: **ölçülen performans
yukarı yanlı**. Yani §0'daki "kenar yok" sonucu bu bulguyla çürümez, aksine
güçlenir — gerçek kenar ölçülenden muhtemelen daha kötü.

### Düzeltilen: değerlendirmede düzeltme tabanı uyuşmazlığı

`evaluate_ml` giriş fiyatını **logdan** (tahmin anında yazılan), bariyer
barlarını **bugün** `auto_adjust=True` ile alıyordu. Araya temettü/bedelsiz
girerse yfinance geçmiş fiyatları geriye dönük düşürür, logdaki giriş eski
tabanda kalır → hisse düşmüş görünür → **sahte SL**. BIST'te temettü ve
bedelsiz sık olduğu için bu "eninde sonunda" değil "her ilkbahar" ısırırdı.

12 sembolde ölçüldü: şu an sapma yok (örneklem temmuz-eylül, temettü sezonu
dışı). Yani açık **uykudaydı**. Düzeltildi: giriş fiyatı artık AYNI indirmeden
alınıyor, pencere `ml/labels.py` ile birebir aynı (`i+1 .. i+HORIZON`) ve
hafta sonu loglanan tahminler için giriş barı geriye doğru aranıyor. Ayrışma
saptanırsa artık sonucu bozmuyor, syslog'a sayı olarak düşüyor.

### Eğitim/canlı özellik penceresi — ölçüldü, küçük

Eğitim 3 yıl (756 bar), canlı 1 yıl (255 bar) indiriyor. EMA200 özyinelemeli
olduğu için yakınsamamış oluyor: `ema200_trend` −0,00332 yerine −0,00483
(%46 göreli fark). Ama kesitsel etkisi küçük: 14 sembolde rank korelasyonu
**0,9912**, ortalama sıra kayması 0,02, özellik ağırlığı %6,3. Diğer özellikler
ihmal edilebilir farkta; en ağırlıklı `above_ema200` (%16,1) hiç etkilenmiyor.

**Önemli olan yan bulgu:** `I2` bu hata sınıfını **yakalayamaz**. I2, loglanan
özelliklerden p'yi yeniden hesaplayıp loglanan p ile kıyaslar — iki taraf da
canlı özellikleri kullanır. Ham veriden özelliğe giden yol hiç sınanmaz.

### Temiz çıkanlar (sınandı, sorun yok)

- `ml/labels.py`: gelecek penceresi `i+1`'den başlıyor, döngü `n−horizon`'da
  bitiyor, ATR giriş gününe kadarki veriden → sızıntı yok.
- Aynı gün TP+SL çakışması etiketlemede ve kâğıt işlemde AYNI muhafazakâr
  kuralı (DOWN) uyguluyor.
- `xsec_rank` eğitim ve canlı yolda birebir aynı matematik.
- Bağlam serileri `reindex + ffill` ile hizalanıyor, geleceğe bakmıyor.
- **Isınma dönemi endişesi doğrulanmadı:** `compute_features`'ın NaN→0
  doldurması ısınmada `price_vs_52w_high`'ı "tam zirvede" gösterebilirdi. 749
  günün 219'unda TÜM semboller ısınmada olduğu için berabere kalıp rank 0,5'e
  (nötr) düşüyor; yalnız **1 gün** karışık. Kesitsel rank tasarımı bu hatayı
  kendiliğinden emmiş.

---

## 9. Buradan sonrası — üç dürüst seçenek

1. **Arayüzü gerçeğe uydur.** Bugün 50 hissenin 49'una "GÜÇLÜ ALIM · %53 güven"
   yazıyor. Ölçüm bu iddiayı desteklemiyor. En somut kusur budur.
2. **Ürünü risk tarafına çevir.** Getiri tahmini yerine "yüksek oynaklıklı ve
   zirveden uzak hisselerden kaçın" filtresi — §6'daki en güvenilir bulgu.
3. **Veri biriktir, sonra tekrar bak.** Haber/temel için 6–12 ay noktasal-zamanlı
   birikim; §7'deki tabloyu yeniden çalıştırmak yeterli olacak.

Hangisi seçilirse seçilsin: **model bugünkü hâliyle para kararına dayanak
oluşturacak bir sıralama üretmiyor** ve arayüz bunu söylemelidir.
