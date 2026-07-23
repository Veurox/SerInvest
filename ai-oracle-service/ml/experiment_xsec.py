"""
SerInvest ML v3 — Kesitsel (Cross-Sectional) Özellik Deneyi
============================================================
Soru: Model piyasa zamanlayıcı mı, hisse seçici mi?
(usdtry_ret5 %20 önem = piyasa-geneli sinyal baskın → kesitsel ayrım zayıf olabilir)

3 varyant, AYNI purged+embargo walk-forward ile karşılaştırılır:
  A) baseline : mevcut 21 mutlak özellik (mevcut şampiyon mantığı)
  B) rank     : her özellik GÜN-İÇİ kesitsel percentile'a çevrilir (0..1).
                Piyasa-geneli özellikler (usdtry, xu100-göreli baz) o gün tüm
                hisselerde aynı → rank ~sabit 0.5 → etkisiz hale gelir.
                Saf "hangi hisse diğerinden iyi" testi.
  C) hybrid   : mutlak 21 + kesitsel rank 21 (= 42 özellik). Model ikisinden
                de öğrenebilir.

Çalıştırma (container içinde):
  python -m ml.experiment_xsec
Çıktı:
  /app/models/ml_v3/validation_summary.json   (baseline — canlı panel bunu okur)
  /app/models/ml_v3/experiment_xsec.json      (3 varyant karşılaştırması)
"""
import json
import sys
import warnings

warnings.filterwarnings("ignore")
sys.path.insert(0, "/app")

import pandas as pd

from ml.config import FEATURE_NAMES, ML_DIR, TRAIN_CACHE
import ml.model as M
import ml.validation as V

SUMMARY_FILE    = ML_DIR / "validation_summary.json"
EXPERIMENT_FILE = ML_DIR / "experiment_xsec.json"


def xsec_rank(data: pd.DataFrame, cols: list[str], suffix: str = "") -> pd.DataFrame:
    """Her tarih grubunda her özelliği percentile rank'e (0..1) çevirir."""
    out = data.copy()
    ranked = out.groupby("date")[cols].rank(pct=True)
    for c in cols:
        out[c + suffix] = ranked[c].fillna(0.5)
    return out


def run_variant(name: str, data: pd.DataFrame, feat_names: list[str]) -> dict:
    """FEATURE_NAMES'i geçici değiştirip WF koşturur (model.py + validation.py)."""
    old_v, old_m = V.FEATURE_NAMES, M.FEATURE_NAMES
    V.FEATURE_NAMES = feat_names
    M.FEATURE_NAMES = feat_names
    try:
        print(f"\n{'='*60}\n[{name}] {len(feat_names)} özellik — WF başlıyor\n{'='*60}")
        res = V.purged_walk_forward(data, verbose=True)
    finally:
        V.FEATURE_NAMES, M.FEATURE_NAMES = old_v, old_m
    res["variant"] = name
    res["n_features"] = len(feat_names)
    return res


def brief(r: dict) -> dict:
    """Karşılaştırma tablosu için kısa özet."""
    return {k: r.get(k) for k in (
        "variant", "n_features", "n_oos", "auc", "buy_signals", "buy_coverage",
        "buy_precision", "base_rate", "lift", "mean_fold_lift",
        "expected_R_per_trade", "profitable",
    )}


def main():
    if not TRAIN_CACHE.exists():
        print(f"HATA: önbellek yok ({TRAIN_CACHE}). Önce dataset kurulmalı."); return
    data = pd.read_csv(TRAIN_CACHE, parse_dates=["date"])
    print(f"[exp] Önbellek: {len(data)} satır, {data['symbol'].nunique()} sembol, "
          f"{data['date'].min().date()} → {data['date'].max().date()}")

    results = []

    # A) BASELINE — canlı panelin okuduğu dosyaya da yaz (Görev B)
    res_a = run_variant("baseline", data, list(FEATURE_NAMES))
    SUMMARY_FILE.write_text(json.dumps(res_a, ensure_ascii=False, indent=2), encoding="utf-8")
    results.append(res_a)

    # B) PURE RANK — aynı isimler, değerler gün-içi percentile
    data_rank = xsec_rank(data, list(FEATURE_NAMES))
    results.append(run_variant("xsec_rank", data_rank, list(FEATURE_NAMES)))

    # C) HYBRID — mutlak + rank (_xr)
    data_hyb = xsec_rank(data, list(FEATURE_NAMES), suffix="_xr")
    hyb_names = list(FEATURE_NAMES) + [f + "_xr" for f in FEATURE_NAMES]
    results.append(run_variant("hybrid", data_hyb, hyb_names))

    # ── Karşılaştırma ──
    table = [brief(r) for r in results]
    EXPERIMENT_FILE.write_text(json.dumps(table, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"\n{'='*72}\nKESİTSEL DENEY SONUCU (AL precision / lift / AUC)\n{'='*72}")
    hdr = f"{'variant':<10} {'AUC':>6} {'AL':>5} {'kapsam':>7} {'prec':>7} {'taban':>7} {'lift':>7} {'foldLift':>8} {'expR':>7}"
    print(hdr); print("-" * len(hdr))
    for t in table:
        print(f"{t['variant']:<10} {t['auc'] or 0:>6.3f} {t['buy_signals']:>5} "
              f"{t['buy_coverage']*100:>6.1f}% {(t['buy_precision'] or 0)*100:>6.1f}% "
              f"{t['base_rate']*100:>6.1f}% {(t['lift'] or 0)*100:>+6.1f}p "
              f"{(t['mean_fold_lift'] or 0)*100:>+7.1f}p {t['expected_R_per_trade'] or 0:>+7.3f}")
    print(f"\nKayıt: {EXPERIMENT_FILE}")


if __name__ == "__main__":
    main()
