"""
SerInvest — Deney: Hangi ufukta sinyal var? (çevrimdışı, canlıya dokunmaz)
==========================================================================
Buraya nasıl gelindi (08/2026):

  • Şampiyon gün içinde hisse sıralayamıyor: Spearman = -0.007, t = -0.78
    (485 OOS günü, ml/experiment_ranking.py)
  • Sorun model mimarisi DEĞİL. Beş varyant denendi — gün-ağırlıklı binary,
    LambdaRank, lojistik regresyon, küçük LGBM, elle seçilmiş 3 özellik —
    hepsi sıfır verdi (ml/experiment_objective.py).
  • Ham özelliklerin tam-örneklem korelasyonu anlamlı görünüyordu ama özellik
    seçimi yalnız geçmişe bakarak yapılınca (D2) sinyal buharlaştı: t = -0.29.
    Yani o korelasyonlar örneklem-içi yapaylıktı.

Geriye iki olasılık kalıyor:
  (1) 10 GÜNLÜK UFUK yanlış. Literatürdeki iki sağlam kesitsel etki kısa vadeli
      dönüş (1-5 gün) ve uzun vadeli momentumdur (6-12 ay). 10 gün tam ikisinin
      arasındaki ölü bölgede.
  (2) Teknik gösterge seti tükendi; sinyal başka veride (temel, haber, likidite).

Bu deney (1)'i sınar. Ucuz: OHLC bir kez inilir, özellikler bir kez hesaplanır,
sonra her ufuk için ölçüm yapılır.

Hedef değişken olarak İKİ ölçüt kullanılır:
  • ham ileri getiri
  • PİYASA-GÖRELİ ileri getiri (o günün ortalaması çıkarılmış) ← asıl olan,
    çünkü sistem long-only ve her gün 50 hisseden seçim yapıyor. Gün etkisi
    etiket varyansının %36'sıydı; onu çıkarınca geriye saf seçicilik kalır.

Ölçüm gün bazında bağımsızdır (aynı günün 50 satırı tek gözlem değildir).

Çalıştırma:  docker compose exec ai-oracle-service python -m ml.experiment_horizon
Çıktı:       models/ml_v3/experiment_horizon.json   (HİÇBİR canlı dosya değişmez)
"""
import datetime
import json
import sys
import time

import numpy as np
import pandas as pd
import yfinance as yf

sys.path.insert(0, "/app")

from ml.config import FEATURE_NAMES, HISTORY_PERIOD, ML_DIR
from ml.features import compute_features, fetch_context
from ml.universe import load_universe

OUT_FILE   = ML_DIR / "experiment_horizon.json"
CACHE_FILE = ML_DIR / "_horizon_panel.csv"     # ham OHLC + özellik önbelleği

HORIZONS = [1, 2, 3, 5, 10, 20, 40, 60]


def is_quality(df) -> bool:
    return df is not None and len(df) > 300 and df["Close"].notna().mean() > 0.9


def build_panel(verbose: bool = True) -> pd.DataFrame:
    """
    date, symbol, <21 özellik>, close  panelini kurar ve önbelleğe yazar.
    Etiket YOK — etiket ufka bağlı, aşağıda üretilir.
    """
    if CACHE_FILE.exists():
        if verbose:
            print(f"[ufuk] Önbellek kullanılıyor: {CACHE_FILE}")
        p = pd.read_csv(CACHE_FILE, parse_dates=["date"])
        return p

    universe = load_universe()
    ctx = fetch_context(period=HISTORY_PERIOD)
    frames = []
    for i, (sym, yf_sym) in enumerate(universe.items(), 1):
        try:
            df = yf.download(yf_sym, period=HISTORY_PERIOD, interval="1d",
                             auto_adjust=True, progress=False, threads=False)
            if df is not None and isinstance(df.columns, pd.MultiIndex):
                df.columns = df.columns.droplevel(1)
            if not is_quality(df):
                if verbose:
                    print(f"  [{i}] {sym}: atlandı")
                time.sleep(0.3)
                continue
            feat = compute_features(df, ctx=ctx)
            part = feat.copy()
            part["date"]   = df.index
            part["symbol"] = sym
            part["close"]  = df["Close"].values
            frames.append(part)
            if verbose:
                print(f"  [{i}/{len(universe)}] {sym}: {len(part)} satır")
            time.sleep(0.4)
        except Exception as e:
            if verbose:
                print(f"  [{i}] {sym}: HATA {e}")
            time.sleep(0.4)

    if not frames:
        raise RuntimeError("Panel kurulamadı.")
    panel = pd.concat(frames, ignore_index=True)
    panel["date"] = pd.to_datetime(panel["date"])
    panel = panel.sort_values(["symbol", "date"]).reset_index(drop=True)
    ML_DIR.mkdir(parents=True, exist_ok=True)
    panel.to_csv(CACHE_FILE, index=False)
    if verbose:
        print(f"[ufuk] Panel: {len(panel):,} satır · {panel['symbol'].nunique()} sembol → önbellek")
    return panel


