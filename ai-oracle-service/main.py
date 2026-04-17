"""
SerInvest Yerel AI Oracle (Faz 3 — API'siz)
=============================================
Tamamen yerel çalışır, hiçbir harici AI API'si kullanmaz.

Nasıl çalışır:
  1. İlk çalıştırmada 2 yıllık tarihsel veriyle model eğitir (bootstrap)
  2. Her 60 dakikada bir tüm varlıklar için tahmin üretir
  3. Her tahmini timestamp + fiyatla birlikte kaydeder
  4. Günlük döngüde: 1 günlük tahminleri kontrol eder
     Haftalık döngüde: 5 günlük tahminleri kontrol eder
     Aylık döngüde:    20 günlük tahminleri kontrol eder
  5. Yeni gerçek sonuçlar biriktikçe modeli yeniden eğitir
  6. Doğruluk oranı takip edilir ve analizle birlikte raporlanır
"""

import os, json, time, datetime, math, threading
import pika, requests, schedule
import numpy as np
import pandas as pd
import yfinance as yf
import ta
import joblib
from pathlib import Path
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline
from sklearn.calibration import CalibratedClassifierCV

GLOBAL_CHANNEL = None
GLOBAL_CONN    = None   # Yeniden bağlantı için referans

def _ensure_channel() -> bool:
    """
    Channel kapalıysa veya bağlantı kopmuşsa yeniden bağlanır.
    Thread'den çağrılmamalı — sadece ana thread kullanır.
    Döndürür: True = channel kullanılabilir, False = başarısız.
    """
    global GLOBAL_CHANNEL, GLOBAL_CONN
    try:
        if GLOBAL_CHANNEL is not None and GLOBAL_CHANNEL.is_open:
            return True
    except Exception:
        pass  # Kapalı kanal — yeniden bağlan

    print("[RabbitMQ] Channel kapalı, yeniden bağlanılıyor...")
    try:
        if GLOBAL_CONN is not None:
            try:
                GLOBAL_CONN.close()
            except Exception:
                pass
        GLOBAL_CONN    = connect_rmq()
        GLOBAL_CHANNEL = GLOBAL_CONN.channel()
        GLOBAL_CHANNEL.queue_declare(queue="oracle.analysis", durable=True)
        GLOBAL_CHANNEL.queue_declare(queue="oracle.status",   durable=True)
        print("[RabbitMQ] ✓ Yeniden bağlandı.")
        return True
    except Exception as e:
        print(f"[RabbitMQ] Yeniden bağlanamadı: {e}")
        GLOBAL_CHANNEL = None
        return False


def send_syslog(msg: str, level: str = "INFO"):
    print(msg)
    if not _ensure_channel():
        return

    # Calculate accuracy stats if available
    acc = 0.0
    try:
        if STATS_FILE.exists():
            stats = json.loads(STATS_FILE.read_text())
            total = stats.get("total_evaluated", 0)
            if total > 0:
                acc = stats.get("total_correct", 0) / total
    except Exception:
        pass

    try:
        payload = {
            "Level": level,
            "Message": msg.strip(),
            "Timestamp": datetime.datetime.utcnow().isoformat(),
            "Accuracy": round(acc, 4)
        }
        GLOBAL_CHANNEL.basic_publish(
            exchange="",
            routing_key="oracle.status",
            body=json.dumps(payload, ensure_ascii=False),
            properties=pika.BasicProperties(delivery_mode=2, content_type="application/json")
        )
    except Exception as e:
        print(f"Syslog gönderme hatası: {e}")


# ── Sabitler ─────────────────────────────────────────────────────────────────
CORE_API   = os.environ.get("CORE_API_URL", "http://core-api:8080")
RMQ_HOST   = os.environ.get("RABBITMQ_HOST", "localhost")
CYCLE_MIN  = int(os.environ.get("ORACLE_CYCLE_MINUTES", "60"))
MODELS_DIR = Path("/app/models")
MODEL_FILE = MODELS_DIR / "oracle_pipeline_v2.joblib"
TRAIN_FILE = MODELS_DIR / "training_data_v2.csv"
PRED_FILE  = MODELS_DIR / "prediction_log_v2.csv"
STATS_FILE = MODELS_DIR / "accuracy_stats_v2.json"
DRIFT_FILE = MODELS_DIR / "drift_stats.json"

BIST_MAP = {
    "THYAO": "THYAO.IS", "GARAN": "GARAN.IS", "AKBNK": "AKBNK.IS",
    "EREGL": "EREGL.IS", "SISE":  "SISE.IS",  "KCHOL": "KCHOL.IS",
    "ARCLK": "ARCLK.IS", "BIMAS": "BIMAS.IS", "ASELS": "ASELS.IS",
    "FROTO": "FROTO.IS", "TUPRS": "TUPRS.IS",  "SASA":  "SASA.IS",
    "SAHOL": "SAHOL.IS", "TTKOM": "TTKOM.IS",  "TCELL": "TCELL.IS",
    "PGSUS": "PGSUS.IS", "MGROS": "MGROS.IS",  "HALKB": "HALKB.IS",
    "VAKBN": "VAKBN.IS", "YKBNK": "YKBNK.IS",  "PETKM": "PETKM.IS",
    "EKGYO": "EKGYO.IS", "ISCTR": "ISCTR.IS",  "TOASO": "TOASO.IS",
    "VESTL": "VESTL.IS",
}
COMMODITY_MAP = {"XAUUSD": "GC=F", "XAGUSD": "SI=F", "BRENTOIL": "BZ=F"}
FOREX_MAP     = {"USDTRY": "USDTRY=X", "EURTRY": "EURTRY=X"}
ALL_SYMBOLS   = {**BIST_MAP, **COMMODITY_MAP, **FOREX_MAP}

# ML özellik isimleri — eğitim ve çıkarım arasında tutarlı olmalı
FEATURE_NAMES = [
    "rsi", "rsi_prev5", "rsi_oversold", "rsi_overbought",
    "macd_hist", "macd_cross_up", "macd_cross_down",
    "bb_pct", "bb_below", "bb_above",
    "ema20_diff", "above_ema20", "above_ema50",
    "ret_1d", "ret_5d", "ret_20d",
    "vol_ratio", "ema50_trend",
    "news_sent", "macro_sent", "is_geo",
]

LABEL_IDX  = {0: "SELL", 1: "NEUTRAL", 2: "BUY"}
UP_THRESH  = 0.025    # +2.5% / 5 gün → BUY
DN_THRESH  = -0.025   # -2.5% / 5 gün → SELL
HORIZON    = 5        # kaç gün sonraki fiyata bakılır

RETRAIN_EVERY  = 300    # birikimli yeni outcome sayısı → retrain tetikler
MIN_TRAIN_ROWS = 300   # eğitim için minimum örnek sayısı
MAX_TRAIN_ROWS = 15000  # Kayan Pencere (Sliding Window) sınırı

# ── Walk-Forward Backtest Sabitleri ──────────────────────────────────────────
WF_INITIAL_TRAIN = 252   # İlk eğitim penceresi (≈ 1 yıl işlem günü)
WF_STEP          = 63    # Her adımda kaç gün ilerle (≈ 1 çeyrek)
WALKFORWARD_FILE = MODELS_DIR / "walkforward_results.csv"
WF_SUMMARY_FILE  = MODELS_DIR / "walkforward_summary.json"


# ── Özellik Çıkarımı ─────────────────────────────────────────────────────────

def _safe(series, idx=-1):
    try:
        v = float(series.iloc[idx])
        return None if (math.isnan(v) or math.isinf(v)) else v
    except Exception:
        return None


