"""
SerInvest ML v3/v4 — Olasılık Kalibrasyonu + EV + Kelly (Faz 2)
================================================================
LGBM finansal gürültüde olasılığı 0.5'e sıkıştırır → ham p "gerçek olasılık"
değildir. Isotonic regression, walk-forward OOS tahminlerine (tek dürüst kaynak)
fit edilir ve ham p → kalibre p dönüşümü sağlar.

Tasarım kararları (docs/ARCHITECTURE_ROADMAP.md §4):
  • KARAR eşiği HAM p üzerinde kalır (BUY_THRESHOLD) — champion'ın doğrulanmış
    davranışı değişmez. Kalibre p yalnızca: EV filtresi, Kelly boyut, gösterilen güven.
  • Isotonic deterministiktir (aynı OOS → aynı eğri) — "sade/deterministik" ilkesiyle uyumlu.
  • Kalibratör yoksa her şey kimlik (identity) fallback ile eskisi gibi çalışır.
"""
import datetime
import json

import joblib
import numpy as np

from ml.config import (
    CALIBRATOR_FILE,
    CALIBRATOR_META_FILE,
    KELLY_FRACTION,
    MIN_POSITION_PCT,
    ML_DIR,
    SL_ATR_MULT,
    TP_ATR_MULT,
    TRANSACTION_COST_PCT,
)

# Kalibratör fit için asgari OOS örneği — altında güvenilmez, fit edilmez.
MIN_CALIB_SAMPLES = 1000


# ── EV matematiği (validation.py ile AYNI formüller — ATR birimi) ────────────

def expected_R(p: float, cost_pct: float = TRANSACTION_COST_PCT) -> float:
    """İşlem başına beklenen R (ATR birimi): p·TP − (1−p)·SL − maliyet."""
    cost_units = cost_pct / 0.02   # tipik ATR ~%2 → maliyet ATR birimine
    return p * TP_ATR_MULT - (1 - p) * SL_ATR_MULT - cost_units


def breakeven_p(cost_pct: float = TRANSACTION_COST_PCT) -> float:
    """EV=0 olan olasılık: (SL + maliyet) / (TP + SL)."""
    cost_units = cost_pct / 0.02
    return (SL_ATR_MULT + cost_units) / (TP_ATR_MULT + SL_ATR_MULT)


# ── Kelly boyutlandırma ──────────────────────────────────────────────────────

def kelly_size(p_cal: float, max_pct: float) -> float:
    """
    Kesirli Kelly ile pozisyon boyutu (equity oranı).
    Asimetrik kazanç b = TP/SL için tam Kelly: f* = p − (1−p)/b.
    KELLY_FRACTION ile kesilir, max_pct ile tavanlanır, MIN_POSITION_PCT altı 0.
    """
    b = TP_ATR_MULT / SL_ATR_MULT
    f_star = p_cal - (1.0 - p_cal) / b
    size = KELLY_FRACTION * max(0.0, f_star)
    size = min(max_pct, size)
    return round(size, 4) if size >= MIN_POSITION_PCT else 0.0


# ── Isotonic kalibratör yaşam döngüsü ────────────────────────────────────────

def fit_calibrator(oos_p: np.ndarray, oos_y: np.ndarray):
    """
    Walk-forward OOS (ham p, gerçek etiket) çiftlerine isotonic fit.
    Yetersiz örnek varsa None döner (kimlik fallback devrede kalır).
    """
    oos_p = np.asarray(oos_p, dtype=float)
    oos_y = np.asarray(oos_y, dtype=int)
    if len(oos_p) < MIN_CALIB_SAMPLES or len(np.unique(oos_y)) < 2:
        print(f"[calib] Yetersiz OOS ({len(oos_p)} < {MIN_CALIB_SAMPLES}) — fit atlandı.")
        return None
    from sklearn.isotonic import IsotonicRegression
    cal = IsotonicRegression(y_min=0.01, y_max=0.99, out_of_bounds="clip")
    cal.fit(oos_p, oos_y)
    return cal


def _reliability_table(cal, oos_p: np.ndarray, oos_y: np.ndarray, n_bins: int = 8) -> list:
    """Şeffaflık: ham-p bin'lerinde (gözlenen UP oranı, kalibre p) tablosu."""
    rows = []
    edges = np.quantile(oos_p, np.linspace(0, 1, n_bins + 1))
    for i in range(n_bins):
        lo, hi = float(edges[i]), float(edges[i + 1])
        mask = (oos_p >= lo) & (oos_p <= hi if i == n_bins - 1 else oos_p < hi)
        if mask.sum() == 0:
            continue
        mid = float(np.median(oos_p[mask]))
        rows.append({
            "raw_p_range": [round(lo, 4), round(hi, 4)],
            "n": int(mask.sum()),
            "observed_up": round(float(oos_y[mask].mean()), 4),
            "calibrated_p": round(float(cal.predict([mid])[0]), 4),
        })
    return rows


def save_calibrator(cal, oos_p: np.ndarray, oos_y: np.ndarray) -> None:
    """Kalibratörü + şeffaflık metasını diske yazar."""
    ML_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump(cal, CALIBRATOR_FILE)
    meta = {
        "fitted_at": datetime.datetime.utcnow().isoformat(),
        "n_oos": int(len(oos_p)),
        "method": "isotonic",
        "breakeven_p": round(breakeven_p(), 4),
        "reliability": _reliability_table(cal, np.asarray(oos_p, float), np.asarray(oos_y, int)),
    }
    CALIBRATOR_META_FILE.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[calib] Kalibratör kaydedildi ({len(oos_p):,} OOS örneği).")


def load_calibrator():
    """calibrator.joblib varsa yükler; yoksa None (kimlik fallback)."""
    if CALIBRATOR_FILE.exists():
        try:
            return joblib.load(CALIBRATOR_FILE)
        except Exception as e:
            print(f"[calib] Kalibratör yüklenemedi: {e}")
    return None


def calibrate(p_raw: float, cal) -> float:
    """Ham p → kalibre p. Kalibratör yoksa kimlik."""
    if cal is None:
        return float(p_raw)
    try:
        return float(cal.predict([float(p_raw)])[0])
    except Exception:
        return float(p_raw)
