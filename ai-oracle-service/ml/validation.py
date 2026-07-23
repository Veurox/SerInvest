"""
SerInvest ML v3 — Dürüst Purged + Embargo Walk-Forward
=======================================================
Eski sistemdeki "backtest %59 ama canlı %47" uçurumunun sebebi: çakışan etiketler
ve sızıntı backtest'i şişiriyordu. Burada o KÖKTEN engellenir:

  • Zaman-sıralı walk-forward (gelecekten geçmişe sızıntı yok).
  • PURGE: eğitim ile test arasında ≥ HORIZON boşluk → eğitim etiketleri (10 gün
    ileri bakar) test dönemine UZANAMAZ.
  • EMBARGO: ek tampon.
  • Tüm out-of-sample (OOS) tahminler havuzlanıp TEK dürüst metrik üretir.

Ana metrik "kazandıran hisse" hedefine göre: AL sinyallerinin PRECISION'ı
(AL dediğinde gerçekten kazanma oranı) + asimetrik R:R ile beklenen getiri.
"""
import datetime

import numpy as np
import pandas as pd

from ml.config import (
    BUY_THRESHOLD,
    FEATURE_NAMES,
    HORIZON,
    MIN_TRAIN_ROWS,
    SL_ATR_MULT,
    TP_ATR_MULT,
    TRANSACTION_COST_PCT,
    WF_EMBARGO_DAYS,
    WF_INITIAL_TRAIN_DAYS,
    WF_STEP_DAYS,
)
from ml.model import train_model


def _gap_days() -> int:
    """Train↔test takvim-günü boşluğu: HORIZON(işlem) + embargo, hafta sonu payıyla."""
    return int(round(HORIZON * 1.6)) + WF_EMBARGO_DAYS


def _breakeven_precision(cost_pct: float = TRANSACTION_COST_PCT) -> float:
    """
    Asimetrik R:R'de AL sinyalinin kâra geçtiği precision eşiği.
    Kazanç ≈ TP_MULT birim, kayıp ≈ SL_MULT birim, + işlem maliyeti.
    p·TP − (1−p)·SL − maliyet = 0  →  p = (SL + maliyet) / (TP + SL)
    """
    # maliyeti ATR birimine çevir: tipik ATR ~%2 → maliyet ~0.1 ATR birimi
    cost_units = cost_pct / 0.02
    return (SL_ATR_MULT + cost_units) / (TP_ATR_MULT + SL_ATR_MULT)


def _expected_R(precision: float, cost_pct: float = TRANSACTION_COST_PCT) -> float:
    """Verilen precision'da AL sinyali başına beklenen R (ATR birimi, maliyet düşülmüş)."""
    cost_units = cost_pct / 0.02
    return precision * TP_ATR_MULT - (1 - precision) * SL_ATR_MULT - cost_units