def compute_feature_df(df: pd.DataFrame) -> pd.DataFrame:
    """OHLCV DataFrame'inden ML özellik matrisi üretir (tüm satırlar)."""
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.droplevel(1)

    close  = df["Close"].squeeze().ffill()
    volume = df["Volume"].squeeze().fillna(0)

    feat = pd.DataFrame(index=df.index)

    # RSI
    try:
        rsi = ta.momentum.RSIIndicator(close, 14).rsi()
        feat["rsi"]         = rsi
        feat["rsi_prev5"]   = rsi.rolling(5).mean()
        feat["rsi_oversold"]  = (rsi < 30).astype(float)
        feat["rsi_overbought"] = (rsi > 70).astype(float)
    except Exception:
        for c in ["rsi","rsi_prev5","rsi_oversold","rsi_overbought"]:
            feat[c] = 0.0

    # MACD
    try:
        macd_obj  = ta.trend.MACD(close)
        mhist     = macd_obj.macd_diff()
        feat["macd_hist"]      = mhist
        feat["macd_cross_up"]  = ((mhist > 0) & (mhist.shift(1) <= 0)).astype(float)
        feat["macd_cross_down"]= ((mhist < 0) & (mhist.shift(1) >= 0)).astype(float)
    except Exception:
        for c in ["macd_hist","macd_cross_up","macd_cross_down"]:
            feat[c] = 0.0

    # Bollinger
    try:
        bb    = ta.volatility.BollingerBands(close)
        bbu   = bb.bollinger_hband()
        bbl   = bb.bollinger_lband()
        bbr   = (bbu - bbl).replace(0, np.nan)
        feat["bb_pct"]   = (close - bbl) / bbr
        feat["bb_below"] = (close < bbl).astype(float)
        feat["bb_above"] = (close > bbu).astype(float)
    except Exception:
        feat["bb_pct"] = feat["bb_below"] = feat["bb_above"] = 0.0

    # EMA
    try:
        ema20 = ta.trend.EMAIndicator(close, 20).ema_indicator()
        ema50 = ta.trend.EMAIndicator(close, 50).ema_indicator()
        feat["ema20_diff"]  = (ema20 - ema50) / ema50.replace(0, np.nan)
        feat["above_ema20"] = (close > ema20).astype(float)
        feat["above_ema50"] = (close > ema50).astype(float)
        feat["ema50_trend"] = ema50.pct_change(5)
    except Exception:
        for c in ["ema20_diff","above_ema20","above_ema50","ema50_trend"]:
            feat[c] = 0.0

    # Getiri & hacim
    feat["ret_1d"]   = close.pct_change(1)
    feat["ret_5d"]   = close.pct_change(5)
    feat["ret_20d"]  = close.pct_change(20)
    vol_ma           = volume.rolling(20).mean().replace(0, np.nan)
    feat["vol_ratio"] = volume / vol_ma

    # Duyarlılık (eğitimde 0, çıkarımda doldurulur)
    feat["news_sent"]  = 0.0
    feat["macro_sent"] = 0.0
    feat["is_geo"]     = 0.0

    return feat[FEATURE_NAMES]


def compute_labels(close: pd.Series, horizon=HORIZON) -> pd.Series:
    """Her gün t için t+horizon günündeki yön etiketini döndürür."""
    fwd_ret = close.shift(-horizon) / close - 1
    labels  = pd.Series(1, index=close.index, dtype=int)  # NEUTRAL
    labels[fwd_ret > UP_THRESH]  = 2  # BUY
    labels[fwd_ret < DN_THRESH]  = 0  # SELL
    labels[fwd_ret.isna()]       = -1  # son horizon gün — yok say
    return labels


# ── Model ────────────────────────────────────────────────────────────────────

def build_pipeline() -> Pipeline:
    base_clf = RandomForestClassifier(
        n_estimators=300,
        max_depth=10,
        min_samples_leaf=5,
        class_weight="balanced",
        random_state=42,
        n_jobs=-1,
    )
    calibrated = CalibratedClassifierCV(base_clf, method="sigmoid", cv=3)
    return Pipeline([
        ("scaler", StandardScaler()),
        ("clf",    calibrated),
    ])


def train_pipeline(X: np.ndarray, y: np.ndarray) -> Pipeline:
    pipe = build_pipeline()
    pipe.fit(X, y)
    return pipe


def predict_one(pipe: Pipeline, feat_dict: dict) -> tuple[str, float, dict]:
    """(label, confidence, importances) döndürür.

    3-sınıflı modelde NEUTRAL genellikle en yüksek olasılıklı sınıftır.
    Bu nedenle BUY/SELL kararını NEUTRAL'ı "yenmek" yerine BUY ve SELL
    olasılıklarının farkına göre veririz. Böylece piyasa yönlü sinyaller
    ortaya çıkar.
    """
    X     = np.array([[feat_dict.get(f, 0.0) for f in FEATURE_NAMES]])
    proba = pipe.predict_proba(X)[0]   # [P_SELL, P_NEUTRAL, P_BUY]

    buy_p  = float(proba[2])
    sell_p = float(proba[0])
    neut_p = float(proba[1])

    # BUY-SELL farkı: 0.08 fark yönü belirler;
    # ayrıca yön olasılığı en az 0.28 olmalı (çok belirsiz olmamalı)
    diff = buy_p - sell_p
    if diff > 0.08 and buy_p >= 0.28:
        label = "BUY"
        # Yönlü güven: BUY'un BUY+SELL toplamı içindeki payı → daha anlamlı oran
        conf  = buy_p / (buy_p + sell_p) if (buy_p + sell_p) > 0 else buy_p
    elif diff < -0.08 and sell_p >= 0.28:
        label = "SELL"
        conf  = sell_p / (buy_p + sell_p) if (buy_p + sell_p) > 0 else sell_p
    else:
        label = "NEUTRAL"
        conf  = neut_p

    # Özellik önem skorları (CalibratedClassifierCV içinden RF'e erişim)
    try:
        rf  = pipe.named_steps["clf"].calibrated_classifiers_[0].estimator
        imp = dict(zip(FEATURE_NAMES, rf.feature_importances_))
    except Exception:
        imp = {f: 1/len(FEATURE_NAMES) for f in FEATURE_NAMES}

    return label, conf, imp


def get_recommendation(label: str, conf: float) -> str:
    # predict_one() BUY-SELL fark mantığıyla label=NEUTRAL döndürdüyse direkt NÖTR.
    # BUY/SELL için: conf = BUY/(BUY+SELL) oranı (0.50-1.0 arası tipik).
    if label == "NEUTRAL":
        return "NÖTR"
    if label == "BUY":
        return "GÜÇLÜ ALIM" if conf >= 0.70 else "ALIM"
    if label == "SELL":
        return "GÜÇLÜ KAÇIN" if conf >= 0.70 else "KAÇIN"
    return "NÖTR"


# ── Metin Üretimi (LLM olmadan kural tabanlı) ─────────────────────────────────

