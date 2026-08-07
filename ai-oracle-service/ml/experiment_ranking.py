"""
SerInvest — Deney: Model GÜN İÇİNDE hisse sıralayabiliyor mu? (çevrimdışı)
==========================================================================
Neden bu deney (08/2026):

Canlı veriyle yapılan ilk analiz "en yüksek güven dilimi en kötü sonucu veriyor"
dedi. O analiz YANLIŞTI: sonuçlanmış 249 tahmin vardı ama yalnızca **5 bağımsız
gün**. Olasılık dilimleri günlerle örtüştüğü için ölçülen şey modelin sıralama
gücü değil, "13 Temmuz kötü bir gündü" gerçeğiydi.

Doğru soru ikiye ayrılır:
  (A) ZAMANLAMA  — model bugünün iyi/kötü gün olduğunu biliyor mu?
  (B) SEÇİCİLİK  — AYNI GÜN içinde iyi hisseyi kötüden ayırabiliyor mu?

Sistem long-only ve her gün 50 sembolden seçim yapıyor. Asıl işe yarayan (B).
(A) ise kapsamı belirler: model "bugün kötü" diyebiliyorsa az sinyal üretmeli.

747 gün × 50 sembol geçmişte var. Canlıda 5 gün beklemek yerine burada ölçülür.

Ölçüm yöntemi — GÜN BAZINDA bağımsızlık:
  Her OOS günü için Spearman(p, getiri) hesaplanır; günler arası ortalama alınır
  ve t = ortalama / standart_hata ile sıfırdan ayırt edilip edilemediğine bakılır.
  Aynı günün 50 satırını bağımsız saymak (havuzlama) PSI yanlış alarmının ve
  yukarıdaki hatalı analizin kaynağıydı — burada tekrarlanmıyor.

Ayrıca strateji karşılaştırması: sabit eşik (BUY_THRESHOLD) vs her gün en iyi
%K'yı seçmek (kesitsel). Kapsam patlaması sorununun cevabı buradan çıkar.

Çalıştırma:  docker compose exec ai-oracle-service python -m ml.experiment_ranking
Çıktı:       models/ml_v3/experiment_ranking.json   (HİÇBİR canlı dosya değişmez)
"""
import datetime
import json
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, "/app")

from ml.config import (BUY_THRESHOLD, FEATURE_NAMES, MIN_TRAIN_ROWS, ML_DIR,
                       SL_ATR_MULT, TP_ATR_MULT, TRAIN_CACHE,
                       TRANSACTION_COST_PCT, WF_EMBARGO_DAYS,
                       WF_INITIAL_TRAIN_DAYS, WF_PURGE_DAYS, WF_STEP_DAYS)
from ml.model import train_model

OUT_FILE = ML_DIR / "experiment_ranking.json"


# ── İstatistik yardımcıları ──────────────────────────────────────────────────

def spearman(a: np.ndarray, b: np.ndarray) -> float | None:
    """Sıra korelasyonu. Sabit dizi varsa tanımsız → None."""
    if len(a) < 5:
        return None
    ra = pd.Series(a).rank().values
    rb = pd.Series(b).rank().values
    if ra.std() == 0 or rb.std() == 0:
        return None
    return float(np.corrcoef(ra, rb)[0, 1])


def t_stat(vals: list) -> dict:
    """Günlük ölçümlerin ortalaması sıfırdan ayırt edilebiliyor mu?"""
    v = np.asarray([x for x in vals if x is not None], dtype=float)
    if len(v) < 3:
        return {"n": int(len(v)), "mean": None, "t": None}
    se = v.std(ddof=1) / np.sqrt(len(v))
    return {
        "n": int(len(v)),
        "mean": round(float(v.mean()), 4),
        "std": round(float(v.std(ddof=1)), 4),
        "se": round(float(se), 4),
        "t": round(float(v.mean() / se), 2) if se > 0 else None,
        "significant": bool(se > 0 and abs(v.mean() / se) >= 2.0),
    }


# ── OOS tahminleri TARİHİYLE BİRLİKTE üret ───────────────────────────────────

