"""
SerInvest ML v3 — Sabitler (tek kaynak)
========================================
Sadece sabitler; mantık yok. Tüm ml/ modülleri buradan import eder.
Eski kök config.py'den TAMAMEN bağımsızdır (sıfırdan sade ilkesi).
"""
from pathlib import Path

# ── Dosya yolları (eski sistemle ÇAKIŞMAZ — ayrı ml_v3 klasörü) ──────────────
MODELS_DIR   = Path("/app/models")
ML_DIR       = MODELS_DIR / "ml_v3"
CHAMPION_FILE   = ML_DIR / "champion.joblib"      # canlı (şampiyon) model
TRAIN_CACHE     = ML_DIR / "training_data.csv" # özellik+etiket önbelleği
PROMOTION_LOG   = ML_DIR / "promotion_log.jsonl"   # her terfi/ret kararı (şeffaflık)
PREDICTION_LOG  = ML_DIR / "predictions.csv"       # canlı tahmin + sonuç
META_FILE       = ML_DIR / "champion_meta.json"    # şampiyon özeti (tarih, skor, feature önem)

# ── Tahmin Ufku & Etiketleme ─────────────────────────────────────────────────
# Kullanıcı kararı (06/2026): ~2 hafta. Çok kısa vade (1-5g) yazı-turaya yakındı.
HORIZON = 10            # işlem günü (triple-barrier zaman bariyeri)

# Triple-barrier mesafeleri = çarpan × GÜNLÜK ATR%. 10 günlük ufka göre ayarlı.
# Asimetrik (TP > SL): 2 haftalık kazanan ~stop'un 1.5 katı hareket etmeli (R:R≈1.5).
TP_ATR_MULT = 3.0       # üst bariyer (kâr al)  — atr %2 ise ≈ +%6
SL_ATR_MULT = 2.0       # alt bariyer (zarar kes) — atr %2 ise ≈ -%4
# Günlük ATR%'nin sınırları (aşırı dar/geniş hisseleri normalize et)
ATR_FLOOR = 0.010       # min %1
ATR_CAP   = 0.050       # max %5
# Zaman bariyeri sonu: hiçbir bariyere değmediyse, kapanış hareketi bu eşiği
# geçmişse yönlü etiketlenir, yoksa NÖTR (eğitimden çıkar).
TIME_BARRIER_MIN_MOVE = 0.020   # ±%2

# ── Değerlendirme Olgunluk Eşiği ─────────────────────────────────────────────
# Bir tahmin ancak 10 İŞLEM günlük triple-barrier penceresi kapandıktan sonra
# yargılanabilir. Takvim gününe çevirim: hafta sonu payı (×1.6) + tatil tamponu.
# UI "olgunlaşma hattı" da bu sabiti kullanır → tek doğruluk kaynağı.
EVAL_MIN_AGE_DAYS = int(round(HORIZON * 1.6)) + 4      # 10 işlem günü ≈ 20 takvim günü

# ── Tahmin Eşiği ─────────────────────────────────────────────────────────────
# P(yukarı) bu eşiği geçerse AL; geçemezse NÖTR. "Az ama isabetli" için yüksek.
# Faz 3 doğrulamasında precision/coverage dengesine göre kalibre edilecek.
BUY_THRESHOLD = 0.58

# ── Kesitsel Rank Dönüşümü (06/2026 uzman denetimi — deney kanıtlı) ──────────
# Mutlak özelliklerle model piyasa zamanlayıcıya dönüşüyordu (usdtry %20 önem,
# AUC 0.46, lift −4.2p = değer YOK EDİYORDU). Her özellik GÜN-İÇİ kesitsel
# percentile'a çevrilince (hangi hisse diğerinden iyi): AUC 0.529, lift +1.0p,
# beklenen R +0.428 (deney: ml/experiment_xsec.py → experiment_xsec.json).
# Eğitim ve canlı çıkarım AYNI dönüşümü kullanmak ZORUNDA (train/serve tutarlılığı).
XSEC_RANK = True

# ── Rejim Kapısı (06/2026 uzman denetimi) ────────────────────────────────────
# XU100 < EMA200 iken YENİ AL sinyali üretme (askıya al) — düşen piyasada dip
# yakalamaya çalışma. Mevcut pozisyonlar bariyerlerle yönetilmeye devam eder.
REGIME_FILTER   = True
REGIME_EMA_SPAN = 200      # XU100 günlük EMA periyodu

# ── Boyutlama / Kademe (kalibre edilmemiş LGBM gerçeğine göre) ───────────────
# LightGBM finansal gürültüde olasılığı 0.5'e sıkıştırır; canlıda P>0.70 neredeyse
# hiç çıkmaz. Boyut rampası ve GÜÇLÜ ALIM eşiği gözlenen dağılıma göre ayarlı.
SIZE_P_FULL   = 0.68       # bu olasılıkta tavan pozisyon boyutuna ulaşılır (kalibratörsüz fallback)
STRONG_BUY_P  = 0.65       # bu üstü → GÜÇLÜ ALIM

