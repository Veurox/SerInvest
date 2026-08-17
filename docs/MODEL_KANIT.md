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

`ml/experiment_ranking.py` — walk-forward OOS, **19.898 tahmin · 485 gün**.

| Ölçüt | Değer | t | Yargı |
|---|---|---|---|
| Gün-içi Spearman(p, sonuç) | −0.0073 | −0.78 | şanstan ayırt edilemez |
| En iyi 1/3 − en kötü 1/3 | −0.0175 | −1.88 | şanstan ayırt edilemez |
| Günler arası zamanlama (r) | −0.0416 | — | yok |

Strateji karşılaştırması (günlük lift = precision − o günün tabanı):

| Strateji | Kapsam | Precision | Lift | t |
|---|---|---|---|---|
| sabit eşik p≥0.58 | %20 | %53.0 | +0.0232 | +2.13 |
| kesitsel en iyi %5 | %5 | %52.7 | +0.0231 | +1.75 |
| kesitsel en iyi %20 | %20 | %50.3 | −0.0012 | −0.16 |
| hepsini al (taban) | %100 | %50.4 | 0 | — |

**Sabit eşiğin t=2.13'ü kenar sayılmaz:** (a) 7 strateji denendi, Bonferroni
düzeltmesiyle eşik ≈2.7; (b) kenar, aynı kapsamdaki kesitsel seçimde tamamen
kayboluyor — yani hisse *seçmekten* değil, işlem yapılan *gün sayısından*
(414/485) geliyor.

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

## 9. Buradan sonrası — üç dürüst seçenek

1. **Arayüzü gerçeğe uydur.** Bugün 50 hissenin 49'una "GÜÇLÜ ALIM · %53 güven"
   yazıyor. Ölçüm bu iddiayı desteklemiyor. En somut kusur budur.
2. **Ürünü risk tarafına çevir.** Getiri tahmini yerine "yüksek oynaklıklı ve
   zirveden uzak hisselerden kaçın" filtresi — §6'daki en güvenilir bulgu.
3. **Veri biriktir, sonra tekrar bak.** Haber/temel için 6–12 ay noktasal-zamanlı
   birikim; §7'deki tabloyu yeniden çalıştırmak yeterli olacak.

Hangisi seçilirse seçilsin: **model bugünkü hâliyle para kararına dayanak
oluşturacak bir sıralama üretmiyor** ve arayüz bunu söylemelidir.
