"""
SerInvest ML v4 — Meta-Labeling Katmanı (Faz 3)
================================================
Birincil model (saf teknik LGBM) "ne zaman AL" der; bu katman "bu AL'e ne kadar
güven" der. Gerekçe (docs/ARCHITECTURE_ROADMAP.md — Kalibrasyon Bulgusu):
birincil modelin ham p'si 0.35 üstünde DÜZ (~%53) — üst-uç ayrım gücü yok.
O ayrımı haber/rejim özellikleri sağlayacak (López de Prado, meta-labeling).

Yaşam döngüsü — "şimdi topla, olgunlaşınca eğit":
  1. Her AL sinyalinde meta-özellikler META_LOG_FILE'a yazılır (karar ANINDAKİ
     bilgi — as-of disiplini; sonradan hesaplamak sızıntı olurdu).
  2. Günlük değerlendirme (evaluate_ml) sonrası train_meta() denenir:
     META_LOG × PREDICTION_LOG join → (özellik, sonuç) çiftleri.
  3. ≥ MIN_META_SAMPLES değerlendirilmiş örnek VE zaman-sıralı test AUC ≥
     META_MIN_AUC ise model kaydedilir; aksi halde canlıda pass-through sürer.
  4. Canlıda: p_meta < META_VETO_P → AL veto; değilse boyut çarpanı
     p_meta/META_SIZE_ANCHOR (0.6–1.2 kelepçeli).

Haber yokluğu = sıfır özellik (nötr), asla hata: haber API'si düşükse birincil
sistem etkilenmeden çalışır (fail-open).
"""
import csv
import datetime

import joblib
import numpy as np

import ml.atomic as atomic
from ml.config import (
    META_INFO_FILE,
    META_LOG_FILE,
    META_MIN_AUC,
    META_MODEL_FILE,
    META_SIZE_ANCHOR,
    META_VETO_P,
    MIN_META_SAMPLES,
    ML_DIR,
    PREDICTION_LOG,
)

# Özellik sırası SABİT — eğitim ve canlı aynı vektörü kullanır (train/serve tutarlılığı)
META_FEATURES = [
    "p_up",            # birincil ham olasılık (0.35+ düz ama alt-üst bilgisi var)
    "atr_pct",         # volatilite bağlamı
    "news_score",      # sembol: decay-ağırlıklı sentiment (48s)
    "news_nov_score",  # sembol: yenilik×decay ağırlıklı sentiment (tekrar şişirmez)
    "news_count",      # sembol: haber sayısı
    "mean_novelty",    # sembol: ortalama yenilik (düşük = hep aynı haber dönüyor)
    "pos_events",      # sembol: pozitif yönlü olay sayısı (TEMETTU/GERI_ALIM/SOZLESME/YATIRIM)
    "neg_events",      # sembol: negatif yönlü olay sayısı (CEZA_SORUSTURMA/JEOPOLITIK)
    "geo_count",       # sembol: jeopolitik işaretli haber sayısı
    "mkt_score",       # piyasa: BIST100+GLOBAL decay sentiment ortalaması
    "mkt_geo",         # piyasa: GLOBAL/FED/BIST100 jeopolitik haber toplamı
    "risk_off",        # rejim kapısı: 1 = XU100 < EMA200
]

_LOG_FIELDS = ["timestamp", "symbol"] + META_FEATURES

# Piyasa-düzeyi varlık adları (analyst-engine entity tespitiyle hizalı)
_MARKET_ENTITIES = ("BIST100", "GLOBAL")
_GEO_ENTITIES    = ("BIST100", "GLOBAL", "FED")


# ═════════════════════════════════════════════════════════════════════════════
#  ÖZELLİK ÜRETİMİ (canlı — karar anında)
# ═════════════════════════════════════════════════════════════════════════════

