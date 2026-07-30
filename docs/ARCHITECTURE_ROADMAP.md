# SerInvest — Mimari Yol Haritası (ml v4 vizyonu)

> Tarih: 2026-07-08. Bu belge, çok modlu (fiyat + haber + makro) tahmin sistemine
> geçiş için kararlaştırılan mimariyi ve faz sırasını kaydeder.
> Kaynak analiz: `ml/config.py` deney notları + `validation_summary.json` (24 fold).

## 0. Baseline (ml v3 — mevcut durum, 2026-07 doğrulaması)

| Metrik | Değer |
|---|---|
| AUC (OOS, 19.746 örnek) | 0.548 |
| AL-precision / taban | 0.511 / 0.498 (lift +1.3p) |
| İşlem başı beklenen R (maliyet sonrası) | +0.45 |
| Ufuk / eşik | 10 gün triple-barrier / BUY_THRESHOLD 0.58 |

Kanıtlanmış dersler (tekrar denenmesin):
1. **Mutlak özellikler → piyasa zamanlayıcı** (AUC 0.46, değer yok etti). Çözüm: gün-içi kesitsel rank (`XSEC_RANK`). Eğitim ve canlı AYNI dönüşümü kullanmalı.
2. **Haber/temel/makro özellikler birincil modelde gürültü** (10g ufukta). v3'te bilinçli çıkarıldı. Geri girişleri SADECE meta-labeling katmanından olacak.
3. **1-5 günlük ufuk yazı-tura.** 10 gün altına inme.
4. Ham sentiment zayıf sinyal (örn. "Süper Loto sonuçları → GLOBAL BULLISH +0.96"). Olay tipolojisi şart.

## 1. Hedef Mimari — Katmanlı Füzyon (uçtan uca derin ağ DEĞİL)

~60K satır günlük veriyle uçtan uca çok modlu Transformer = overfit. Bunun yerine:

```
Teknik özellikler ──→ BİRİNCİL MODEL (mevcut LGBM, xsec-rank) ──→ P(yukarı)
                                      │ sadece AL adayları
Haber olayları ────┐                  ▼
Rejim özellikleri ─┼─→ META-MODEL (meta-labeling) ──→ P(birincil haklı) → boyut/veto
Makro takvim ──────┘                  │
                                      ▼
                      KARAR KATMANI (kalibrasyon → EV → boyut → portföy kısıtları)
```