def add_forward_returns(panel: pd.DataFrame, h: int) -> pd.DataFrame:
    """h gün ileri getiri + o günün piyasa ortalaması çıkarılmış hâli."""
    p = panel.sort_values(["symbol", "date"]).copy()
    p["fwd"] = p.groupby("symbol")["close"].shift(-h) / p["close"] - 1.0
    p = p.dropna(subset=["fwd"])
    p["fwd_rel"] = p["fwd"] - p.groupby("date")["fwd"].transform("mean")
    return p


def daily_t(vals) -> dict:
    v = np.asarray([x for x in vals if x is not None and x == x], dtype=float)
    if len(v) < 5:
        return {"n": int(len(v)), "mean": None, "t": None}
    se = v.std(ddof=1) / np.sqrt(len(v))
    t = float(v.mean() / se) if se > 0 else 0.0
    return {"n": int(len(v)), "mean": round(float(v.mean()), 4), "t": round(t, 2)}


def feature_signal(p: pd.DataFrame, target: str) -> list:
    """Her özellik için gün-içi Spearman(özellik, hedef); günler arası t."""
    out = []
    for f in FEATURE_NAMES:
        if f not in p.columns:
            continue
        cors = []
        for _, g in p.groupby("date"):
            if len(g) < 10:
                continue
            x, y = g[f].values, g[target].values
            if np.std(x) == 0 or np.std(y) == 0:
                continue
            c = pd.Series(x).corr(pd.Series(y), method="spearman")
            if c == c:
                cors.append(c)
        d = daily_t(cors)
        if d["mean"] is not None:
            out.append({"feature": f, **d})
    out.sort(key=lambda r: -abs(r["t"] or 0))
    return out


def main():
    panel = build_panel()
    n_feat = len([f for f in FEATURE_NAMES if f in panel.columns])
    # Bonferroni: n_feat × len(HORIZONS) test yapılıyor.
    n_tests = n_feat * len(HORIZONS)
    crit = 3.0 if n_tests > 100 else 2.6
    print(f"\n[ufuk] {n_feat} özellik × {len(HORIZONS)} ufuk = {n_tests} test "
          f"→ anlamlılık eşiği |t| ≥ {crit}\n")

    results = []
    for h in HORIZONS:
        p = add_forward_returns(panel, h)
        row = {"horizon": h, "n_rows": int(len(p)), "n_days": int(p["date"].nunique())}
        for target, key in (("fwd", "raw"), ("fwd_rel", "market_relative")):
            sig = feature_signal(p, target)
            row[key] = {
                "top": sig[:5],
                "n_significant": sum(1 for s in sig if abs(s["t"] or 0) >= crit),
                "max_abs_t": round(max((abs(s["t"] or 0) for s in sig), default=0), 2),
            }
        results.append(row)
        rel = row["market_relative"]
        best = rel["top"][0] if rel["top"] else None
        print(f"  ufuk {h:>2}g | {row['n_days']} gün | piyasa-göreli: "
              f"{rel['n_significant']} anlamlı özellik, en güçlü |t|={rel['max_abs_t']}"
              + (f"  ({best['feature']} r={best['mean']:+.4f})" if best else ""))

    out = {
        "computed_at": datetime.datetime.utcnow().isoformat(),
        "significance_threshold": crit,
        "n_tests": n_tests,
        "horizons": results,
    }
    OUT_FILE.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")

    print("\n" + "=" * 78)
    print("PİYASA-GÖRELİ İLERİ GETİRİ — ufuk başına en güçlü 3 özellik")
    print("=" * 78)
    for r in results:
        print(f"\n  ufuk {r['horizon']}g ({r['n_days']} gün):")
        for s in r["market_relative"]["top"][:3]:
            mark = "  ← ANLAMLI" if abs(s["t"]) >= crit else ""
            print(f"    {s['feature']:22} r={s['mean']:+.4f}  t={s['t']:+6.2f}{mark}")
    print(f"\n[deney] Kaydedildi → {OUT_FILE}")


if __name__ == "__main__":
    main()