def fetch_news_map(api_get) -> dict:
    """
    core-api /api/signals/aggregate → {entity: {...}} sözlüğü.
    api_get: infra.api_get (bağımlılık enjeksiyonu — ml/ paketi infra'ya bağlanmasın).
    Hata/boşlukta {} döner (fail-open).
    """
    rows = api_get("/api/signals/aggregate?hours=48") or []
    out = {}
    for r in rows:
        try:
            out[str(r.get("entity", "")).upper()] = r
        except Exception:
            continue
    return out


def build_features(sym: str, p_up: float, atr_pct: float,
                   news_map: dict, regime: dict | None) -> dict:
    """Bir AL sinyali için meta-özellik vektörü (dict, META_FEATURES anahtarlı)."""
    s = news_map.get(sym.upper(), {})
    mkt_scores = [float(news_map[e].get("score") or 0.0)
                  for e in _MARKET_ENTITIES if e in news_map]
    mkt_geo = sum(int(news_map[e].get("geoCount") or 0)
                  for e in _GEO_ENTITIES if e in news_map)
    return {
        "p_up":           round(float(p_up), 4),
        "atr_pct":        round(float(atr_pct or 0.0), 5),
        "news_score":     round(float(s.get("score") or 0.0), 4),
        "news_nov_score": round(float(s.get("noveltyScore") or 0.0), 4),
        "news_count":     int(s.get("count") or 0),
        "mean_novelty":   round(float(s.get("meanNovelty") or 1.0), 4),
        "pos_events":     int(s.get("positiveEvents") or 0),
        "neg_events":     int(s.get("negativeEvents") or 0),
        "geo_count":      int(s.get("geoCount") or 0),
        "mkt_score":      round(float(np.mean(mkt_scores)) if mkt_scores else 0.0, 4),
        "mkt_geo":        int(mkt_geo),
        "risk_off":       1 if (regime or {}).get("regime") == "RISK_OFF" else 0,
    }