def walk_forward_with_dates(data: pd.DataFrame, verbose: bool = True) -> pd.DataFrame:
    """
    ml/validation.py'deki purged walk-forward ile AYNI bölme mantığı, tek farkla:
    (date, symbol) korunur. validation.py bunları atıyor, bu yüzden gün-içi
    analiz orada yapılamıyor.
    """
    data = data.sort_values("date").reset_index(drop=True)
    dates = pd.to_datetime(data["date"])
    min_d, max_d = dates.min(), dates.max()

    gap  = datetime.timedelta(days=WF_PURGE_DAYS + WF_EMBARGO_DAYS)
    step = datetime.timedelta(days=WF_STEP_DAYS)
    train_cutoff = min_d + datetime.timedelta(days=WF_INITIAL_TRAIN_DAYS)

    out, fold = [], 0
    while train_cutoff + gap < max_d:
        test_start = train_cutoff + gap
        test_end   = test_start + step

        train = data[dates <= train_cutoff]
        te_mask = (dates > test_start) & (dates <= test_end)
        test = data[te_mask]

        if len(train) >= MIN_TRAIN_ROWS and len(test) >= 20:
            fold += 1
            model = train_model(train[FEATURE_NAMES], train["label"], enforce_min=True)
            if model is not None:
                p = model.predict_proba(test[FEATURE_NAMES])[:, 1]
                out.append(pd.DataFrame({
                    "fold":   fold,
                    "date":   test["date"].values,
                    "symbol": test["symbol"].values,
                    "p":      p,
                    "y":      test["label"].astype(int).values,
                }))
                if verbose:
                    print(f"[WF] adım {fold:>2} | eğitim {len(train):>6} test {len(test):>4}")
        train_cutoff += step

    return pd.concat(out, ignore_index=True) if out else pd.DataFrame()


# ── Analizler ────────────────────────────────────────────────────────────────