def purged_walk_forward(data: pd.DataFrame, verbose: bool = True,
                        fit_calibration: bool = True) -> dict:
    """
    data: build_dataset() çıktısı (date, symbol, 21 feature, label∈{0,1}).
    Döndürür: pooled OOS metrikleri + adım listesi (öğrenme eğrisi/stabilite için).

    fit_calibration=True (Faz 2): pooled OOS (ham p, etiket) çiftleriyle isotonic
    kalibratör fit edilip diske kaydedilir — canlı EV/Kelly katmanı bunu kullanır.
    WF, kalibratör için TEK dürüst veri kaynağıdır (eğitim-içi p ile fit = sızıntı).
    """
    data = data.sort_values("date").reset_index(drop=True)
    dates = pd.to_datetime(data["date"])
    min_d, max_d = dates.min(), dates.max()

    gap  = datetime.timedelta(days=_gap_days())
    step = datetime.timedelta(days=WF_STEP_DAYS)
    train_cutoff = min_d + datetime.timedelta(days=WF_INITIAL_TRAIN_DAYS)

    oos_p   = []   # tüm OOS P(yukarı)
    oos_y   = []   # tüm OOS gerçek etiket
    steps   = []
    fold    = 0

    while train_cutoff + gap < max_d:
        test_start = train_cutoff + gap
        test_end   = test_start + step

        tr_mask = dates <= train_cutoff
        te_mask = (dates > test_start) & (dates <= test_end)
        train, test = data[tr_mask], data[te_mask]

        if len(train) >= MIN_TRAIN_ROWS and len(test) >= 20:
            fold += 1
            model = train_model(train[FEATURE_NAMES], train["label"], enforce_min=True)
            if model is not None:
                p = model.predict_proba(test[FEATURE_NAMES])[:, 1]
                y = test["label"].astype(int).values
                oos_p.append(p); oos_y.append(y)

                # adım metriği
                pred_dir = (p >= 0.5).astype(int)
                acc = float((pred_dir == y).mean())
                buy = p >= BUY_THRESHOLD
                buy_prec = float(y[buy].mean()) if buy.sum() > 0 else None
                fold_base = float(y.mean())   # bu penceredeki UP taban oranı (baseline)
                steps.append({
                    "fold": fold,
                    "train_end": train_cutoff.date().isoformat(),
                    "test": f"{test_start.date()}→{test_end.date()}",
                    "n_train": int(len(train)), "n_test": int(len(test)),
                    "acc": round(acc, 4),
                    "base_rate": round(fold_base, 4),
                    "buy_signals": int(buy.sum()),
                    "buy_precision": round(buy_prec, 4) if buy_prec is not None else None,
                    "lift": round(buy_prec - fold_base, 4) if buy_prec is not None else None,
                })
                if verbose:
                    bp = f"{buy_prec:.1%}" if buy_prec is not None else "—"
                    print(f"[WF] Adım {fold:>2} | eğitim {len(train):>6} test {len(test):>4} "
                          f"| acc {acc:.1%} | AL {int(buy.sum()):>3} (prec {bp})")
        train_cutoff += step

    if not oos_p:
        return {"error": "Yeterli adım üretilemedi"}

    P = np.concatenate(oos_p)
    Y = np.concatenate(oos_y)

    # ── Faz 2: Isotonic kalibratör (pooled OOS = tek dürüst kaynak) ──────────
    if fit_calibration:
        try:
            from ml.calibration import fit_calibrator, save_calibrator
            cal = fit_calibrator(P, Y)
            if cal is not None:
                save_calibrator(cal, P, Y)
        except Exception as e:
            print(f"[WF] Kalibratör fit edilemedi (kimlik fallback sürer): {e}")

    # ── Pooled OOS metrikleri ──
    pred_dir = (P >= 0.5).astype(int)
    overall_acc = float((pred_dir == Y).mean())

    buy = P >= BUY_THRESHOLD
    n_buy = int(buy.sum())
    buy_precision = float(Y[buy].mean()) if n_buy > 0 else None
    coverage = n_buy / len(P)

    # ── TABAN ÇİZGİSİ (baseline): model olmadan ne olurdu? ──
    # base_rate = tüm adayların TP'ye-önce-değme oranı ("hepsini al" precision'ı).
    # lift = modelin bunun üzerine kattığı puan → GERÇEK beceri ölçüsü.
    base_rate = float(Y.mean())
    lift = round(buy_precision - base_rate, 4) if buy_precision is not None else None
    # Rejim karışmasına karşı fold-bazlı ortalama lift (pooled'dan daha dürüst)
    fold_lifts = [s["lift"] for s in steps if s.get("lift") is not None]
    mean_fold_lift = round(float(np.mean(fold_lifts)), 4) if fold_lifts else None

    # ── AYRIM GÜCÜ (AUC): olasılıklar UP'ları DOWN'lardan ayırıyor mu? ──
    auc = None
    try:
        from sklearn.metrics import roc_auc_score
        if len(np.unique(Y)) == 2:
            auc = round(float(roc_auc_score(Y, P)), 4)
    except Exception:
        pass

    be = _breakeven_precision()
    exp_R = round(_expected_R(buy_precision), 4) if buy_precision is not None else None
    # Baseline beklenen R: "hepsini al" stratejisi (model katkısının karşılaştırması)
    exp_R_baseline = round(_expected_R(base_rate), 4)

    # ── MALİYET DUYARLILIĞI: gerçek spread/kayma varsayımdan kötüyse ne olur? ──
    cost_sensitivity = []
    for c in (0.002, 0.003, 0.004):
        be_c = _breakeven_precision(c)
        cost_sensitivity.append({
            "cost_pct":            c,
            "breakeven_precision": round(be_c, 4),
            "expected_R":          round(_expected_R(buy_precision, c), 4) if buy_precision is not None else None,
            "profitable":          (buy_precision is not None and buy_precision > be_c),
        })

    return {
        "computed_at":        datetime.datetime.utcnow().isoformat(),
        "n_folds":            fold,
        "n_oos":              int(len(P)),
        "overall_accuracy":   round(overall_acc, 4),
        "auc":                auc,
        "buy_signals":        n_buy,
        "buy_coverage":       round(coverage, 4),
        "buy_precision":      round(buy_precision, 4) if buy_precision is not None else None,
        "base_rate":          round(base_rate, 4),
        "lift":               lift,
        "mean_fold_lift":     mean_fold_lift,
        "breakeven_precision": round(be, 4),
        "expected_R_per_trade": exp_R,
        "expected_R_baseline":  exp_R_baseline,
        "cost_sensitivity":   cost_sensitivity,
        "profitable":         (buy_precision is not None and buy_precision > be),
        "horizon":            HORIZON,
        "buy_threshold":      BUY_THRESHOLD,
        "steps":              steps,
    }
