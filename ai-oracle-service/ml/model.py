"""
SerInvest ML v3 — Tek LightGBM Model
=====================================
TEK model, SABİT hiperparametre + SABİT seed. Hiçbir auto-tuning, kalibrasyon,
meta-learner yok — rastgelelik tutarsızlık kaynağıdır, o yüzden her şey deterministik.

Çıktı: P(yukarı) → BUY_THRESHOLD ile AL/NÖTR kararı.
"""
import numpy as np
import pandas as pd
from lightgbm import LGBMClassifier

from ml.config import BUY_THRESHOLD, FEATURE_NAMES, LGBM_PARAMS, MIN_TRAIN_ROWS


def make_model() -> LGBMClassifier:
    """Sabit konfigürasyonlu yeni LightGBM örneği."""
    return LGBMClassifier(**LGBM_PARAMS)


def train_model(X: pd.DataFrame, y, enforce_min: bool = True) -> LGBMClassifier | None:
    """
    Modeli eğitir. enforce_min=True iken MIN_TRAIN_ROWS altında None döner
    (yetersiz veriyle eğitim = güvenilmez model).
    """
    n = len(X)
    if enforce_min and n < MIN_TRAIN_ROWS:
        print(f"[ml.model] Yetersiz veri ({n} < {MIN_TRAIN_ROWS}) — eğitim atlandı.")
        return None
    y = np.asarray(y).astype(int)
    # Tek sınıf varsa eğitilemez
    if len(np.unique(y)) < 2:
        print("[ml.model] Tek sınıflı etiket — eğitim atlandı.")
        return None
    model = make_model()
    model.fit(X[FEATURE_NAMES], y)
    return model


def predict_proba_up(model: LGBMClassifier, feat_row):
    """
    P(yukarı=1) döndürür. Girdi:
      • dict          → tek satır, float döner
      • pd.Series     → tek satır (feat.iloc[-1]), float döner
      • pd.DataFrame  → çok satır, np.ndarray döner
    """
    if isinstance(feat_row, dict):
        X = pd.DataFrame([[feat_row.get(f, 0.0) for f in FEATURE_NAMES]], columns=FEATURE_NAMES)
    elif isinstance(feat_row, pd.Series):
        X = feat_row.reindex(FEATURE_NAMES).to_frame().T
    else:
        X = feat_row[FEATURE_NAMES]
    proba = model.predict_proba(X)[:, 1]
    return float(proba[0]) if len(proba) == 1 else proba


def decide(p_up: float) -> str:
    """P(yukarı) → karar. Eşiğin altı NÖTR (az ama isabetli)."""
    return "AL" if p_up >= BUY_THRESHOLD else "NÖTR"


def feature_importance(model: LGBMClassifier) -> list:
    """[(feature, importance_pct)] azalan sırada — şeffaflık paneli için."""
    imp = model.feature_importances_
    total = float(imp.sum()) or 1.0
    pairs = sorted(zip(FEATURE_NAMES, imp), key=lambda x: -x[1])
    return [(n, round(100 * v / total, 2)) for n, v in pairs]