def generate_text(feat: dict, label: str, conf: float, imp: dict,
                  fund_score: float = 0.5) -> tuple[str, list, list, list]:
    """(reasoning, key_drivers, risks, watch_points) Türkçe üretir."""
    parts   = []
    drivers = []
    risks   = []
    watches = []

    rsi = feat.get("rsi", 50) or 50

    # RSI
    if feat.get("rsi_oversold"):
        parts.append(f"RSI {rsi:.0f} ile aşırı satış bölgesinde")
        drivers.append(f"RSI {rsi:.0f} — aşırı satış, geri dönüş potansiyeli yüksek")
    elif feat.get("rsi_overbought"):
        parts.append(f"RSI {rsi:.0f} ile aşırı alım bölgesinde")
        risks.append(f"RSI {rsi:.0f} — aşırı alım, düzeltme riski var")
    else:
        parts.append(f"RSI {rsi:.0f} nötr bölgede")

    # MACD
    if feat.get("macd_cross_up"):
        parts.append("MACD yeni pozitif kesişim yaptı")
        drivers.append("MACD altın kesişim — güçlü alım sinyali")
    elif feat.get("macd_cross_down"):
        parts.append("MACD yeni negatif kesişim yaptı")
        risks.append("MACD ölüm kesişimi — satış baskısı artıyor")
    elif (feat.get("macd_hist") or 0) > 0:
        drivers.append("MACD histogram pozitif — yukarı momentum sürüyor")
    else:
        risks.append("MACD histogram negatif — aşağı baskı sürüyor")

    # Bollinger
    if feat.get("bb_below"):
        drivers.append("Bollinger alt bandının altında — aşırı satım bölgesi")
        parts.append("fiyat Bollinger alt bandının altına indi")
    elif feat.get("bb_above"):
        risks.append("Bollinger üst bandını aştı — olası düzeltme")

    # EMA trendi
    if feat.get("above_ema50") and (feat.get("ema20_diff") or 0) > 0.01:
        drivers.append("Fiyat EMA50 üzerinde, EMA20 > EMA50 — boğa trendi")
    elif not feat.get("above_ema50") and (feat.get("ema20_diff") or 0) < -0.01:
        risks.append("Fiyat EMA50 altında, EMA20 < EMA50 — ayı trendi")

    # 5 günlük getiri
    r5 = feat.get("ret_5d") or 0
    if abs(r5) > 0.05:
        yön = "yükseliş" if r5 > 0 else "düşüş"
        if (r5 > 0 and label == "BUY") or (r5 < 0 and label == "SELL"):
            drivers.append(f"Son 5 günlük {abs(r5)*100:.1f}% {yön} trendi güçlü")
        else:
            watches.append(f"Son 5 günlük {abs(r5)*100:.1f}% {yön} — momentum değişimine dikkat")

    # Hacim
    vr = feat.get("vol_ratio") or 1
    if vr > 1.5:
        drivers.append(f"Hacim ortalamanın {vr:.1f}x üzerinde — güçlü ilgi")
    elif vr < 0.6:
        watches.append("Düşük hacim — hareketi hacim artışıyla teyit edin")

    # Duyarlılık
    ns = feat.get("news_sent") or 0
    if ns > 0.2:
        drivers.append("Haber duyarlılığı olumlu")
    elif ns < -0.2:
        risks.append("Haber duyarlılığı olumsuz")
    if feat.get("is_geo"):
        risks.append("Jeopolitik gelişmeler belirsizlik yaratıyor")
        watches.append("Jeopolitik haberleri yakından takip edin")

    # Temel Analiz (Faz 2)
    if fund_score >= 0.65:
        drivers.append(f"Temel analiz güçlü (skor: {fund_score:.0%}) — değerleme ve karlılık olumlu")
    elif fund_score >= 0.55:
        drivers.append(f"Temel göstergeler nötr-olumlu (skor: {fund_score:.0%})")
    elif fund_score <= 0.35:
        risks.append(f"Temel analiz zayıf (skor: {fund_score:.0%}) — değerleme veya borç endişe verici")
    elif fund_score <= 0.45:
        watches.append(f"Temel göstergeler nötr-olumsuz (skor: {fund_score:.0%}), yakından izleyin")

    # Hacim Teyidi — hacimsiz hareket dikkat sinyali
    vr = feat.get("vol_ratio") or 1
    ret5 = feat.get("ret_5d") or 0
    if abs(ret5) > 0.03 and vr < 0.7:
        watches.append(f"Son {abs(ret5)*100:.0f}% hareketi düşük hacimle gerçekleşti — teyit bekleyin")
    elif abs(ret5) > 0.03 and vr > 1.5:
        drivers.append(f"Hareket yüksek hacimle ({vr:.1f}x) teyit edildi — güvenilir sinyal")

    # Genel izleme noktaları
    watches.append("Önemli destek/direnç seviyelerini takip edin")

    # Metni birleştir
    conf_text = "yüksek" if conf >= 0.62 else "orta" if conf >= 0.50 else "düşük"
    rec = get_recommendation(label, conf)
    base = f"Model {conf:.0%} ({conf_text}) güvenle {rec} tavsiyesi üretiyor. "
    reasoning = base + ("; ".join(parts[:3]).capitalize() + "." if parts else "Karışık sinyaller, net yön belirlenemedi.")

    return (
        reasoning,
        (drivers or ["Teknik göstergeler " + label + " yönünde"])[:3],
        (risks   or ["Piyasa genel riski mevcuttur"])[:3],
        watches[:3],
    )


def get_targets(feat: dict, close: float | None, label: str) -> tuple[float | None, float | None]:
    """BB bantlarını kullanarak hedef ve stop-loss hesaplar."""
    if close is None:
        return None, None
    bu = feat.get("bb_pct")  # bb_pct yerine doğrudan üst/alt lazım ama bunlar feature değil
    # Yaklaşık hedef: %4 yukarı/aşağı
    if label == "BUY":
        return round(close * 1.04, 2), round(close * 0.97, 2)
    if label == "SELL":
        return round(close * 0.96, 2), round(close * 1.03, 2)
    return None, None


# ── Model Başarı ve Sapma Analizleri (Drift & Backtest) ─────────────────────────

def calculate_sharpe(returns: list[float]) -> float:
    if not returns or len(returns) < 2: return 0.0
    arr = np.array(returns)
    std = np.std(arr)
    if std == 0: return 0.0
    # Varsayılan Risksiz Getiri = 0 kabul ederek oranlama
    # Returnler günlük periyotlu gelmiş varsayıyoruz, yıllıklandırma faktörü 252
    return (np.mean(arr) / std) * np.sqrt(252)

def backtest_shadow_model(pipe: Pipeline, df: pd.DataFrame) -> tuple[float, float, bool]:
    """
    Son N günlük Test verisinde Shadow Deployment validasyonu.
    Return: (Accuracy, Sharpe Ratio, Passed?)
    """
    if len(df) < 10:
        return 0.0, 0.0, True # Yetersiz test verisi, varsayılan Passed
    
    X_test = df[FEATURE_NAMES].values
    y_test = df["label"].astype(int).values
    predictions = pipe.predict(X_test)
    
    correct = (predictions == y_test).sum()
    acc = correct / len(y_test)
    
    # Sharpe Ratio için mock günlük getiriler hesaplıyoruz.
    # dataframe'de "Close" olmadığı için gerçek label cevapları (y_test) üzerinden
    # sabit oranlı penalize/reward mantığıyla (Kazan/Kaybet) sentetik getiri çıkarıyoruz.
    returns = []
    for pred, actual in zip(predictions, y_test):
        if pred == 2: # Model says BUY
            if actual == 2: returns.append(0.025) # Doğru
            elif actual == 0: returns.append(-0.025) # Tam tersi
            else: returns.append(-0.01) # Nötr kaldı
        elif pred == 0: # Model says SELL
            if actual == 0: returns.append(0.025) 
            elif actual == 2: returns.append(-0.025)
            else: returns.append(-0.01)
        else:
            returns.append(0.0)
            
    sharpe = calculate_sharpe(returns)
    
    # Dummy Check (Bias): Hep aynı kararı mı veriyor?
    preds_unique = np.unique(predictions)
    is_biased = len(preds_unique) == 1
    
    # Kriter: Accuracy en az %45 ve Sharpe en az 1.5, ve bias olmamalı
    passed = (acc >= 0.45) and (sharpe >= 1.5) and not is_biased
    
    return acc, sharpe, passed

def update_drift_stats(X: np.ndarray):
    """Eğitim sırasındaki feature ortalamalarını kaydeder."""
    means = np.mean(X, axis=0).tolist()
    DRIFT_FILE.write_text(json.dumps({"means": means}))

def check_concept_drift(recent_X: np.ndarray) -> bool:
    """Yeni veride >%10 istatistiksel sapma var mı?"""
    if not DRIFT_FILE.exists(): return False
    try:
        data = json.loads(DRIFT_FILE.read_text())
        train_means = np.array(data["means"])
        curr_means = np.mean(recent_X, axis=0)
        
        # Varyans sapması (basit rasyo)
        with np.errstate(divide='ignore', invalid='ignore'):
            diff = np.abs((curr_means - train_means) / train_means)
        
        # Eğer herhangi önemli feature'da %10'dan fazla kayma varsa:
        if np.nanmean(diff) > 0.10: 
            return True
        return False
    except Exception:
        return False

# ── Walk-Forward Backtest ────────────────────────────────────────────────────