# ── Faz 2 (ml v4 yol haritası — 07/2026): Kalibrasyon + EV + Kelly ───────────
# Isotonic kalibratör walk-forward OOS tahminlerine fit edilir (tek dürüst kaynak)
# ve HAM p'yi gerçek olasılığa çevirir. KARAR eşiği (BUY_THRESHOLD) HAM p üzerinde
# kalır — champion'ın doğrulanmış davranışı değişmez; kalibre p yalnızca
# EV filtresi + Kelly boyutlandırma + kullanıcıya gösterilen güven içindir.
CALIBRATOR_FILE      = ML_DIR / "calibrator.joblib"
CALIBRATOR_META_FILE = ML_DIR / "calibrator_meta.json"
EV_FILTER       = True     # AL sinyali kalibre-EV ≤ 0 ise NÖTR'e indirgenir
# Bir isotonic BASAMAĞININ arkasında olması gereken asgari OOS örneği.
# 08/2026 bulgusu: 17.08 tazelemesinden sonra eğri 0.345-0.725 arası tamamen
# DÜZ (0.5251 — "sıralama bilgisi yok", dürüst kısım) ama ham p ≥ 0.90'da
# 0.99'a fırlıyordu. Isotonic kuyruğu ezberlemişti: üst kutunun (n=2466)
# gözlenen oranı %57,2 iken eğri %99 iddia ediyordu. Bu, canlıda 350 tahminin
# 52'sini (%14,9) Kelly'nin %10 TAVANINA taşıdı — kanıt zayıfken risk arttı.
# n=200'de p≈0.6 için standart hata ~0.035; bundan az örnekle basamak iddia
# etmek gürültüyü olasılık diye satmaktır.
MIN_CALIB_SUPPORT = 200
# ...ve bu satırlar en az bu kadar BAĞIMSIZ GÜNE yayılmalı. Satır sayısı tek
# başına yanıltıcı: aynı günün 50 sembolü aynı piyasa hareketini paylaşır.
# 200 satır tek bir haftadan gelebilir. Eşik MIN_EVAL_DAYS ile aynı gerekçe.
MIN_CALIB_SUPPORT_DAYS = 10
KELLY_FRACTION  = 0.25     # kesirli Kelly (tam Kelly finansal gürültüde intihardır)
MIN_POSITION_PCT = 0.01    # bunun altındaki boyut = toz; pozisyon açılmaz

# ── Faz 3 (ml v4 yol haritası — 07/2026): Meta-labeling ─────────────────────
# Birincil model "ne zaman AL" der; meta-model "bu AL'e ne kadar güven" der.
# Haber/rejim özellikleri SADECE bu katmandan girer (birincil saf teknik kalır).
# "Şimdi topla, olgunlaşınca eğit": her AL sinyalinin meta-özellikleri loglanır;
# değerlendirilmiş örnek MIN_META_SAMPLES'a ulaşınca eğitilir, ANCAK bağımsız
# test penceresinde AUC ≥ META_MIN_AUC ise canlıya alınır (kanıtsız katman yok).
META_MODEL_FILE  = ML_DIR / "meta_model.joblib"
META_INFO_FILE   = ML_DIR / "meta_model.json"
META_LOG_FILE    = ML_DIR / "meta_log.csv"
MIN_META_SAMPLES = 300      # değerlendirilmiş AL örneği tabanı
META_MIN_AUC     = 0.55     # test AUC bunun altındaysa canlıya alınmaz
META_VETO_P      = 0.40     # P(birincil haklı) bunun altı → AL veto
META_SIZE_ANCHOR = 0.55     # boyut çarpanı = p_meta/anchor (0.6–1.2 kelepçeli)

# ── Faz 4 (ml v4 yol haritası — 07/2026): Drift + Kalibrasyon İzleme ─────────
# Drift HAM özelliklerde ölçülür — xsec-rank özellikler tanım gereği uniform
# olduğundan PSI onlarda anlamsızdır. Drift otomatik retrain TETİKLEMEZ (körü
# körüne retrain yok ilkesi); sadece syslog uyarısı + admin paneli raporu.
FEATURE_LOG_FILE  = ML_DIR / "feature_log.csv"      # günlük ham özellik fotoğrafı
DRIFT_REPORT_FILE = ML_DIR / "drift_report.json"
CALIB_REPORT_FILE = ML_DIR / "calibration_report.json"
DRIFT_WINDOW_DAYS = 30      # canlı pencere (PSI'nin karşılaştırma tarafı)
FEATURE_LOG_MAX_DAYS = 90   # özellik logu kayan pencere tavanı
PSI_WATCH  = 0.10           # 0.10–0.25 → İZLE
PSI_ALERT  = 0.25           # >0.25 → DRIFT uyarısı (syslog WARN)

