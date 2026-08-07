"""
SerInvest — Deney: Örtüşme düzeltilmiş ufuk taraması + ekonomik büyüklük
========================================================================
ml/experiment_horizon.py şunu buldu: `price_vs_52w_high` sinyali ufukla birlikte
güçleniyor (10g'de t=+6.8, 60g'de t=+14.3).

Bu rakamlar OLDUĞUNDAN GÜÇLÜ. Sebep: h günlük ileri getiride ardışık günlerin
pencereleri örtüşür — 60 günlük ufukta iki komşu günün penceresi %98 aynı veriyi
paylaşır. "697 gün" bağımsız gözlem değildir; kabaca 697/60 ≈ 12 bağımsız dönem
vardır. Aynı hata 07/2026'da PSI yanlış alarmını doğurmuştu (600 satır ama
8 bağımsız gün).

Bu deney iki düzeltme yapar:
  1. ÖRTÜŞMEYEN örnekleme — h günde bir gün alınır, gözlemler gerçekten bağımsız.
  2. EKONOMİK ÖLÇÜM — istatistiksel anlamlılık kâr demek değildir. En iyi %20 ile
     en kötü %20 arasındaki piyasa-göreli getiri farkı ölçülür ve işlem maliyeti
     düşülür. Yılda kaç kez döneceği de hesaba katılır.

Çalıştırma:  docker compose exec ai-oracle-service python -m ml.experiment_horizon2
Çıktı:       models/ml_v3/experiment_horizon2.json   (HİÇBİR canlı dosya değişmez)
"""
import datetime
import json
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, "/app")

from ml.config import FEATURE_NAMES, ML_DIR, TRANSACTION_COST_PCT
from ml.experiment_horizon import CACHE_FILE, HORIZONS, add_forward_returns

OUT_FILE = ML_DIR / "experiment_horizon2.json"
TRADING_DAYS = 252


def daily_t(vals) -> dict:
    v = np.asarray([x for x in vals if x is not None and x == x], dtype=float)
    if len(v) < 5:
        return {"n": int(len(v)), "mean": None, "t": None}
    se = v.std(ddof=1) / np.sqrt(len(v))
    t = float(v.mean() / se) if se > 0 else 0.0
    return {"n": int(len(v)), "mean": round(float(v.mean()), 5),
            "t": round(t, 2), "significant_bonf": bool(abs(t) >= 3.6)}


def non_overlapping_dates(p: pd.DataFrame, h: int) -> list:
    """Her h günde bir gün seç — pencereler örtüşmesin."""
    days = sorted(p["date"].unique())
    return days[::max(1, h)]


def measure(p: pd.DataFrame, feature: str, h: int, target: str = "fwd_rel") -> dict:
    """Örtüşmeyen günlerde: sıra korelasyonu + en iyi/en kötü %20 getiri farkı."""
    days = non_overlapping_dates(p, h)
    sub = p[p["date"].isin(days)]

    cors, spreads = [], []
    for _, g in sub.groupby("date"):
        if len(g) < 10:
            continue
        x, y = g[feature].values, g[target].values
        if np.std(x) == 0 or np.std(y) == 0:
            continue
        c = pd.Series(x).corr(pd.Series(y), method="spearman")
        if c == c:
            cors.append(c)
        k = max(1, len(g) // 5)
        gs = g.sort_values(feature, ascending=False)
        spreads.append(float(gs[target].head(k).mean() - gs[target].tail(k).mean()))

    corr = daily_t(cors)
    spr  = daily_t(spreads)

    # Ekonomi: uzun-bacak getirisi (long-only sistem kısa satmıyor)
    longs = []
    for _, g in sub.groupby("date"):
        if len(g) < 10:
            continue
        k = max(1, len(g) // 5)
        longs.append(float(g.nlargest(k, feature)[target].mean()))
    lng = daily_t(longs)

    periods_per_year = TRADING_DAYS / h
    gross = lng["mean"] if lng["mean"] is not None else None
    net   = (gross - TRANSACTION_COST_PCT) if gross is not None else None
    return {
        "feature": feature, "horizon": h,
        "n_independent_periods": corr["n"],
        "spearman": corr,
        "long_short_spread": spr,
        "long_only_excess": lng,
        "cost_per_trade": TRANSACTION_COST_PCT,
        "net_per_period": round(net, 5) if net is not None else None,
        "net_annualized": round(net * periods_per_year, 4) if net is not None else None,
        "periods_per_year": round(periods_per_year, 1),
    }


def main():
    if not CACHE_FILE.exists():
        print(f"[ufuk2] Önce ml.experiment_horizon çalıştırılmalı (panel önbelleği yok).")
        return
    panel = pd.read_csv(CACHE_FILE, parse_dates=["date"])
    print(f"[ufuk2] Panel: {len(panel):,} satır · {panel['symbol'].nunique()} sembol\n")

    # experiment_horizon'da en tutarlı çıkan iki aday
    candidates = ["price_vs_52w_high", "atr_pct"]
    candidates = [c for c in candidates if c in panel.columns]

    rows = []
    for h in HORIZONS:
        p = add_forward_returns(panel, h)
        for f in candidates:
            rows.append(measure(p, f, h))

    out = {"computed_at": datetime.datetime.utcnow().isoformat(),
           "note": "örtüşmeyen örnekleme; t eşiği Bonferroni ile 3.6",
           "results": rows}
    OUT_FILE.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")

    print("=" * 100)
    print("ÖRTÜŞMEYEN ÖLÇÜM — piyasa-göreli getiri (gün etkisi çıkarılmış)")
    print("=" * 100)
    print(f"  {'özellik':20} {'ufuk':>5} {'bağımsız':>9} {'spearman':>9} {'t':>6}   "
          f"{'uzun %20 fazla':>14} {'t':>6}  {'net/yıl':>9}")
    for r in rows:
        s, l = r["spearman"], r["long_only_excess"]
        fm = lambda d, k='mean', p=4: (f"{d[k]:+.{p}f}" if d.get(k) is not None else "—")
        ann = f"{r['net_annualized']:+.1%}" if r["net_annualized"] is not None else "—"
        star = " ✓" if s.get("significant_bonf") else ""
        print(f"  {r['feature']:20} {r['horizon']:>4}g {r['n_independent_periods']:>9} "
              f"{fm(s):>9} {fm(s,'t',2):>6}   {fm(l):>14} {fm(l,'t',2):>6}  {ann:>9}{star}")

    print("\n  ✓ = Bonferroni sonrası anlamlı (|t| ≥ 3.6)")
    print(f"  net/yıl = (uzun %20 fazla getirisi − %{TRANSACTION_COST_PCT*100:.1f} maliyet) × yıllık dönüş")
    print(f"\n[deney] Kaydedildi → {OUT_FILE}")


if __name__ == "__main__":
    main()