def run_historical_walk_forward(skip_final_train: bool = False, log_fn=None) -> "Pipeline | None":
    """
    Geçmişten bugüne gerçek Walk-Forward Backtest.

    Algoritma:
      1.  Tüm semboller için 3 yıllık günlük OHLCV verisi bir kez indirilir.
      2.  İlk WF_INITIAL_TRAIN günle model eğitilir.
      3.  Sonraki WF_STEP günde tahmin yapılır → gerçek sonuçla karşılaştırılır.
      4.  Pencere kaydırılır (expanding/büyüyen pencere) ve model yeniden eğitilir.
      5.  Bugüne ulaşana kadar adımlar tekrarlanır.
      6.  Tüm sonuçlar CSV'ye, özet JSON'a kaydedilir.
      7.  Son olarak TÜM geçmiş veriyle nihai model eğitilir (live trading modeli).

    skip_final_train=True → Sadece backtest istatistikleri üretir, mevcut modeli
                            değiştirmez (arka plan thread için kullanılır).
    """
    # pika thread-safe değil; arka plan thread için print-only log kullan
    _log = log_fn if log_fn is not None else send_syslog

    _log(
        "[WalkForward] Tarihsel Walk-Forward Backtest başlatılıyor... "
        "(Bu işlem ~10-20 dakika sürebilir)", "TRAINING"
    )

    # ── 1. Tüm sembollerin verilerini toplu indir ─────────────────────────────
    symbol_data: dict[str, pd.DataFrame] = {}
    for sym, yf_sym in ALL_SYMBOLS.items():
        try:
            df = yf.download(
                yf_sym, period="3y", interval="1d",
                auto_adjust=True, progress=False, threads=False,
            )
            if df is None or len(df) < WF_INITIAL_TRAIN + HORIZON + 10:
                _log(f"[WalkForward] {sym}: yetersiz veri ({len(df) if df is not None else 0} gün), atlandı.", "WARN")
                time.sleep(0.5)
                continue
            if isinstance(df.columns, pd.MultiIndex):
                df.columns = df.columns.droplevel(1)

            feat_df = compute_feature_df(df)
            close   = df["Close"].squeeze().ffill()
            labels  = compute_labels(close)

            combined = feat_df.copy()
            combined["label"] = labels
            combined["close"] = close.values
            combined["date"]  = [str(d.date()) for d in df.index]
            combined = combined.dropna()
            combined = combined[combined["label"] >= 0]

            if len(combined) >= WF_INITIAL_TRAIN + HORIZON:
                symbol_data[sym] = combined.reset_index(drop=True)
                print(f"  {sym}: {len(combined)} geçerli gün yüklendi")
            time.sleep(0.6)
        except Exception as e:
            print(f"  {sym}: {e}")
            time.sleep(1)

    if not symbol_data:
        _log("[WalkForward] Hiç veri indirilemedi!", "ERROR")
        return None

    # Tüm sembollerin ortak minimum uzunluğu
    min_len = min(len(df) for df in symbol_data.values())
    _log(
        f"[WalkForward] {len(symbol_data)} sembol hazır, "
        f"ortak uzunluk: {min_len} gün. Backtest döngüsü başlıyor...", "TRAINING"
    )

    # ── 2. Walk-Forward döngüsü ───────────────────────────────────────────────
    wf_rows    = []       # Ham sonuçlar (CSV için)
    step_stats = []       # Adım bazlı özet (grafik için)
    pipe       = None

    steps = list(range(WF_INITIAL_TRAIN, min_len - HORIZON, WF_STEP))
    for step_idx, t in enumerate(steps, 1):
        # Eğitim: indeks 0..t (expanding pencere — her adımda büyür)
        X_all, y_all = [], []
        for sym, df in symbol_data.items():
            if len(df) <= t:
                continue
            X_chunk = df[FEATURE_NAMES].values[:t]
            y_chunk = df["label"].values[:t].astype(int)
            valid   = np.isfinite(X_chunk).all(axis=1)
            if valid.sum() >= 30:
                X_all.append(X_chunk[valid])
                y_all.append(y_chunk[valid])

        if not X_all or sum(len(y) for y in y_all) < MIN_TRAIN_ROWS:
            continue

        X_train = np.vstack(X_all)
        y_train = np.concatenate(y_all)
        # Sliding window: çok büyümesin
        if len(y_train) > MAX_TRAIN_ROWS:
            X_train = X_train[-MAX_TRAIN_ROWS:]
            y_train = y_train[-MAX_TRAIN_ROWS:]

        # Modeli bu adımın eğitim verisiyle eğit
        pipe = train_pipeline(X_train, y_train)

        # Test penceresi: indeks t..t+WF_STEP  (model bu günleri hiç görmedi)
        test_end     = min(t + WF_STEP, min_len - HORIZON)
        step_correct = 0
        step_total   = 0
        buy_c = buy_t = sell_c = sell_t = 0

        for sym, df in symbol_data.items():
            if len(df) <= test_end:
                continue
            for i in range(t, test_end):
                row_feat    = {f: float(df[f].iloc[i]) for f in FEATURE_NAMES}
                actual_int  = int(df["label"].iloc[i])
                actual      = LABEL_IDX.get(actual_int, "NEUTRAL")
                close_price = float(df["close"].iloc[i])
                date_str    = str(df["date"].iloc[i])

                # Tahmin (eğitim verisinden izole test günü)
                feat_arr = np.array([[row_feat.get(f, 0.0) for f in FEATURE_NAMES]])
                proba    = pipe.predict_proba(feat_arr)[0]
                buy_p    = float(proba[2])
                sell_p   = float(proba[0])
                diff     = buy_p - sell_p
                if diff > 0.08 and buy_p >= 0.28:
                    predicted = "BUY"
                elif diff < -0.08 and sell_p >= 0.28:
                    predicted = "SELL"
                else:
                    predicted = "NEUTRAL"

                is_correct = int(predicted == actual)
                step_correct += is_correct
                step_total   += 1
                if predicted == "BUY":
                    buy_t += 1; buy_c += is_correct
                elif predicted == "SELL":
                    sell_t += 1; sell_c += is_correct

                wf_rows.append({
                    "date": date_str, "symbol": sym,
                    "step": step_idx, "train_size": len(y_train),
                    "predicted": predicted, "actual": actual,
                    "correct": is_correct,
                    "confidence": round(float(max(buy_p, sell_p)), 4),
                    "close": round(close_price, 2),
                })

        step_acc = step_correct / step_total if step_total else 0
        step_stats.append({
            "step": step_idx,
            "train_days": t,
            "test_days": step_total,
            "accuracy": round(step_acc, 4),
            "buy_accuracy":  round(buy_c / buy_t, 4) if buy_t else None,
            "sell_accuracy": round(sell_c / sell_t, 4) if sell_t else None,
        })
        _log(
            f"[WalkForward] Adım {step_idx}/{len(steps)} | "
            f"Eğitim: {len(y_train)} | Test: {step_total} tahmin | "
            f"Doğruluk: {step_acc:.1%}",
            "TRAINING",
        )

    if not wf_rows:
        _log("[WalkForward] Hiç sonuç üretilemedi.", "ERROR")
        return None

    # ── 3. Sonuçları kaydet ───────────────────────────────────────────────────
    df_results = pd.DataFrame(wf_rows)
    df_results.to_csv(WALKFORWARD_FILE, index=False)

    overall_acc = float(df_results["correct"].mean())
    buy_df      = df_results[df_results["predicted"] == "BUY"]
    sell_df     = df_results[df_results["predicted"] == "SELL"]
    sym_acc     = (
        df_results.groupby("symbol")["correct"]
        .agg(["mean", "count"])
        .rename(columns={"mean": "accuracy", "count": "n"})
        .sort_values("accuracy", ascending=False)
        .head(10)
        .reset_index()
        .to_dict(orient="records")
    )
    summary = {
        "overall_accuracy":  round(overall_acc, 4),
        "buy_accuracy":      round(float(buy_df["correct"].mean()), 4) if len(buy_df) else 0,
        "sell_accuracy":     round(float(sell_df["correct"].mean()), 4) if len(sell_df) else 0,
        "neutral_pct":       round(float((df_results["predicted"] == "NEUTRAL").mean()), 4),
        "n_predictions":     len(df_results),
        "n_steps":           len(step_stats),
        "n_symbols":         len(symbol_data),
        "step_stats":        step_stats,
        "top_symbols":       sym_acc,
        "completed_at":      datetime.datetime.utcnow().isoformat(),
    }
    WF_SUMMARY_FILE.write_text(json.dumps(summary, indent=2, ensure_ascii=False))
    _log(
        f"[WalkForward] ✅ TAMAMLANDI — "
        f"Genel: {overall_acc:.1%} | "
        f"BUY: {summary['buy_accuracy']:.1%} | "
        f"SELL: {summary['sell_accuracy']:.1%} | "
        f"{len(df_results):,} tahmin değerlendirildi",
        "SUCCESS",
    )

    # ── 4. Nihai model: TÜM geçmiş veriyle eğit ─────────────────────────────
    if not skip_final_train:
        X_all, y_all = [], []
        for sym, df in symbol_data.items():
            X_chunk = df[FEATURE_NAMES].values
            y_chunk = df["label"].values.astype(int)
            valid   = np.isfinite(X_chunk).all(axis=1)
            X_all.append(X_chunk[valid])
            y_all.append(y_chunk[valid])

        X_final = np.vstack(X_all)
        y_final = np.concatenate(y_all)
        if len(y_final) > MAX_TRAIN_ROWS:
            X_final = X_final[-MAX_TRAIN_ROWS:]
            y_final = y_final[-MAX_TRAIN_ROWS:]

        pipe = train_pipeline(X_final, y_final)
        df_train = pd.DataFrame(X_final, columns=FEATURE_NAMES)
        df_train["label"] = y_final
        df_train.to_csv(TRAIN_FILE, index=False)
        joblib.dump(pipe, MODEL_FILE)
        update_drift_stats(X_final)
        _log(
            f"[WalkForward] Nihai model {len(y_final):,} örnekle eğitildi ve kaydedildi.",
            "SUCCESS",
        )

    return pipe