def log_meta_row(sym: str, feats: dict) -> None:
    """
    Meta-özellikleri loglar. PREDICTION_LOG ile aynı disiplin: aynı (sembol, gün)
    için son satır geçerli (üzerine yazılır) → eğitim join'i 1:1 kalır.
    """
    today = datetime.datetime.utcnow().date().isoformat()
    new_row = {"timestamp": datetime.datetime.utcnow().isoformat(), "symbol": sym}
    new_row.update({k: feats.get(k, 0) for k in META_FEATURES})

    rows, found = [], False
    if META_LOG_FILE.exists():
        with open(META_LOG_FILE, "r", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                if r.get("symbol") == sym and r.get("timestamp", "")[:10] == today:
                    rows.append(new_row); found = True
                else:
                    rows.append(r)
    if not found:
        rows.append(new_row)
    ML_DIR.mkdir(parents=True, exist_ok=True)
    atomic.write_csv(META_LOG_FILE, _LOG_FIELDS, rows)   # yarım yazım = bozuk log


# ═════════════════════════════════════════════════════════════════════════════
#  MODEL YAŞAM DÖNGÜSÜ
# ═════════════════════════════════════════════════════════════════════════════

def load_meta():
    """meta_model.joblib varsa yükler (sklearn Pipeline); yoksa None (pass-through)."""
    if META_MODEL_FILE.exists():
        try:
            return joblib.load(META_MODEL_FILE)
        except Exception as e:
            print(f"[meta] model yüklenemedi: {e}")
    return None


def p_meta(model, feats: dict) -> float:
    """P(birincil AL haklı). Model yoksa/nötrse 0.55 (etkisiz)."""
    if model is None:
        return META_SIZE_ANCHOR
    try:
        X = np.array([[float(feats.get(k, 0) or 0) for k in META_FEATURES]])
        return float(model.predict_proba(X)[0][1])
    except Exception as e:
        print(f"[meta] tahmin hatası (pass-through): {e}")
        return META_SIZE_ANCHOR


def size_multiplier(pm: float) -> float:
    """Meta güvene göre boyut çarpanı — [0.6, 1.2] kelepçeli."""
    return round(min(1.2, max(0.6, pm / META_SIZE_ANCHOR)), 3)


def _load_joined() -> tuple[np.ndarray, np.ndarray, int]:
    """
    META_LOG × PREDICTION_LOG join → (X, y, n).
    y = 1 birincil haklı (eval UP), 0 haksız (DOWN). NEUTRAL/boş atlanır.
    Join anahtarı: (symbol, gün) — iki log da gün başına tek satır tutar.
    """
    if not META_LOG_FILE.exists() or not PREDICTION_LOG.exists():
        return np.empty((0, len(META_FEATURES))), np.empty(0), 0

    outcomes = {}
    with open(PREDICTION_LOG, "r", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            ev = (r.get("eval") or "").split("|")[0].strip()
            if ev in ("UP", "DOWN") and r.get("rec_dir") == "BUY":
                outcomes[(r["symbol"], r.get("timestamp", "")[:10])] = 1 if ev == "UP" else 0

    X, y = [], []
    with open(META_LOG_FILE, "r", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            key = (r.get("symbol"), r.get("timestamp", "")[:10])
            if key not in outcomes:
                continue
            try:
                X.append([float(r.get(k, 0) or 0) for k in META_FEATURES])
                y.append(outcomes[key])
            except Exception:
                continue
    X = np.array(X); y = np.array(y)
    return X, y, len(y)


def train_meta() -> dict:
    """
    Meta-modeli eğitmeyi dener. Kapılar:
      • n ≥ MIN_META_SAMPLES (değerlendirilmiş AL örneği)
      • zaman-sıralı %80/20 bölmede test AUC ≥ META_MIN_AUC
    Geçemezse model kaydedilmez (canlıda pass-through sürer) — kanıtsız katman yok.
    """
    result = {"checked_at": datetime.datetime.utcnow().isoformat(), "deployed": False}
    X, y, n = _load_joined()
    result["n_evaluated"] = n
    if n < MIN_META_SAMPLES:
        result["reason"] = f"yetersiz örnek ({n}/{MIN_META_SAMPLES}) — birikmeye devam"
        print(f"[meta] {result['reason']}")
        return result
    if len(np.unique(y)) < 2:
        result["reason"] = "tek sınıflı sonuç kümesi"
        return result

    from sklearn.linear_model import LogisticRegression
    from sklearn.metrics import roc_auc_score
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler

    # Zaman-sıralı bölme (loglar kronolojik yazılır — satır sırası ≈ zaman sırası)
    cut = int(n * 0.8)
    X_tr, X_te, y_tr, y_te = X[:cut], X[cut:], y[:cut], y[cut:]
    if len(np.unique(y_te)) < 2 or len(np.unique(y_tr)) < 2:
        result["reason"] = "bölme tek sınıflı"
        return result

    model = make_pipeline(
        StandardScaler(),
        LogisticRegression(max_iter=1000, C=1.0, random_state=42),
    )
    model.fit(X_tr, y_tr)
    auc = float(roc_auc_score(y_te, model.predict_proba(X_te)[:, 1]))
    result["test_auc"] = round(auc, 4)
    result["n_test"] = int(len(y_te))

    if auc < META_MIN_AUC:
        result["reason"] = f"test AUC {auc:.3f} < {META_MIN_AUC} — canlıya alınmadı"
        print(f"[meta] {result['reason']}")
        atomic.write_json(META_INFO_FILE, result)
        return result

    # Kapıları geçti → TÜM veriyle yeniden fit + kaydet
    model.fit(X, y)
    joblib.dump(model, META_MODEL_FILE)
    result["deployed"] = True
    # Şeffaflık: standartlaştırılmış katsayılar (hangi özellik ne yönde etkili)
    try:
        lr = model.named_steps["logisticregression"]
        coefs = sorted(zip(META_FEATURES, [round(float(c), 4) for c in lr.coef_[0]]),
                       key=lambda t: -abs(t[1]))
        result["coefficients"] = [{"feature": f, "coef": c} for f, c in coefs]
    except Exception:
        pass
    atomic.write_json(META_INFO_FILE, result)
    print(f"[meta] ✅ Meta-model CANLIDA — test AUC {auc:.3f} (n={n})")
    return result
