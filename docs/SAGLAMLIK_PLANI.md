# SerInvest — Sağlamlık Planı: "Neden hep yeni sorun çıkıyor?"

> Tarih: 2026-08-07 · Bu belge bir özellik planı **değildir**.
> Bir **hata sınıfını ortadan kaldırma** planıdır.

---

## 1. Dürüst Teşhis

Kullanıcı haklı: bu oturumda 23 kusur düzeltildi ve neredeyse her düzeltme bir
sonrakini açığa çıkardı. Bu tesadüf değil, **yapısal**.

### 1.1 Kanıt: sistemde hiç güvenlik ağı yok

```
Test dosyası      : 0
CI / otomasyon    : yok
Test kütüphanesi  : tanımlı değil
Kod büyüklüğü     : ~20.000 satır · 9 servis · para kararı üretiyor
```

Her değişiklik **tek seferlik bir betikle** doğrulandı, betik silindi, bilgi
uçtu. Hiçbir şey bir sonraki değişikliğin öncekini bozmasını engellemiyor.

### 1.2 Bu oturumdaki 23 kusurun dağılımı

| Sınıf | Adet | Örnek |
|---|---:|---|
| **SESSİZ BAŞARISIZLIK** (hata vermez, yanlış davranır) | **9** | Terfi şampiyonu kendi eğitim verisinde sınıyordu → model 1 ay donuk kaldı, kimse fark etmedi |
| UI dayanıklılık / yerleşim | 5 | `DriftBadge` bilinmeyen durumda çöküyor → **tüm uygulama beyaz ekran** |
| Birim / anlam uyuşmazlığı | 3 | Grafik `t` milisaniye, kod saniye varsaydı; log tarihi yerel vs UTC |
| Yinelenen/bayat sabit | 2 | Backend eşiği 150'ye çıktı, arayüzde `30` elle yazılıydı |
| İstatistiksel eşik hatası | 2 | 38 örnekle "kalibrasyon sapmış" alarmı (bin başına 7 örnek) |
| Veri bütünlüğü | 2 | Mükerrer işlem kaydı; yarım yazılmış CSV |

**Baskın sınıf sessiz başarısızlık: 23'ün 9'u.** Sistem hata vermiyor, sessizce
yanlış şeyi yapıyor. Bunları ancak sen ekranda tuhaf bir şey görünce fark
ediyoruz. Bu, test edilmeyen sistemlerin imza hatasıdır.

### 1.3 Kök nedenler (semptom değil)

| # | Kök neden | Nasıl kendini gösterdi |
|---|---|---|
| **K1** | **Otomatik doğrulama yok** | Her regresyon kullanıcı tarafından bulundu |
| **K2** | **Sabitler iki yerde** | `MIN_EVAL_ROWS` backend'de 150, arayüzde `30` |
| **K3** | **Değişikliğin etki alanı taranmıyor** | Kalibrasyon eklendi → kademe mantığı, sıralama, arayüz metni bozuldu; hiçbiri kontrol edilmedi |
| **K4** | **Anlamlar örtük** | "Hangi p nerede kullanılır", "tarih hangi bazda" yalnızca yorum satırında yaşıyordu |
| **K5** | **Modelin davranış zarfı izlenmiyor** | Kapsam %29'dan %98'e çıktı, hiçbir uyarı yok |

---

## 2. Araştırma: Bu iş nasıl yapılmalı?