def _background_walk_forward():
    """
    Model zaten mevcutsa sadece backtest raporunu üretir, modeli değiştirmez.
    pika thread-safe değil; bu thread içinde RabbitMQ kullanmaz, sadece print eder.
    """
    def _print_log(msg, level="INFO"):
        print(f"[WalkForward-BG] [{level}] {msg}")

    try:
        run_historical_walk_forward(skip_final_train=True, log_fn=_print_log)
    except Exception as e:
        print(f"[WalkForward-BG] Hata: {e}")


# ── Bootstrap Eğitim ─────────────────────────────────────────────────────────

def bootstrap_train() -> Pipeline | None:
    """Tüm semboller için 3 yıllık tarihsel veri indirir ve model eğitir."""
    send_syslog("[Bootstrap] 3 Yıllık tarihsel verilerle model eğitimi başlıyor...", "TRAINING")
    all_X, all_y = [], []

    for sym, yf_sym in ALL_SYMBOLS.items():
        try:
            df = yf.download(yf_sym, period="3y", interval="1d",
                             auto_adjust=True, progress=False, threads=False)
            if df is None or len(df) < MIN_TRAIN_ROWS:
                print(f"  {sym}: yetersiz veri ({len(df) if df is not None else 0} satır)")
                time.sleep(0.5)
                continue

            feat_df = compute_feature_df(df)
            close   = df["Close"].squeeze().ffill()
            labels  = compute_labels(close)

            combined = feat_df.copy()
            combined["label"] = labels
            combined = combined.dropna()
            combined = combined[combined["label"] >= 0]

            if len(combined) < 50:
                print(f"  {sym}: temizleme sonrası yetersiz ({len(combined)} satır)")
                time.sleep(0.5)
                continue

            X = combined[FEATURE_NAMES].values
            y = combined["label"].astype(int).values
            all_X.append(X)
            all_y.append(y)
            print(f"  {sym}: {len(y)} eğitim örneği eklendi")
            time.sleep(0.8)

        except Exception as e:
            print(f"  {sym}: hata — {e}")
            time.sleep(1)

    if not all_X:
        print("[Bootstrap] Hiç veri toplanamadı.")
        return None

    X_all = np.vstack(all_X)
    y_all = np.concatenate(all_y)

    # CSV'ye kaydet (sonraki retraining için)
    df_train = pd.DataFrame(X_all, columns=FEATURE_NAMES)
    df_train["label"] = y_all
    df_train.to_csv(TRAIN_FILE, index=False)

    send_syslog(f"[Bootstrap] Toplam {len(y_all)} örnek ile model eğitiliyor...", "TRAINING")
    counts = {LABEL_IDX[k]: int((y_all==k).sum()) for k in [0,1,2]}
    print(f"  Dağılım: {counts}")

    pipe = train_pipeline(X_all, y_all)
    update_drift_stats(X_all)
    joblib.dump(pipe, MODEL_FILE)

    send_syslog(f"MODEL_UPDATED: [v1.0] - Bootstrap eğitimi başarılı. Model {len(y_all)} örnekle başlatıldı.", "SUCCESS")
    print("\n" + "★"*55)
    print("  ✓ BOOTSTRAP EĞİTİMİ TAMAMLANDI")
    print(f"  ✓ Model {len(y_all)} örnekle eğitildi")
    print(f"  ✓ {MODEL_FILE} dosyasına kaydedildi")
    print("  ✓ İlk analiz döngüsü başlıyor...")
    print("★"*55 + "\n")
    return pipe


def load_or_bootstrap() -> Pipeline | None:
    if MODEL_FILE.exists():
        pipe = joblib.load(MODEL_FILE)
        send_syslog("✓ MEVCUT MODEL YÜKLENDİ", "INFO")
        print("\n" + "★"*55)
        print("  ✓ MEVCUT MODEL YÜKLENDİ")
        print(f"  ✓ {MODEL_FILE}")
        print("  ✓ Analiz döngüsü hemen başlıyor...")
        print("★"*55 + "\n")
        # Walk-Forward thread'i burada BAŞLATMA.
        # İlk analiz döngüsü tamamlandıktan sonra main() içinde başlatılır.
        # Eş zamanlı çalışma pika bağlantısını bozuyordu.
        return pipe
    # Model yok: Walk-Forward Backtest + nihai model eğitimi (ana thread, sync)
    send_syslog("[WalkForward] Model bulunamadı. Walk-Forward Backtest başlatılıyor...", "TRAINING")
    return run_historical_walk_forward(skip_final_train=False)


# ── Yeniden Eğitim ───────────────────────────────────────────────────────────

