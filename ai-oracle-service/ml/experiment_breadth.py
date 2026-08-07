"""
SerInvest — Deney: Model piyasa GENİŞLİĞİNİ mi okuyor? (çevrimdışı, canlıya dokunmaz)
=====================================================================================
Sorun (08/2026): Canlıda AL kapsamı %98-100, geçmiş sınavda %28. Model her gün
"hepsini al" diyor. Bu, lift'in 0 çıkmasının da matematiksel sebebi — evrenin
%98'ini seçersen isabetin tabana EŞİT olmak zorundadır.

İki aday açıklama:
  (a) Piyasa rejimi — gerçekten geniş tabanlı yükseliş var
  (b) SIZINTI — `above_ema200`, `ema_alignment` gibi İKİLİ/ayrık özelliklerin
      kesitsel rank'i piyasa genişliğini kodluyor. Örn. sembollerin %90'ı
      EMA200 üstündeyse "1" grubunun rank'i ~0.55; %20'si üstündeyse ~0.90.
      Yani aynı teknik durum, piyasa genişliğine göre FARKLI girdi üretiyor →
      model kesitsel seçici olmaktan çıkıp piyasa zamanlayıcıya dönüşüyor.
      (xsec-rank tam da bunu engellemek için eklenmişti — bkz. ml/config.py)

Test: her gün için modelin ortalama p'si ile o günün piyasa genişliği arasındaki
korelasyona bakılır. Yüksek korelasyon (b)'yi işaret eder.

Çalıştırma:  docker compose exec ai-oracle-service python -m ml.experiment_breadth
Çıktı:       models/ml_v3/experiment_breadth.json  (hiçbir canlı dosya değişmez)
"""
import json
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, "/app")

from ml.config import BUY_THRESHOLD, FEATURE_NAMES, ML_DIR   # noqa: E402

OUT = ML_DIR / "experiment_breadth.json"

# Genişlik göstergesi olabilecek ikili/ayrık özellikler
BREADTH_FEATURES = ["above_ema200", "ema_alignment"]


def main() -> dict:
    import ml_live   # canlı modülü yalnız OKUMAK için

    model = ml_live.load_champion()
    if model is None:
        return {"error": "champion yüklenemedi"}

    raw = ml_live._load_training_data(rebuild=False)     # HAM özellikler
    ranked = ml_live.prepare_training(raw.copy())        # xsec-rank uygulanmış
    raw["_d"] = raw["date"].astype(str).str[:10]
    ranked["_d"] = ranked["date"].astype(str).str[:10]

    rows = []
    for day, g in ranked.groupby("_d"):
        if len(g) < 20:
            continue
        p = model.predict_proba(g[FEATURE_NAMES])[:, 1]
        gr = raw[raw["_d"] == day]
        rec = {
            "date": day,
            "n": int(len(g)),
            "mean_p": round(float(p.mean()), 4),
            "coverage": round(float((p >= BUY_THRESHOLD).mean()), 4),
            "up_rate": round(float(g["label"].astype(int).mean()), 4) if "label" in g else None,
        }
        # O günün piyasa genişliği (HAM ikili özelliklerin ortalaması)
        for f in BREADTH_FEATURES:
            if f in gr.columns:
                rec[f"breadth_{f}"] = round(float(pd.to_numeric(gr[f], errors="coerce").mean()), 4)
        rows.append(rec)

    if len(rows) < 30:
        return {"error": f"yetersiz gün ({len(rows)})"}

    df = pd.DataFrame(rows).sort_values("date")

    # ── Korelasyonlar ────────────────────────────────────────────────────────
    cors = {}
    for f in BREADTH_FEATURES:
        col = f"breadth_{f}"
        if col in df.columns and df[col].notna().sum() > 20:
            cors[f] = {
                "corr_with_mean_p":   round(float(df[col].corr(df["mean_p"])), 4),
                "corr_with_coverage": round(float(df[col].corr(df["coverage"])), 4),
            }

    cov = df["coverage"]
    verdict = (
        "SIZINTI KUVVETLİ" if any(abs(c["corr_with_coverage"]) >= 0.6 for c in cors.values())
        else "SIZINTI OLASI" if any(abs(c["corr_with_coverage"]) >= 0.35 for c in cors.values())
        else "SIZINTI ZAYIF — kapsam genişlikten bağımsız"
    )

    out = {
        "computed_at": pd.Timestamp.utcnow().isoformat(),
        "n_days": int(len(df)),
        "date_range": [df["date"].iloc[0], df["date"].iloc[-1]],
        "coverage": {
            "mean":   round(float(cov.mean()), 4),
            "median": round(float(cov.median()), 4),
            "min":    round(float(cov.min()), 4),
            "max":    round(float(cov.max()), 4),
            "days_above_90pct": int((cov >= 0.90).sum()),
            "days_below_10pct": int((cov <= 0.10).sum()),
        },
        "mean_p": {
            "mean": round(float(df["mean_p"].mean()), 4),
            "min":  round(float(df["mean_p"].min()), 4),
            "max":  round(float(df["mean_p"].max()), 4),
        },
        "breadth_correlations": cors,
        "verdict": verdict,
        "note": ("Kapsam ile piyasa genişliği arasında yüksek korelasyon, modelin "
                 "kesitsel seçici değil PİYASA ZAMANLAYICI olduğunu gösterir. "
                 "xsec-rank bunu engellemek için eklenmişti; ikili özelliklerde "
                 "rank, genişliği sızdırabiliyor."),
        "daily": rows[-60:],
    }
    ML_DIR.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    return out


if __name__ == "__main__":
    r = main()
    if "error" in r:
        print("HATA:", r["error"]); raise SystemExit(1)
    c = r["coverage"]
    print("=" * 66)
    print("DENEY: Model piyasa genişliğini mi okuyor?")
    print("=" * 66)
    print(f"  {r['n_days']} gün · {r['date_range'][0]} → {r['date_range'][1]}")
    print()
    print(f"  AL kapsamı  : ort %{c['mean']*100:.0f} · medyan %{c['median']*100:.0f} "
          f"· min %{c['min']*100:.0f} · max %{c['max']*100:.0f}")
    print(f"  %90 üstü gün: {c['days_above_90pct']}/{r['n_days']}   "
          f"%10 altı gün: {c['days_below_10pct']}/{r['n_days']}")
    print(f"  ortalama p  : {r['mean_p']['mean']:.2f} "
          f"(min {r['mean_p']['min']:.2f} · max {r['mean_p']['max']:.2f})")
    print()
    print("  GENİŞLİK KORELASYONLARI (kapsam ile):")
    for f, v in r["breadth_correlations"].items():
        print(f"    {f:<18} r = {v['corr_with_coverage']:+.3f}   (ort p ile {v['corr_with_mean_p']:+.3f})")
    print()
    print(f"  SONUÇ: {r['verdict']}")
    print(f"  Kayıt : {OUT}")