def within_day_power(oos: pd.DataFrame) -> dict:
    """(B) SEÇİCİLİK — aynı gün içinde p, gerçek sonucu sıralıyor mu?"""
    cors, spreads = [], []
    for _, g in oos.groupby("date"):
        if len(g) < 10:
            continue
        c = spearman(g["p"].values, g["y"].values)
        if c is not None:
            cors.append(c)
        gs = g.sort_values("p", ascending=False)
        k = max(1, len(gs) // 3)
        spreads.append(float(gs["y"].head(k).mean() - gs["y"].tail(k).mean()))

    return {
        "spearman_by_day": t_stat(cors),
        # "en iyi 1/3" ile "en kötü 1/3" arasındaki UP oranı farkı (puan)
        "top_minus_bottom_third": t_stat(spreads),
    }


def timing_power(oos: pd.DataFrame) -> dict:
    """(A) ZAMANLAMA — günün ortalama p'si, o günün taban UP oranını öngörüyor mu?"""
    daily = oos.groupby("date").agg(mean_p=("p", "mean"), base=("y", "mean"), n=("y", "size"))
    daily = daily[daily["n"] >= 10]
    if len(daily) < 10:
        return {"n_days": int(len(daily)), "corr": None}
    return {
        "n_days": int(len(daily)),
        "corr": round(float(np.corrcoef(daily["mean_p"], daily["base"])[0, 1]), 4),
        "note": "yüksek korelasyon = model kesitsel seçici değil, piyasa zamanlayıcı",
    }


def strategy_grid(oos: pd.DataFrame) -> list:
    """
    Sabit eşik vs kesitsel top-%K karşılaştırması.

    Her strateji için gün bazında precision ölçülür ve o günün tabanıyla
    karşılaştırılır (lift). Havuzlanmış tek sayı yerine GÜNLÜK lift dağılımı
    raporlanır — böylece "şans mı, kenar mı" sorusu t ile cevaplanır.
    """
    rows = []

    def evaluate(name, picker, coverage_note):
        lifts, precs, covs = [], [], []
        for _, g in oos.groupby("date"):
            if len(g) < 10:
                continue
            sel = picker(g)
            if len(sel) == 0:
                continue
            base = float(g["y"].mean())
            prec = float(sel["y"].mean())
            lifts.append(prec - base)
            precs.append(prec)
            covs.append(len(sel) / len(g))
        if not lifts:
            return
        rows.append({
            "strategy": name,
            "coverage": coverage_note,
            "mean_coverage": round(float(np.mean(covs)), 3),
            "mean_precision": round(float(np.mean(precs)), 4),
            "lift": t_stat(lifts),
            # Kârlılık eşiği: TP/SL asimetrisiyle başabaş precision
            "breakeven_precision": round(
                (SL_ATR_MULT + TRANSACTION_COST_PCT / 0.02) / (TP_ATR_MULT + SL_ATR_MULT), 4),
        })

    evaluate(f"sabit eşik p>={BUY_THRESHOLD}",
             lambda g: g[g["p"] >= BUY_THRESHOLD], "değişken")

    for k in (0.05, 0.10, 0.20, 0.30, 0.50):
        n = k
        evaluate(f"kesitsel en iyi %{int(k*100)}",
                 lambda g, n=n: g.nlargest(max(1, int(round(len(g) * n))), "p"),
                 f"%{int(k*100)} (sabit)")

    # Karşılaştırma tabanı: hepsini al
    evaluate("hepsini al (taban)", lambda g: g, "%100")
    return rows


def main():
    if not TRAIN_CACHE.exists():
        print(f"[deney] Eğitim verisi yok: {TRAIN_CACHE}")
        return
    data = pd.read_csv(TRAIN_CACHE)
    data = data[data["label"].isin([0, 1])].copy()
    print(f"[deney] {len(data):,} satır · {data['date'].nunique()} gün · {data['symbol'].nunique()} sembol")

    oos = walk_forward_with_dates(data)
    if oos.empty:
        print("[deney] OOS üretilemedi.")
        return
    print(f"[deney] OOS: {len(oos):,} tahmin · {oos['date'].nunique()} gün · {oos['fold'].nunique()} adım")

    result = {
        "computed_at": datetime.datetime.utcnow().isoformat(),
        "n_oos": int(len(oos)),
        "n_days": int(oos["date"].nunique()),
        "n_folds": int(oos["fold"].nunique()),
        "date_range": [str(oos["date"].min()), str(oos["date"].max())],
        "base_rate": round(float(oos["y"].mean()), 4),
        "selectivity_within_day": within_day_power(oos),
        "timing_across_days": timing_power(oos),
        "strategies": strategy_grid(oos),
    }

    ML_DIR.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    # ── Okunur özet ──
    s = result["selectivity_within_day"]
    print("\n" + "=" * 74)
    print(f"OOS: {result['n_oos']:,} tahmin · {result['n_days']} gün · taban UP %{result['base_rate']*100:.1f}")
    print("=" * 74)
    print("\n(B) SEÇİCİLİK — aynı gün içinde sıralayabiliyor mu?")
    for key, label in (("spearman_by_day", "Spearman(p, sonuç)"),
                       ("top_minus_bottom_third", "en iyi 1/3 − en kötü 1/3")):
        d = s[key]
        if d.get("mean") is None:
            print(f"  {label:28} veri yetersiz")
            continue
        verdict = "ANLAMLI ✓" if d["significant"] else "şanstan ayırt edilemez"
        print(f"  {label:28} {d['mean']:+.4f}  (n={d['n']} gün, t={d['t']:+.2f}) → {verdict}")

    t = result["timing_across_days"]
    print(f"\n(A) ZAMANLAMA — günlük ort. p ile o günün tabanı: r={t.get('corr')}  (n={t.get('n_days')} gün)")

    print("\nSTRATEJİ KARŞILAŞTIRMASI (günlük lift = precision − o günün tabanı)")
    print(f"  {'strateji':26} {'kapsam':>7} {'precision':>10} {'lift':>8} {'t':>7}  yargı")
    for r in result["strategies"]:
        lf = r["lift"]
        m = f"{lf['mean']:+.4f}" if lf.get("mean") is not None else "—"
        tt = f"{lf['t']:+.2f}" if lf.get("t") is not None else "—"
        v = "ANLAMLI ✓" if lf.get("significant") else "şans"
        print(f"  {r['strategy']:26} {r['mean_coverage']:>7.0%} {r['mean_precision']:>10.1%} {m:>8} {tt:>7}  {v}")
    print(f"\n  Başabaş precision (TP{TP_ATR_MULT}×/SL{SL_ATR_MULT}× + maliyet): "
          f"%{result['strategies'][0]['breakeven_precision']*100:.1f}")
    print(f"\n[deney] Kaydedildi → {OUT_FILE}")


if __name__ == "__main__":
    main()