# ── Faz 4b: Çok-pencereli purged terfi ───────────────────────────────────────
# Tek pencere terfisi rejim şansına açıktı; rakip artık son N bağımsız pencerenin
# çoğunluğunda kazanmalı (her pencere için ayrı purged eğitim).
PROMOTE_WINDOWS = 3         # bağımsız test penceresi sayısı (her biri test_window_days)

# ── Terfi Terazisi (07/2026 düzeltmesi) ──────────────────────────────────────
# ESKİ HATA: test pencereleri şampiyonun EĞİTİM ARALIĞININ İÇİNDEYDİ. Şampiyon
# kendi ders kitabından sınava girip %73-93 gösteriyordu; dürüst OOS skoru ise
# %51.1. Rakip out-of-sample olduğu için yapısal olarak kazanamıyordu → model
# sonsuza kadar donuk kalıyordu (2/2 deneme reddedildi).
# YENİ KURAL: karşılaştırma yalnızca şampiyonun HİÇ GÖRMEDİĞİ tarihlerde yapılır.
# O kadar taze veri yoksa hileli sonuç üretmek yerine "yetersiz" denir.
PROMOTE_MIN_FRESH_DAYS = 30   # şampiyon kesiminden sonra gereken asgari takvim günü
PROMOTE_MIN_WINDOW_DAYS = 20  # bir test penceresinin asgari uzunluğu

# ── Zamanlanmış İş Gecikme Eşikleri (saat) ──────────────────────────────────
# TEK KAYNAK: /admin/jobs, selftest ve arayüz aynı buradan okur. Elle yazılan
# eşik = 08/2026'daki "77/30" ve "600/200" hatalarının kaynağıydı.
JOB_OVERDUE_HOURS = {
    "analyze":  4,        # piyasa taraması — 30 dk'da bir
    "evaluate": 36,       # günlük değerlendirme — 19:00
    "health":   36,       # sağlık kontrolü — 19:20
    "promote":  8 * 24,   # haftalık terfi — Pazar 20:00
}

# ── Öz Denetim (selftest) ────────────────────────────────────────────────────
SELFTEST_FILE = ML_DIR / "selftest.json"
# I2 train/serve skew toleransı: aynı özelliklerden yeniden hesaplanan p ile
# kayıtlı p arasındaki kabul edilebilir maksimum fark.
SELFTEST_SKEW_TOL = 0.01

# ── Tek Model — LightGBM (SABİT hiperparametre + seed = kararlılık) ───────────
# Rastgelelik tutarsızlık kaynağıdır → seed sabit, hiçbir auto-tuning yok.
RANDOM_SEED = 42
LGBM_PARAMS = {
    "objective":        "binary",
    "n_estimators":     300,
    "learning_rate":    0.03,
    "num_leaves":       31,
    "max_depth":        6,
    "min_child_samples": 80,    # yüksek → aşırı öğrenmeyi (overfit) kısar, kararlılık
    "subsample":        0.8,
    "subsample_freq":   1,
    "colsample_bytree": 0.8,
    "reg_alpha":        0.1,
    "reg_lambda":       0.2,
    "random_state":     RANDOM_SEED,
    "n_jobs":           -1,
    "verbose":          -1,
}

# ── Eğitim penceresi ─────────────────────────────────────────────────────────
# ── Meta-labeling (Faz G — DEVRE DIŞI) ───────────────────────────────────────
# 08/2026: kapatıldı. Kod SİLİNMEDİ, yalnız devre dışı.
#
# Gerekçe (docs/MODEL_KANIT.md): meta katmanın işi "modelin AL sinyallerinden
# hangileri tutar" sorusunu haber/rejim bağlamıyla cevaplamaktı. Ama ana model
# zaten hisse SIRALAYAMIYOR (gün-içi Spearman -0.007, t=-0.78, 485 gün);
# sıralayamayan bir sinyal kümesini veto etmek ölçülebilir bir katkı üretmiyor,
# yalnız karar zincirine bir kat daha karmaşıklık ve bir log dosyası daha
# ekliyordu.
#
# Ne zaman tekrar açılır: haber verisi ~180 güne ulaşıp (bkz. /admin/data-depth)
# meta katmanın katkısı ÖLÇÜLEBİLİR hale geldiğinde. Meta özellik logu bilinçli
# olarak yazılmaya DEVAM ediyor — o gün geldiğinde eğitim verisi hazır olsun.
META_ENABLED = False