Bu problem çözülmüş bir problem. Referans:
[**ML Test Score** (Breck, Cai, Nielsen, Salib, Sculley — Google, IEEE Big Data 2017)](https://research.google/pubs/the-ml-test-score-a-rubric-for-ml-production-readiness-and-technical-debt-reduction/)
ve [Hidden Technical Debt in ML Systems (Sculley et al., NeurIPS 2015)](https://papers.nips.cc/paper/5656-hidden-technical-debt-in-machine-learning-systems).

Çerçeve dört başlık altında 28 test önerir. Bize doğrudan dokunan maddeler:

| ML Test Score maddesi | Bizdeki durum |
|---|---|
| *Feature expectations captured in a schema* | ✗ yok |
| *All input feature code is tested* | ✗ yok |
| **Training/serving skew tested** | ✗ yok → şüphe duyduğumuzda elle kontrol ettik |
| *Model specs are unit tested* | ✗ yok |
| *ML pipeline is integration tested* | ✗ yok |
| **Model quality validated before serving** | ~kısmen (terfi kapısı var, ama teraz bozuktu) |
| *Models can be rolled back* | ~kısmen (champion.joblib yedeği yok) |
| **Data invariants hold for inputs** | ✗ yok |
| **Prediction quality has not regressed** | ~kısmen (canlı isabet var, ama zarf kontrolü yok) |
| *Models are not too stale* | ✓ var (model yaşı gösteriliyor) |

Kritik ders (Sculley): ML sistemlerinde asıl borç kodda değil, **bileşenler
arası gizli bağımlılıklarda**. Bizim 23 kusurun 9'u tam olarak bu:
bir yerdeki değişikliğin başka yerdeki varsayımı sessizce geçersiz kılması.

**Ama proporsiyon önemli.** Bu kişisel bir proje; MLflow, feature store,
Kubernetes gibi kurumsal tiyatroya gerek yok. Gereken: **ucuz, otomatik,
sürekli çalışan bir güvenlik ağı.**

---

## 3. Çözüm Mimarisi: Dört Katmanlı Güvenlik Ağı

Öncelik sırası, **fayda/emek** oranına göre. Katman 1 tek başına bu oturumdaki
9 sessiz hatanın **7'sini** yakalardı.

### Katman 1 — Değişmezler (invariants) · EN YÜKSEK ÖNCELİK

Tek dosya: `ai-oracle-service/selftest.py`.
Sistem genelinde **doğru olması gereken** ifadeleri çalıştırılabilir hale getirir.
Boot'ta + günlük + istendiğinde çalışır, sonucu **arayüzde görünür**.

| Kod | Değişmez | Bu oturumda yakalardı |
|---|---|---|
| **I1** | `predictions.csv` ve `feature_log.csv` **aynı tarih bazında** (UTC) | ✔ #13 |
| **I2** | Bugünün loglanan özelliklerinden yeniden hesaplanan p, kayıtlı `p_up` ile ±0.01 içinde eşleşir (**train/serve skew**) | ✔ şüpheyi 1 saatte değil 1 saniyede çözerdi |
| **I3** | "GÜÇLÜ" içeren hiçbir öneri, `confidence < STRONG_BUY_P` olamaz | ✔ #14 |
| **I4** | Arayüze giden her eşik **config'ten** gelir; API yanıtında eşik alanı zorunlu | ✔ #8, #9 |
| **I5** | Canlı AL kapsamı, doğrulanmış zarfın (%5–%79) içinde | ✔ kapsam patlaması |
| **I6** | Kalibratör monoton ve [0,1] sınırlı | koruma |
| **I7** | `predictions.csv` şema geçerli: kolonlar tam, timestamp `20\d\d-` ile başlar | ✔ #4 |
| **I8** | Hiçbir logda mükerrer `(sembol, gün)`; `paper_trades`'te mükerrer işlem yok | ✔ #3 |
| **I9** | Terfi karşılaştırma penceresi şampiyonun `date_max`'inden **sonra** | ✔ #10 |
| **I10** | Zamanlanmış işlerin hiçbiri gecikme eşiğini aşmamış | ✔ #5, #12 |

Her değişmez: `(kod, açıklama, sonuç, kanıt)` döndürür. Kırmızı varsa
`StatusBar`'da ve Model sayfasında görünür — sessiz kalmaz.

### Katman 2 — Tek doğruluk kaynağı (sabitler)

`GET /admin/config` → arayüzün gösterdiği **her eşik** buradan gelir.
Arayüzde elle yazılmış sayı **yasak**; I4 bunu denetler.

### Katman 3 — Saf mantık testleri (pytest)

Ağ/dosya gerektirmeyen, milisaniyede çalışan gerçek testler:

| Modül | Test edilecek |
|---|---|
| `ml/labels.py` | triple-barrier: TP önce / SL önce / süre dolumu / eşitlik durumu |
| `ml/calibration.py` | EV formülü, Kelly kelepçesi, kimlik-fallback, monotonluk |
| `ml/monitoring.py` | PSI bilinen dağılımlarda; gün/satır kapıları |
| `ml_live.py` | `maturity()` sınır günleri; `_position_size` eşikleri |
| `ml/atomic.py` | yarım yazımda hedef dosya bozulmaz |
| `paper_trading.py` | sektör tavanı, brüt maruziyet, işlem idempotansı |
| `commentary.py` | skor→yön eşlemesi sınırları |

Hedef: **~40 test, <5 saniye.** Kapsam peşinde koşmuyoruz; *kırılgan yerleri*
kilitliyoruz.

### Katman 4 — CI (GitHub Actions)

Zaten GitHub'a push ediyoruz; maliyeti sıfır.
Her push'ta: `pytest` · `tsc -b` · `selftest --offline` · `ruff`.
Kırmızıysa push işaretlenir. "Bende çalışıyordu" biter.

---

## 4. Değişiklik Protokolü (insan tarafı)

Teknik ağ tek başına yetmez; kusurların bir kısmı **disiplin** eksikliğiydi.
Bundan sonra her değişiklikte:

1. **Etki alanı taraması** — bir sabit/anlam değişiyorsa, `grep` ile TÜM
   kullanımları listelenir (backend + frontend). Kalibrasyon eklenince kademe
   mantığını kaçırmamın sebebi buydu.
2. **Değişmez ekle** — yeni bir varsayım geliyorsa Katman 1'e bir satır eklenir.
3. **Testi önce yaz** — hata düzeltiliyorsa, önce onu **yakalayan** test yazılır.
4. **Uçtan uca doğrula** — değişen parçayı değil, **zinciri** doğrula
   (ör. terfi düzeltmesinde önbelleğin hiç tazelenmediğini bu yakalardı).
5. **Arayüz değişikliği** → 1280/1920/2560 ölçüm zorunlu (göz kararı değil, DOM).

---

## 5. Uygulama Sırası

| Adım | İş | Süre | Kazanım |
|---|---|---|---|
| **A1** | `selftest.py` + I1–I10 değişmezleri | orta | Bu oturumdaki 9 sessiz hatanın 7'si otomatik yakalanır |
| **A2** | `GET /admin/selftest` + StatusBar/Model sayfasında görünürlük | küçük | Sorunlar **sen fark etmeden önce** görünür |
| **A3** | `GET /admin/config` + arayüzdeki elle yazılmış sabitlerin temizliği | küçük | K2 kökten biter |
| **B1** | pytest iskeleti + `ml/labels`, `ml/calibration` testleri | orta | En kritik matematik kilitlenir |
| **B2** | `monitoring`, `paper_trading`, `atomic`, `maturity` testleri | orta | Veri bütünlüğü kilitlenir |
| **C1** | GitHub Actions: pytest + tsc + selftest | küçük | Regresyon push'ta yakalanır |
| **D1** | `champion.joblib` sürümleme + geri alma | küçük | ML Test Score "rollback" maddesi |
| **D2** | Kapsam zarfı uyarısı (I5) → syslog + UI | küçük | Model davranış kayması sessiz kalmaz |

**A1+A2+A3 tek oturumda bitebilir** ve tek başına örüntüyü kırar.

---

## 6. Dürüst Beklenti Yönetimi

Sana "bir daha hiç sorun çıkmayacak" **diyemem** — bu yalan olur. 20.000 satırlık
canlı bir sistemde hata çıkar.

Söyleyebileceğim şu: bu plan, hataların **nasıl bulunduğunu** değiştirir.

| | Şimdi | Plandan sonra |
|---|---|---|
| Hatayı kim bulur | **Sen**, ekranda tuhaf bir şey görünce | Sistem, boot'ta/CI'da |
| Ne kadar sürer | Günler (model 1 ay donuk kaldı) | Saniyeler |
| Düzeltme neyi bozar | Bilinmez | Testler söyler |
| Kanıt | Tek seferlik betik, silinir | Kalıcı, tekrarlanabilir |

Ve bir taahhüt: **düzeltme yaparken yeni bir varsayım getiriyorsam, o varsayımı
aynı anda bir değişmeze/teste bağlayacağım.** Bu oturumdaki asıl kusurum
buydu — doğru düzeltmeler yaptım ama her biri denetlenmemiş yeni bir varsayım
bıraktı.

---

## 7. Bilinçli Kapsam Dışı

- MLflow / feature store / model registry — bu ölçekte tiyatro
- Kubernetes, dağıtık eğitim — tek makine yeterli
- %100 test kapsamı — hedef kapsam değil, **kırılgan noktalar**
- Mikroservislerin yeniden yazımı — mimari sorun değil, doğrulama sorunu

---

## 8. Açık Kalan ML Sorusu (ayrı konu)

Sağlamlıktan bağımsız, hâlâ karar bekleyen tek şey: **kapsam patlaması**
(canlı %98 vs doğrulanmış %29). Bu bir kod hatası değil — ölçüldü, boru hattı
tutarlı. Bir *model davranışı* sorusu ve çözümü muhtemelen `BUY_THRESHOLD`'un
sabit yerine günlük dağılıma göre uyarlanması. Ama bu **karar kuralını
değiştirmek** demek; Katman 1-3 kurulmadan dokunulmamalı — çünkü tam olarak
bu tür bir değişiklik, denetimsiz ortamda yeni sessiz hatalar doğuruyor.

Sıralama nettir: **önce güvenlik ağı, sonra model kararı.**