- **Meta-labeling** (López de Prado): birincil "ne zaman AL", meta "bu AL'e ne kadar güven".
  Haber, yönü tahmin etmez; sinyali filtreler/boyutlar (ders #2 ile tutarlı).
- **LLM rolü = özellik çıkarıcı, tahminci değil.** DistilBERT'i olay sınıflandırma +
  embedding'e kaydır. Opsiyonel: Claude API offline etiketleyici (batch), yerel model
  onun etiketleriyle damıtılır; canlı sistem %100 yerel kalır.
- **Derin zaman serisi (PatchTST/TFT)**: sadece challenger olarak; terfi kapısını geçerse yaşar.
- **RL**: sinyal üretiminde HAYIR (örneklem verimsizliği). İleride sadece boyut/çıkış politikası.

## 2. Veri Boru Hattı — Point-in-Time Disiplini

```
Kaynaklar → Bronze (ham event store) → Silver (özellik/embedding) → Gold (as-of join, Parquet)
```

Kurallar:
- **Çift zaman damgası**: her olayda `event_ts` (oldu) + `ingest_ts` (öğrenildi).
  Eğitim join'leri DAİMA `ingest_ts` üzerinden as-of. (Lookahead sızıntısı = proje katili.)
- **Varlık çözümleme**: haber → `(sembol, güven, olay_tipi)`; BIST_KEYWORDS'ten ayrı test edilebilir modüle.
- **Olay tipolojisi**: `{temettü, geri_alım, bedelli, KAP_ceza, yönetim_değişikliği, faiz_kararı, jeopolitik_şok, ...}`
- **Yenilik (novelty) skoru**: embedding benzerliğiyle tekrar haberleri düşür.
- Haber GERİYE DÖNÜK indirilemez → kalıcı biriktirme en acil iş (Faz 1).

## 3. MLOps — Sürekli Öğrenme Stratejisi

- **Online learning HAYIR; kayan pencere + periyodik retrain + terfi kapısı EVET** (mevcut champion/challenger korunur).
- Eklenecekler:
  1. **Drift monitörü**: özellik başına PSI/KS (eğitim dağılımı vs son 30g) → eşik aşımında erken retrain + syslog.
  2. **Kalibrasyon takibi**: reliability curve (`predictions.csv` verisi yeterli).
  3. **CPCV** terfi kararlarında (mevcut WF purge/embargo doğru, korunur).
  4. **İki hızlı adaptasyon**: ağır model aylık; hafif rejim katmanı (vol rejimi, USDTRY stresi) günlük.
- GPU/sürekli eğitim altyapısı GEREKMEZ. Embedding üretimi günlük batch CPU.

## 4. Karar Katmanı — Tahminden Aksiyona

1. **Kalibrasyon**: isotonic/Platt (0.5'e sıkışmanın çözümü eşik oynamak değil kalibrasyon).
2. **EV**: `EV = P·TP − (1−P)·SL − maliyet` (ATR bariyerleri doğal uyumlu); sadece EV>0.
3. **Boyut**: kesirli Kelly (¼ tavan) veya kalibre P ile SIZE_P_FULL rampası; meta-güven çarpan.
4. **Portföy kısıtları**: sektör tavanı, korelasyon cezası (3 banka = 1 risk), maks brüt maruziyet. Greedy top-k + kısıt, MVO'dan önce.
5. **Belirsizlik**: 5-seed mini-ensemble varyansı → yüksek varyans = küçük boyut/çekimserlik.
6. **Hakem**: paper_trading — her değişiklik X hafta kağıt portföyde kanıtlanmadan terfi etmez.

## 5. BIST vs NASDAQ Kararı

**BIST birincil kalır.** Kenar kaynağı: piyasa verimsizliği + Türkçe NLP hendeği.
NASDAQ = ikinci evren / doğrulama laboratuvarı (evren-parametrik yapı zaten var:
`shared/symbols.json` + `ml/universe.py`). BIST'te çalışıp NASDAQ'ta çalışmayan kenar =
yerel verimsizlik kanıtı (iyi haber).

## 6. Faz Sırası (etki/emek oranına göre)

| Faz | İş | Durum |
|---|---|---|
| **1** | Haber olaylarını çift zaman damgasıyla kalıcı depoya yaz (`MarketSignals` genişletildi: `PublishedAt`=event_ts, `CreatedAt`=ingest_ts, `NewsGuid` dedupe, `SentimentRaw`, `SourceWeight`, `Lang`) | ✅ 2026-07-08 (uçtan uca doğrulandı) |
| 2 | Olasılık kalibrasyonu + EV boyutlandırma + portföy kısıtları (`ml/calibration.py`; isotonic WF-OOS'a fit, karar eşiği HAM p'de kaldı; Kelly ¼; EV kapısı; paper'da sektör tavanı=2 + brüt maruziyet %80 + EV-sıralı greedy top-k) | ✅ 2026-07-08 (canlı doğrulandı) |
| 3 | Olay tipolojisi + yenilik skoru → meta-labeling katmanı. Analyst: kural-bazlı `event_type` (14 tip) + 72s Jaccard `novelty`. Core-api: kolonlar + `/api/signals/aggregate` genişletildi (noveltyScore, pos/negEvents). Oracle: `ml/meta.py` — her ham-AL sinyalinin 12 meta-özelliği karar anında loglanır; günlük değerlendirme sonrası lojistik meta-model eğitilir (kapılar: ≥300 örnek + test AUC ≥0.55), geçerse canlıda veto (p<0.40) + boyut çarpanı. Model olgunlaşana dek pass-through. | ✅ 2026-07-08 boru hattı kuruldu; model veri biriktikçe otomatik devreye girer |
| 4 | Drift + kalibrasyon izleme + çok-pencereli terfi. `ml/monitoring.py`: günlük HAM özellik logu (90g pencere; rank özellikte PSI anlamsız olduğundan ham) → PSI raporu (İZLE>0.10, DRIFT>0.25, retrain tetiklemez — sadece uyarı); canlı güvenilirlik/Brier/ECE raporu (ECE>0.10 → "kalibratörü tazele"). Günlük 19:20 + `/admin/drift?refresh=1`. `promote_if_better` artık son 3 bağımsız pencerede ayrı purged rakip eğitir; terfi = çoğunluk galibiyeti + havuz precision/örnek kapıları. | ✅ 2026-07-08 |
| 5 | PatchTST/TFT challenger; NASDAQ evreni; (ops.) yürütme RL | bekliyor |

## Kalibrasyon Bulgusu (2026-07-08 — Faz 3'ün gerekçesi)

Isotonic güvenilirlik tablosu (19.746 WF-OOS): ayırt etme gücü ALT uçta
(ham p<0.21 → gerçek UP %29). Ham p 0.35–0.95 arası DÜZ (~%53) → model ham 0.60
ile 0.90'ı ayıramıyor; hepsi kalibre 0.533'e eşleniyor. Sonuç: AL sinyalleri
uniform ~%5.5 Kelly boyutu alır (sahte hassasiyet bitti), EV ≈ +0.57R hep pozitif.
Üst-uç ayrımını haber/rejim özellikleriyle meta-labeling (Faz 3) sağlayacak.
Detay: `models/ml_v3/calibrator_meta.json` → reliability.

## Dayanıklılık Bulguları (2026-07-23 denetimi)

Canlı denetimde 4 gerçek sorun bulundu ve düzeltildi:

1. **Mükerrer paper trade**: `_close_position` CSV'ye anında yazıyor ama `save_state`
   döngü sonundaydı → arada restart olursa işlem iki kez kapanıyordu (BIMAS/EREGL).
   Düzeltme: `_append_trade` idempotant (entry+symbol+exit anahtarı) + kapanışta anında `save_state`.
2. **Yarım CSV yazımı**: "hepsini oku → hepsini yaz" atomik değildi; `predictions.csv`
   3. satırda timestamp'in başındaki `2026` kaybolmuştu. Düzeltme: `ml/atomic.py`
   (temp dosya → fsync → `os.replace`); predictions/meta_log/feature_log/paper_portfolio + rapor JSON'ları.
3. **Monitör boot catch-up yok**: 19:20 schedule kaçarsa rapor bayat kalıyordu
   (drift_report 15 gün eski). Düzeltme: `main.py` boot'ta `run_daily_checks` çağırır.
4. **PSI yanlış alarmı (önemli)**: eşik SATIR sayısına bakıyordu ama aynı günün 50
   sembolü bağımsız gözlem değil. Piyasa-geneli özellikler (`usdtry_ret5`) tüm
   sembollerde aynı → 400 satır = **8 bağımsız gözlem**. 8 günlük pencereyi 747 günlük
   (3 yıl) tabanla kıyaslamak yapısal olarak devasa PSI üretiyordu (usdtry_ret5 4.93 →
   "13 DRIFT" yanlış alarmı). Düzeltme: `MIN_LIVE_DAYS=20` gün kapısı + piyasa-geneli
   özellikleri günlük seriye indirgeyip kıyaslama.

## Terfi Terazisi Hatası (2026-07-30 — kritik)

**Bulgu:** `promote_if_better` şampiyonu KENDİ EĞİTİM VERİSİNDE sınıyordu. Şampiyon
2026-06-24'e kadar eğitilmiş, test pencereleri ise Şubat–Haziran 2026 → tamamı
eğitim aralığının içinde. Kanıt: şampiyonun dürüst walk-forward AL isabeti %51.1
iken terfi testinde %73/93/74 gösteriyordu. Rakip (gerçekten OOS) %31/71/35.
20-40 puanlık bu handikapla rakip **yapısal olarak kazanamaz** → 2/2 deneme
reddedilmiş, model 8 Temmuz'dan beri donuk. "Bilgisayarı açık tutuyorum ama model
eğitilmiyor" şikâyetinin kökü buydu; öğrenme döngüsü kapalı devreydi.

**Düzeltme:** Karşılaştırma yalnızca `champion_meta.date_max` SONRASINDAKİ
tarihlerde yapılır — iki model de aynı pencerede out-of-sample. Taze veri
`PROMOTE_MIN_FRESH_DAYS`(30) günden azsa hileli sonuç üretmek yerine "yetersiz"
denir ve şampiyon korunur. Önbellek şampiyon kesimini geçmiyorsa veri otomatik
tazelenir. Test (2026-07-30): taze veri 22/30 gün → dürüstçe atlandı.

**Kalan metodolojik açıklar (henüz yapılmadı):**
- **Uniqueness ağırlığı yok.** 10g ufuk + günlük gözlem → komşu etiketler fiyat
  yolunun ~9/10'unu paylaşıyor. 31K satır ama etkin bağımsız örnek ~3K. Purge/
  embargo eğitim↔test sızıntısını keser, eğitim-içi tekrarı kesmez. Çözüm:
  average-uniqueness `sample_weight` + sequential bootstrap (López de Prado).
- **Etiket melez.** Ölçüldü: etiketlerin yalnızca ~%25'i bariyer dokunuşu, ~%52'si
  süre sonu sürüklenmesi. Model "3σ hareket olur mu" diye eğitilip "10 günde
  nereye kaydı" diye notlandırılıyor. → (ufuk, TP, SL) taraması gerekli.
- WF'de eğitilen 24 model atılıyor; ensemble varyansı düşürürdü.
- Evren 50 yüksek korelasyonlu isim → kesitsel etkin genişlik düşük.
- Özellikler trend-ağırlıklı (`above_ema200` %16) ama 10g ufukta kısa vadeli
  geri dönüş baskın olabilir → özellik/ufuk uyumu sorgulanmalı.

## Operasyonel Notlar

- RabbitMQ host portları **5673/15673** (coeng-rabbitmq 5672'yi tuttuğu için; iç ağ 5672 değişmedi).
- Oracle syslog'ları Redis'te uçucu (`oracle:syslogs`, son 100); redis'in volume'u yok → restart'ta silinir.
- Model artık `./oracle-data` **bind-mount**'ta (proje klasöründe) → makine taşımada klasörle gelir. DB hâlâ `postgres_data` named volume → `backup.ps1`/`restore.ps1` ile taşınır. Tam rehber: `TASIMA.md`. (Eski `serinvest_oracle_models` named volume artık orphan — güvenlik ağı, sonra prune edilebilir.)