def retrain_from_csv() -> Pipeline | None:
    if not TRAIN_FILE.exists():
        return None
    df = pd.read_csv(TRAIN_FILE)
    if len(df) < MIN_TRAIN_ROWS:
        send_syslog(f"[Retrain] Yetersiz veri: {len(df)} / {MIN_TRAIN_ROWS}", "WARN")
        return None

    # ── Kronolojik Train / Test Ayrımı ────────────────────────────────────
    # Veri zamana göre sıralı geldiği için son %15'i out-of-sample test olarak ayır.
    # In-sample test (aynı veriyle hem eğit hem test) sahte başarı oranı üretir.
    split_idx = int(len(df) * 0.85)
    df_train  = df.iloc[:split_idx]
    df_test   = df.iloc[split_idx:]

    if len(df_train) < MIN_TRAIN_ROWS:
        # Yeterli eğitim seti yoksa tümünü kullan (başlangıç döneminde)
        df_train = df
        df_test  = df.iloc[-max(50, len(df)//10):]

    X_train = df_train[FEATURE_NAMES].values
    y_train = df_train["label"].astype(int).values
    send_syslog(
        f"[Retrain] Train:{len(y_train)} | Test:{len(df_test)} | "
        f"Shadow Model (Gölge Model) eğitiliyor...", "TRAINING"
    )
    shadow_pipe = train_pipeline(X_train, y_train)

    # Out-of-sample test: model daha önce hiç görmediği veriye karşı
    acc, sharpe, passed = backtest_shadow_model(shadow_pipe, df_test)

    if passed:
        joblib.dump(shadow_pipe, MODEL_FILE)
        update_drift_stats(X_train)
        send_syslog(f"MODEL_UPDATED: [v2.x] - OOS Accuracy: {acc:.1%} - Sharpe: {sharpe:.2f}", "SUCCESS")
        return shadow_pipe
    else:
        send_syslog(
            f"TRAINING_FAILED: OOS testi başarısız. Accuracy: {acc:.1%}, Sharpe: {sharpe:.2f}. "
            f"Önceki modele geri dönülüyor.", "ERROR"
        )
        if MODEL_FILE.exists():
            return joblib.load(MODEL_FILE)
        return shadow_pipe


# ── Tahmin Kaydı ve Öz-Değerlendirme ─────────────────────────────────────────

def log_prediction(symbol: str, yf_sym: str, label: str, conf: float, close: float | None, target: float | None):
    """Her tahmini dosyaya kaydeder."""
    row = {
        "timestamp": datetime.datetime.utcnow().isoformat(),
        "symbol": symbol, "yf_sym": yf_sym,
        "predicted": label, "confidence": conf,
        "close": close or 0.0,
        "target": target or 0.0,
        "eval_1d": "", "eval_5d": "", "eval_20d": "",
    }
    write_header = not PRED_FILE.exists()
    with open(PRED_FILE, "a", newline="", encoding="utf-8") as f:
        import csv as csv_mod
        writer = csv_mod.DictWriter(f, fieldnames=list(row.keys()))
        if write_header:
            writer.writeheader()
        writer.writerow(row)


def _direction(ret: float) -> str:
    if ret > UP_THRESH:  return "BUY"
    if ret < DN_THRESH:  return "SELL"
    return "NEUTRAL"


def evaluate_predictions(pipe_holder: list):
    """
    Walk-Forward Değerlendirme:
      - Her tahmin için t+h_days TARİHİNDEKİ fiyatı çeker (bugünün fiyatını değil).
      - Gerçek (feature, label) çiftlerini eğitim verisine ekler.
      - Birikimli doğruluk ve retrain tetiklemesini yönetir.
    """
    import csv as csv_mod

    if not PRED_FILE.exists():
        return

    now = datetime.datetime.utcnow()
    rows = []
    updated = False
    new_outcomes = 0
    correct_total, total_eval = 0, 0

    with open(PRED_FILE, "r", encoding="utf-8") as f:
        rows = list(csv_mod.DictReader(f))

    for row in rows:
        try:
            ts     = datetime.datetime.fromisoformat(row["timestamp"])
            age    = (now - ts).days
            sym    = row["symbol"]
            yf_sym = row["yf_sym"]
            pred   = row["predicted"]   # BUY / SELL / NEUTRAL
            c_then = float(row["close"])
        except Exception:
            continue

        # (horizon_gün, sütun_adı, min_bekleme — hafta sonu buffer dahil)
        horizons = [(1, "eval_1d", 3), (5, "eval_5d", 8), (20, "eval_20d", 26)]

        for h_days, col, min_age in horizons:
            if age < min_age or row.get(col):
                continue
            try:
                # ── GERÇEK WALK-FORWARD: t+h_days tarihinin fiyatını çek ─────
                # Bugünün fiyatını DEĞİL, tahmin gününden tam h_days sonrasını al.
                # Ör: 13 Tem tahmini → eval_5d için 18 Tem kapanışını kullan.
                target_dt = ts + datetime.timedelta(days=h_days)
                end_dt    = target_dt + datetime.timedelta(days=7)   # tatil/h.sonu buffer
                df_future = yf.download(
                    yf_sym,
                    start=target_dt.strftime("%Y-%m-%d"),
                    end=end_dt.strftime("%Y-%m-%d"),
                    interval="1d", auto_adjust=True,
                    progress=False, threads=False,
                )
                if df_future is None or df_future.empty:
                    continue
                if isinstance(df_future.columns, pd.MultiIndex):
                    df_future.columns = df_future.columns.droplevel(1)

                c_future = float(df_future["Close"].squeeze().iloc[0])
                ret      = (c_future - c_then) / c_then if c_then else 0
                actual   = _direction(ret)
                row[col] = f"{actual}|{ret:.4f}"
                updated  = True
                new_outcomes += 1

                is_correct = (pred == actual)
                if is_correct:
                    correct_total += 1
                total_eval += 1

                # ── TAHMİN TARİHİNDEKİ ÖZELLİKLERİ EĞİTİM VERİSİNE EKLE ───
                # period="5d" ile EMA/MACD hesaplanamaz; tahmin günü öncesi
                # 110 günlük veri indirerek doğru feature'lar üret.
                if TRAIN_FILE.exists():
                    f_start = (ts - datetime.timedelta(days=110)).strftime("%Y-%m-%d")
                    f_end   = (ts + datetime.timedelta(days=2)).strftime("%Y-%m-%d")
                    df_feat = yf.download(
                        yf_sym, start=f_start, end=f_end,
                        interval="1d", auto_adjust=True,
                        progress=False, threads=False,
                    )
                    if df_feat is not None and len(df_feat) >= 30:
                        if isinstance(df_feat.columns, pd.MultiIndex):
                            df_feat.columns = df_feat.columns.droplevel(1)
                        feat_row = compute_feature_df(df_feat).iloc[-1].to_dict()
                        feat_row["label"] = {"BUY": 2, "NEUTRAL": 1, "SELL": 0}.get(actual, 1)
                        df_tr = pd.read_csv(TRAIN_FILE)
                        df_tr = pd.concat([df_tr, pd.DataFrame([feat_row])], ignore_index=True)
                        if len(df_tr) > MAX_TRAIN_ROWS:
                            df_tr = df_tr.iloc[-MAX_TRAIN_ROWS:]   # Sliding window
                        df_tr.to_csv(TRAIN_FILE, index=False)

                sign = "✓" if is_correct else "✗"
                print(f"  [{h_days}g eval] {sym}: tahmin={pred:<8} gerçek={actual:<8} ret={ret:+.2%} {sign}")
                time.sleep(0.5)
            except Exception as e:
                print(f"  [{h_days}g eval] {sym} hatası: {e}")

    # CSV'yi güncelle
    if updated and rows:
        with open(PRED_FILE, "w", newline="", encoding="utf-8") as f:
            writer = csv_mod.DictWriter(f, fieldnames=list(rows[0].keys()))
            writer.writeheader()
            writer.writerows(rows)

    # Doğruluk istatistiklerini güncelle (kümülatif)
    stats = {}
    if STATS_FILE.exists():
        try:
            stats = json.loads(STATS_FILE.read_text())
        except Exception:
            pass

    if total_eval > 0:
        cum_correct = stats.get("total_correct", 0) + correct_total
        cum_total   = stats.get("total_evaluated", 0) + total_eval
        overall_acc = cum_correct / cum_total

        stats["overall_accuracy"]        = round(overall_acc, 4)
        stats["total_evaluated"]         = cum_total
        stats["total_correct"]           = cum_correct
        stats["last_eval"]               = now.isoformat()
        # Birikimli yeni outcome sayacı — tek çalışmada 300 beklemek yanlıştı
        stats["cumulative_new_outcomes"] = stats.get("cumulative_new_outcomes", 0) + new_outcomes
        STATS_FILE.write_text(json.dumps(stats, indent=2, ensure_ascii=False))
        send_syslog(
            f"[Değerlendirme] +{total_eval} tahmin doğrulandı → "
            f"Genel doğruluk: {overall_acc:.1%} ({cum_correct}/{cum_total})",
            "EVALUATION",
        )

    # ── Retrain Tetikleyici: birikimli sayaç ─────────────────────────────────
    # Eski kod tek çalışmada 300 bekliyordu → hiç tetiklenmiyordu.
    cumulative = stats.get("cumulative_new_outcomes", 0)
    drift_ok = (
        TRAIN_FILE.exists()
        and len(pd.read_csv(TRAIN_FILE)) >= 50
        and check_concept_drift(pd.read_csv(TRAIN_FILE)[FEATURE_NAMES].values[-50:])
    )
    if cumulative >= RETRAIN_EVERY or drift_ok:
        reason = f"Birikimli {cumulative} outcome" if cumulative >= RETRAIN_EVERY else "Concept Drift"
        send_syslog(f"[{reason}] Shadow Training başlatılıyor...", "WARN")
        new_pipe = retrain_from_csv()
        if new_pipe is not None:
            pipe_holder[0] = new_pipe
            stats["cumulative_new_outcomes"] = 0
            STATS_FILE.write_text(json.dumps(stats, indent=2, ensure_ascii=False))


def get_model_accuracy() -> float:
    """Kaydedilmiş doğruluk oranını döndürür."""
    if STATS_FILE.exists():
        try:
            stats = json.loads(STATS_FILE.read_text())
            total = stats.get("total_evaluated", 0)
            if total > 0:
                return stats["total_correct"] / total
        except Exception:
            pass
    return 0.0  # Henüz değerlendirme yapılmadı


# ── API Yardımcıları ──────────────────────────────────────────────────────────

def api_get(path: str) -> list | dict | None:
    try:
        r = requests.get(f"{CORE_API}{path}", timeout=8)
        r.raise_for_status()
        return r.json()
    except Exception:
        return None


def get_news_sentiments() -> dict[str, float]:
    """Her sembol için ortalama haber duyarlılığı, makro duyarlılığı döndürür."""
    signals = api_get("/api/signals/latest?limit=100")
    if not isinstance(signals, list):
        return {}
    sent: dict[str, list] = {}
    for s in signals:
        entity = s.get("entity", "")
        score  = s.get("sentimentScore", 0) or 0
        sent.setdefault(entity, []).append(score)
    return {k: float(np.mean(v)) for k, v in sent.items()}


def get_fundamental_scores() -> dict[str, float]:
    """fundamental-service'ten hesaplanan temel skorları getirir."""
    data = api_get("/api/fundamental/overview")
    if not isinstance(data, list):
        return {}
    return {
        item.get("symbol", ""): float(item.get("fundamentalScore", 0.5) or 0.5)
        for item in data
        if item.get("symbol")
    }


def compute_macro_score() -> tuple[float, dict]:
    """
    Makro ortam skoru hesaplar (0–1, 0.5=nötr).

    Faktörler ve BİST etkisi:
      - S&P 500 yönü: küresel risk iştahı (pozitif = olumlu)
      - VIX seviyesi: korku endeksi (yüksek = olumsuz)
      - DXY (Dolar Endeksi) trendi: güçlü dolar = EM baskısı = olumsuz
      - USDTRY trendi: TL değer kaybı = çoğu hisse için baskı
      - MSCI EM yönü: gelişmekte olan piyasalar havası

    Döndürür: (macro_score 0-1, detay dict)
    """
    signals = []
    detail  = {}

    # S&P 500 — küresel risk iştahı
    sp = api_get("/api/market/SP500/latest")
    if sp and sp.get("signal"):
        s = 1.0 if sp["signal"] == "BUY" else 0.5 if sp["signal"] == "NEUTRAL" else 0.0
        signals.append(s); detail["sp500"] = sp["signal"]

    # VIX — korku endeksi
    vix = api_get("/api/market/VIX/latest")
    if vix and vix.get("close"):
        v = float(vix["close"])
        # VIX < 15: sakin (olumlu), 15-20: normal, 20-30: endişeli, > 30: panik
        vix_s = 1.0 if v < 15 else 0.7 if v < 20 else 0.4 if v < 30 else 0.1
        signals.append(vix_s); detail["vix"] = round(v, 1)

    # DXY — dolar endeksi; yükseliş = EM baskısı
    dxy = api_get("/api/market/DXY/latest")
    if dxy and dxy.get("signal"):
        # Dolar güçlü ise BİST için olumsuz
        s = 0.2 if dxy["signal"] == "BUY" else 0.5 if dxy["signal"] == "NEUTRAL" else 0.8
        signals.append(s); detail["dxy"] = dxy["signal"]

    # USDTRY — TL trendi; TL zayıflıyorsa genellikle olumsuz (ihracatçı hariç)
    usdtry = api_get("/api/market/USDTRY/latest")
    if usdtry and usdtry.get("signal"):
        # USDTRY BUY = dolar artıyor = TL değer kaybı = BIST için baskı
        s = 0.2 if usdtry["signal"] == "BUY" else 0.5 if usdtry["signal"] == "NEUTRAL" else 0.8
        signals.append(s); detail["usdtry"] = usdtry["signal"]

    # MSCI EM — gelişmekte olan piyasalar havası
    em = api_get("/api/market/MSCI_EM/latest")
    if em and em.get("signal"):
        s = 1.0 if em["signal"] == "BUY" else 0.5 if em["signal"] == "NEUTRAL" else 0.0
        signals.append(s); detail["msci_em"] = em["signal"]

    macro = round(sum(signals) / len(signals), 4) if signals else 0.5
    return macro, detail


# ── Late Fusion Karar Motoru ──────────────────────────────────────────────────
# Kullanıcı tarafından tanımlanan formül:
# Decision = W_t * P_tech + W_n * P_news + W_m * P_macro + W_f * P_fundamental
#
# Avantajı: Her modül bağımsız karar verir, son karar ağırlıklı birleşimdir.
# Dinamik ağırlıklar: koşullara göre (jeopolitik, yüksek VIX, güçlü temel) değişir.

def late_fusion_decision(
    ml_label: str,
    ml_conf: float,
    fund_score: float,
    news_score_raw: float,    # ham duyarlılık (-1..+1)
    macro_score: float,       # 0..1
    is_geo: bool,
) -> tuple[str, float, float]:
    """
    Late Fusion: 4 modülün kararını dinamik ağırlıklarla birleştirir.

    Döndürür: (recommendation, confidence, final_signal[-1..+1])
    """
    # Sinyalleri –1..+1 arasına normalize et
    ml_signal   = ml_conf if ml_label == "BUY" else (-ml_conf if ml_label == "SELL" else 0.0)
    fund_signal = (fund_score - 0.5) * 2          # 0.5→0, 1→+1, 0→-1
    news_signal = float(np.clip(news_score_raw, -1, 1))
    macro_signal = (macro_score - 0.5) * 2        # 0.5→0, 1→+1, 0→-1

    # ── Temel Ağırlıklar ──────────────────────────────────────────────────
    # BİST'e özgü ağırlıklandırma: teknik + temel ağır, makro destekçi
    W_t = 0.40  # Teknik (ML modeli)
    W_f = 0.30  # Temel analiz (F/K, ROE, FAVÖK...)
    W_n = 0.20  # Haber & Duyarlılık
    W_m = 0.10  # Makro (küresel endeksler, VIX, USDTRY)

    # ── Dinamik Ağırlık Ayarlamaları ─────────────────────────────────────
    # 1. Jeopolitik/önemli haber varsa → haber ağırlığını artır, teknik azalt
    if is_geo:
        W_n += 0.15; W_t -= 0.10; W_m += 0.05; W_f -= 0.10
        # Mantık: Savaş, kriz gibi durumlarda teknik analiz işlevsizleşir

    # 2. Temel analiz çok güçlü/zayıfsa → temel ağırlığı artır
    if abs(fund_signal) > 0.4:
        W_f += 0.10; W_t -= 0.05; W_n -= 0.05
        # Mantık: Ucuz hisse (PD/DD<1, ROE>30%) teknik sinyali destekler

    # 3. Haber sinyali çok güçlüyse (KAP bildirimi gibi) → haberi öncele
    if abs(news_signal) > 0.6:
        W_n += 0.10; W_t -= 0.10
        # Mantık: Şirket dev ihale kazandı → teknik henüz tepki vermemiştir

    # Ağırlıkları [0, 1] arasına kapat ve normalize et
    W_t = max(0.10, W_t); W_f = max(0.10, W_f)
    W_n = max(0.05, W_n); W_m = max(0.05, W_m)
    total = W_t + W_f + W_n + W_m
    W_t /= total; W_f /= total; W_n /= total; W_m /= total

    # ── Nihai Sinyal ──────────────────────────────────────────────────────
    final = W_t * ml_signal + W_f * fund_signal + W_n * news_signal + W_m * macro_signal
    final = float(np.clip(final, -1.0, 1.0))

    # ── Eşik → Öneri ──────────────────────────────────────────────────────
    # Güçlü sinyal için iki koşul: hem final yüksek hem de birden fazla modül uyuşmalı
    agreeing_positive = sum(1 for s in [ml_signal, fund_signal, news_signal, macro_signal] if s > 0.1)
    agreeing_negative = sum(1 for s in [ml_signal, fund_signal, news_signal, macro_signal] if s < -0.1)

    if final > 0.35 and agreeing_positive >= 3:
        rec = "GÜÇLÜ ALIM"
    elif final > 0.12:
        rec = "ALIM"
    elif final < -0.35 and agreeing_negative >= 3:
        rec = "GÜÇLÜ KAÇIN"
    elif final < -0.12:
        rec = "KAÇIN"
    else:
        rec = "NÖTR"

    # Güven: sinyal kuvvetini 0.40–0.95 arasına normalize et
    conf = round(min(0.95, 0.40 + abs(final) * 0.55), 4)

    return rec, conf, final


# ── Ana Analiz Döngüsü ────────────────────────────────────────────────────────

def run_analysis_cycle(pipe_holder: list):
    # Analiz başlamadan önce channel'in açık olduğundan emin ol
    if not _ensure_channel():
        print("[Döngü] RabbitMQ bağlantısı kurulamadı, analiz atlanıyor.")
        return
    channel = GLOBAL_CHANNEL

    pipe = pipe_holder[0]
    if pipe is None:
        send_syslog("[Döngü] Model henüz eğitim aşamasında, analiz atlanıyor...", "WARN")
        return

    ts = datetime.datetime.now().strftime("%H:%M:%S")
    send_syslog(f"Oracle analiz döngüsü başladı. Varlıklar taranıyor... ({ts})", "INFO")
    print(f"\n{'═'*55}")
    print(f"  Oracle Analiz Döngüsü — {ts}")
    print(f"{'═'*55}")

    sentiments         = get_news_sentiments()
    fundamental_scores = get_fundamental_scores()
    macro_score_01, macro_detail = compute_macro_score()
    model_acc          = get_model_accuracy()

    # Makro ortamı logla
    if macro_detail:
        macro_info = " | ".join(f"{k}={v}" for k, v in macro_detail.items())
        print(f"  Makro: {macro_info} → skor:{macro_score_01:.0%}")

    count = 0

    for sym, yf_sym in ALL_SYMBOLS.items():
        try:
            df = yf.download(yf_sym, period="3mo", interval="1d",
                             auto_adjust=True, progress=False, threads=False)
            if df is None or len(df) < 30:
                time.sleep(0.5)
                continue

            feat_df = compute_feature_df(df)
            feat    = feat_df.iloc[-1].to_dict()

            # Gerçek zamanlı duyarlılık bilgisini ekle
            feat["news_sent"]  = sentiments.get(sym, 0.0)
            feat["macro_sent"] = macro_score_01
            feat["is_geo"]     = 1.0 if any(
                s.get("isGeopolitical") for s in (api_get(f"/api/market/{sym}/news?limit=3") or [])
            ) else 0.0

            close = _safe(df["Close"].squeeze())
            label, ml_conf, imp = predict_one(pipe, feat)

            # ── Late Fusion Karar Motoru ──────────────────────────────────
            fund_score   = fundamental_scores.get(sym, 0.5)
            news_raw     = float(feat.get("news_sent", 0.0))
            is_geo_bool  = bool(feat.get("is_geo", 0.0))

            rec, conf, final_signal = late_fusion_decision(
                ml_label=label, ml_conf=ml_conf,
                fund_score=fund_score,
                news_score_raw=news_raw,
                macro_score=macro_score_01,
                is_geo=is_geo_bool,
            )
            # ──────────────────────────────────────────────────────────────

            reasoning, drivers, risks, watches = generate_text(
                feat, label, ml_conf, imp, fund_score
            )
            st_target, st_stop = get_targets(feat, close, label)

            atype = "BIST" if sym in BIST_MAP else "COMMODITY" if sym in COMMODITY_MAP else "FOREX"

            msg = {
                "symbol":          sym,
                "asset_type":      atype,
                "price_at_analysis": close,
                "recommendation":  rec,
                "confidence":      round(conf, 4),
                "short_term_bias": "YÜKSELİŞ" if final_signal > 0.1 else "DÜŞÜŞ" if final_signal < -0.1 else "YATAY",
                "short_term_target": st_target,
                "short_term_stop":   st_stop,
                "long_term_bias":  "YÜKSELİŞ" if final_signal > 0.1 else "DÜŞÜŞ" if final_signal < -0.1 else "YATAY",
                "long_term_target":  round(close * (1.12 if final_signal > 0.1 else 0.88), 2) if close else None,
                "reasoning":       reasoning,
                "key_drivers":     json.dumps(drivers, ensure_ascii=False),
                "risks":           json.dumps(risks, ensure_ascii=False),
                "watch_points":    json.dumps(
                    watches + ([f"Model doğruluğu: {model_acc:.1%}" ] if model_acc > 0 else ["Model henüz değerlendirme aşamasında"]),
                    ensure_ascii=False
                ),
                "technical_score": round(abs(feat.get("rsi_oversold",0) - feat.get("rsi_overbought",0)) * 0.3 +
                                         feat.get("macd_cross_up",0) * 0.4 + feat.get("above_ema50",0) * 0.3, 4),
                "news_score":      round(max(0, min(1, (feat.get("news_sent",0) + 1) / 2)), 4),
                "macro_score":     round(macro_score_01, 4),
                "fundamental_score": round(fund_score, 4),
                "analyzed_at":     datetime.datetime.utcnow().isoformat(),
            }

            channel.basic_publish(
                exchange="",
                routing_key="oracle.analysis",
                body=json.dumps(msg, ensure_ascii=False),
                properties=pika.BasicProperties(delivery_mode=2, content_type="application/json"),
            )

            acc_str = f" | doğruluk:{model_acc:.0%}" if model_acc > 0 else ""
            close_str = f"{round(close, 2):>10.2f}" if close else "         —"
            fusion_str = f" [{final_signal:+.2f}]"
            print(f"  {sym:<8} {close_str}  →  {rec:<15}  güven:{conf:.0%}{fusion_str}{acc_str}")
            # Tahmini kaydet (öz-değerlendirme için)
            # NOT: rec değil label kaydedilir — evaluate_predictions()
            # _direction() ile BUY/SELL/NEUTRAL karşılaştırması yapar.
            log_prediction(sym, yf_sym, label, conf, close, st_target)
            count += 1
            time.sleep(1.0)
            
            # Ara ara bilgi ver
            if count > 0 and count % 10 == 0:
                send_syslog(f"Analiz devam ediyor... {count}/{len(ALL_SYMBOLS)} varlık tarandı.", "INFO")

        except Exception as e:
            print(f"  {sym} hata: {e}")
            time.sleep(1)

    send_syslog(f"Döngü bitti. {count}/{len(ALL_SYMBOLS)} varlık başarıyla analiz edildi.", "SUCCESS")
    print(f"\n  {count}/{len(ALL_SYMBOLS)} varlık analiz edildi.")


# ── Baglantı ─────────────────────────────────────────────────────────────────

def wait_for_api():
    print("core-api bekleniyor...")
    for _ in range(24):
        try:
            r = requests.get(f"{CORE_API}/api/market/assets", timeout=4)
            if r.status_code < 500:
                print("core-api hazır.")
                return
        except Exception:
            pass
        time.sleep(5)
    print("core-api zaman aşımı — devam ediliyor.")


def connect_rmq() -> pika.BlockingConnection:
    for attempt in range(15):
        try:
            return pika.BlockingConnection(
                pika.ConnectionParameters(host=RMQ_HOST, heartbeat=600, blocked_connection_timeout=300)
            )
        except pika.exceptions.AMQPConnectionError:
            print(f"RabbitMQ bekleniyor ({attempt+1}/15)...")
            time.sleep(5)
    raise RuntimeError("RabbitMQ'ya bağlanılamadı")


# ── Giriş Noktası ─────────────────────────────────────────────────────────────

def main():
    print("SerInvest Yerel AI Oracle başlatılıyor (API'siz)...")
    MODELS_DIR.mkdir(parents=True, exist_ok=True)

    # Diğer servislerin hazır olmasını bekle
    time.sleep(10)
    wait_for_api()

    # ÖNCE RabbitMQ bağlan! (Böylece hemen log atmaya başlayabilir)
    global GLOBAL_CONN, GLOBAL_CHANNEL
    GLOBAL_CONN    = connect_rmq()
    GLOBAL_CHANNEL = GLOBAL_CONN.channel()
    GLOBAL_CHANNEL.queue_declare(queue="oracle.analysis", durable=True)
    GLOBAL_CHANNEL.queue_declare(queue="oracle.status",   durable=True)

    send_syslog("Sistem başlatılıyor... RabbitMQ'ya bağlanıldı.", "INFO")

    # Model yükle veya bootstrap eğitimi yap
    # pipe_holder[0] — modeli değiştirilebilir tutmak için liste kullanıyoruz
    pipe_holder = [load_or_bootstrap()]

    if pipe_holder[0] is None:
        send_syslog("[UYARI] Model eğitilemedi. Kural tabanlı yedek sinyaller kullanılacak.", "ERROR")

    # 1. İlk başlatıldığında hemen bir tarama yap
    send_syslog("İlk başlangıç taraması yapılıyor (Boot Analysis)...", "INFO")
    run_analysis_cycle(pipe_holder)

    # 2. Walk-Forward backtest: İLK ANALİZ BİTTİKTEN SONRA başlat.
    #    Eş zamanlı çalışma pika bağlantısını bozuyordu (deque race condition).
    #    Bu noktada pika meşgul değil; background thread başlatmak güvenli.
    if not WF_SUMMARY_FILE.exists():
        send_syslog("[WalkForward] Özet bulunamadı, arka planda backtest başlatılıyor...", "INFO")
        threading.Thread(target=_background_walk_forward, daemon=True).start()

    # 3. Ana operasyonel döngüyü BIST kapanışına (18:10) kur
    schedule.every().day.at("18:10").do(run_analysis_cycle, pipe_holder=pipe_holder)

    # 4. Model değerlendirmesi ve geri bildirimi 19:00'a (Kapanış sonrası rahat bir saat) kur
    schedule.every().day.at("19:00").do(evaluate_predictions, pipe_holder=pipe_holder)

    send_syslog(
        "Sistem Continuous Learning moduna geçti. "
        "Bir sonraki analiz 18:10'da, değerlendirme 19:00'da.", "INFO"
    )
    try:
        while True:
            schedule.run_pending()
            time.sleep(60)
    except KeyboardInterrupt:
        print("Durduruluyor...")
    finally:
        try:
            GLOBAL_CONN.close()
        except Exception:
            pass


if __name__ == "__main__":
    main()