# ── Risk filtresi (Faz A) ────────────────────────────────────────────────────
# Kural docs/PLAN_2026-08.md §A0'da ÖNCEDEN yazıldı; sonucu görüp değiştirmek
# yasak. Karar tarihi 2027-02-12.
RISK_FILTER_ON          = True
RISK_FILTER_TOP_PCT     = 0.30   # gün-içi kesitsel skorda en iyi %30 geçer
# Filtrenin canlıya alındığı gün. I11 yalnız BU TARİHTEN SONRAKİ günleri
# yargılar; öncesi filtresiz üretildi ve o veriyi filtreye göre suçlamak
# yanlış olur (devreye alır almaz İHLAL veren, 10 gün öyle kalan bir kontrol
# işe yaramaz). Ölçüm penceresinin başlangıcı olarak da kayda geçer.
# 13 Ağustos'un logu KARIŞIK: o günün tahminlerinin bir kısmı filtre devreye
# girmeden önce üretildi. Karışık günü ölçüme katmak hem yanlış hem düzeltilemez
# olurdu, bu yüzden pencere ertesi günden başlar.
RISK_FILTER_SINCE       = "2026-08-14"
RISK_FILTER_MIN_SYMBOLS = 20     # altında kesitsel sıralama anlamsız → filtre yok
COVERAGE_TARGET         = (0.20, 0.40)   # AL kapsamı bu aralıkta kalmalı (I11)
# Karar günü — TEK KAYNAK. Elle yazılan tarih, JOB_OVERDUE_HOURS'takiyle aynı
# hatanın kapısıdır: admin_server.py'de ayrıca "2027-02-12" yazıyordu, biri
# değişse ikisi ayrışırdı. Önceden çivilenmiş bir tarihin iki farklı yerde
# yaşaması, önceden kaydın kendisini anlamsızlaştırır.
RISK_FILTER_DECISION_DATE = "2027-02-12"

MIN_TRAIN_ROWS = 2000        # bu kadar örnek yoksa model eğitilmez
MAX_TRAIN_ROWS = 60000       # kayan pencere tavanı (RAM güvenliği — 137 OOM'a karşı)
HISTORY_PERIOD = "3y"        # her sembol için indirilecek geçmiş

# ── Walk-Forward Doğrulama ───────────────────────────────────────────────────
WF_INITIAL_TRAIN_DAYS = 365  # ilk eğitim penceresi (takvim günü)
WF_STEP_DAYS          = 30   # her adımda ilerleme
WF_PURGE_DAYS         = HORIZON   # etiket sızıntısını önle (≥ ufuk = 10g)
WF_EMBARGO_DAYS       = 5    # purge sonrası ek tampon

# ── Şampiyon-Rakip Promosyon Kuralı ──────────────────────────────────────────
# Rakip, bağımsız test penceresinde şampiyonu EN AZ bu kadar geçmeli (yön isabeti).
PROMOTE_MIN_EDGE      = 0.02   # +%2 isabet üstünlüğü şart
PROMOTE_MIN_SAMPLES   = 200    # test penceresinde en az bu kadar değerlendirilmiş tahmin
PROMOTE_MIN_PRECISION = 0.50   # rakibin AL-precision'ı bunun altındaysa terfi yok

# ── İşlem Maliyeti (backtest gerçekçiliği) ───────────────────────────────────
TRANSACTION_COST_PCT = 0.002   # %0.20 round-trip (komisyon + spread)

# ── Saf Teknik Özellik İsimleri (~21) ────────────────────────────────────────
# Tek-sembol teknikler + 3 FİYAT-TÜREVİ piyasa bağlamı (rel-strength, USDTRY).
# Haber/temel/makro YOK. 2 haftalık ufukta intraday mikro-yapı (wick/gap) gürültü
# olduğu için bilinçli dışarıda → daha az özellik = daha sağlam, daha az overfit.
FEATURE_NAMES = [
    # Momentum
    "rsi", "rsi_slope",
    "macd_hist", "macd_hist_slope",
    # Bollinger
    "bb_pct", "bb_width",
    # Trend (kısa-orta-uzun)
    "ema9_diff", "ema20_diff", "ema_alignment",
    "above_ema200", "ema200_trend",
    "dist_ema50_z",          # mean-reversion (fiyat EMA50'den z-kaç std uzak)
    # Getiri
    "ret_5d", "ret_20d", "ret_consistency",
    # Hacim & Volatilite
    "vol_ratio", "atr_pct",
    # 52 hafta pozisyon
    "price_vs_52w_high",
    # Fiyat-türevi piyasa bağlamı (saf teknik — BIST için kritik)
    "rel_strength_5d",       # ret_5d - XU100_ret5
    "rel_strength_20d",      # ret_20d - XU100_ret20
    "usdtry_ret5",           # USD/TRY 5g getiri (TL zayıflığı BIST'e baskı)
]
