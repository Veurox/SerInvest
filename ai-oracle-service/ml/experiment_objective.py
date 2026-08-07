"""
SerInvest — Deney: Eğitim HEDEFİ yanlış mı? (çevrimdışı, canlıya dokunmaz)
===========================================================================
Bulgu zinciri (08/2026):

  1. Eğitilmiş şampiyon gün içinde hisse sıralayamıyor.
     Spearman(p, sonuç) = -0.007, t = -0.78, n = 468 OOS günü → sıfır.
     (ml/experiment_ranking.py)

  2. Ama HAM ÖZELLİKLER sıralayabiliyor. Gün-içi Spearman, 700 günde:
       bb_width           r = -0.029  t = -4.20
       price_vs_52w_high  r = +0.036  t = +4.20
       ema_alignment      r = +0.025  t = +3.05
     Üçü de 20 testlik Bonferroni düzeltmesinden sonra bile anlamlı.
     Yani sinyal VERİDE var, model onu ÇIKARAMIYOR.

  3. Sebep — hedef ile kullanım uyuşmuyor:
       • Günlük UP oranının standart sapması 30 PUAN (min %0, maks %100).
         Etiket varyansının %36'sı saf GÜN etkisi.
       • Özellikler ise XSEC_RANK ile kesitsel rank'e çevriliyor; gün-geneli
         bilgi KASTEN siliniyor (o yüzden gün etkisini açıklamaları imkânsız).
       • Model `objective="binary"` ile MUTLAK etiketi tahmin etmeye çalışıyor.
     Sonuç: model, özelliklerin ilkesel olarak açıklayamayacağı %36'lık gürültüyü
     kovalıyor; aradığımız r≈0.03'lük kesitsel sinyal bu gürültüde kayboluyor.

Test edilen varyantlar (hepsi AYNI purged+embargo walk-forward, aynı özellikler):
  A) baseline   — mevcut: objective=binary, ağırlıksız
  B) gün-ağırlık— binary, ama her GÜN loss'a eşit katkı yapar ve gün içindeki
                  sınıf dengesizliği düzeltilir → gün-seviyesi taban oynaklığı
                  loss'tan çıkar, geriye kesitsel sıralama kalır
  C) LambdaRank — LGBMRanker, grup = gün. Doğrudan "gün içinde sırala"yı
                  optimize eder; literatürdeki doğru araç budur
  D) basit skor — model yok: yalnız 3 anlamlı özelliğin gün-içi rank ortalaması.
                  Karmaşık modelin basit bir toplamı geçip geçmediğini gösterir

Ölçüt: OOS gün-içi Spearman(skor, sonuç) — günler arası ortalama + t.
Havuzlama YOK: aynı günün 50 satırı bağımsız gözlem sayılmaz.

Çalıştırma:  docker compose exec ai-oracle-service python -m ml.experiment_objective
Çıktı:       models/ml_v3/experiment_objective.json   (HİÇBİR canlı dosya değişmez)
"""
import datetime
import json
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, "/app")

from ml.config import (FEATURE_NAMES, LGBM_PARAMS, MIN_TRAIN_ROWS, ML_DIR,
                       TRAIN_CACHE, WF_EMBARGO_DAYS, WF_INITIAL_TRAIN_DAYS,
                       WF_PURGE_DAYS, WF_STEP_DAYS)

OUT_FILE = ML_DIR / "experiment_objective.json"

# (2) numaralı bulguda anlamlı çıkan üç özellik ve beklenen yönleri.
SIMPLE_FEATURES = {"price_vs_52w_high": +1, "ema_alignment": +1, "bb_width": -1}


# ── Ölçüm ────────────────────────────────────────────────────────────────────

def t_stat(vals: list) -> dict:
    v = np.asarray([x for x in vals if x is not None and x == x], dtype=float)
    if len(v) < 3:
        return {"n": int(len(v)), "mean": None, "t": None, "significant": False}
    se = v.std(ddof=1) / np.sqrt(len(v))
    t = float(v.mean() / se) if se > 0 else 0.0
    return {"n": int(len(v)), "mean": round(float(v.mean()), 4),
            "se": round(float(se), 4), "t": round(t, 2),
            "significant": bool(abs(t) >= 2.0)}


def score_day_corrs(df: pd.DataFrame, score_col: str) -> list:
    """Her gün için Spearman(skor, etiket)."""
    out = []
    for _, g in df.groupby("date"):
        if len(g) < 10:
            continue
        x, y = g[score_col].values, g["y"].values
        if np.std(x) == 0 or np.std(y) == 0:
            continue
        out.append(pd.Series(x).corr(pd.Series(y), method="spearman"))
    return out


def topk_lift(df: pd.DataFrame, score_col: str, k: float) -> list:
    """Her gün: en yüksek %k'nın isabeti − o günün tabanı."""
    out = []
    for _, g in df.groupby("date"):
        if len(g) < 10:
            continue
        n = max(1, int(round(len(g) * k)))
        sel = g.nlargest(n, score_col)
        out.append(float(sel["y"].mean() - g["y"].mean()))
    return out


# ── Varyant eğiticileri ──────────────────────────────────────────────────────

def _fit_a(train):
    from lightgbm import LGBMClassifier
    m = LGBMClassifier(**LGBM_PARAMS)
    m.fit(train[FEATURE_NAMES], train["label"].astype(int))
    return lambda test: m.predict_proba(test[FEATURE_NAMES])[:, 1]


def _fit_b(train):
    """
    Gün-ağırlıklı binary.
    Her gün toplam ağırlığı eşit; gün İÇİNDE iki sınıf da eşit ağırlıklı.
    Böylece "bugün piyasa %90 yükseldi" bilgisi loss'tan düşer ve model
    yalnızca "aynı gün hangisi diğerinden iyi" sorusuna odaklanır.
    """
    from lightgbm import LGBMClassifier
    y = train["label"].astype(int)
    w = pd.Series(1.0, index=train.index)
    for d, idx in train.groupby("date").groups.items():
        yy = y.loc[idx]
        n1, n0 = int(yy.sum()), int((1 - yy).sum())
        if n1 == 0 or n0 == 0:
            w.loc[idx] = 0.0          # tek sınıflı gün kesitsel bilgi taşımaz
            continue
        w.loc[idx] = np.where(yy == 1, 0.5 / n1, 0.5 / n0)
    m = LGBMClassifier(**LGBM_PARAMS)
    m.fit(train[FEATURE_NAMES], y, sample_weight=w.values)
    return lambda test: m.predict_proba(test[FEATURE_NAMES])[:, 1]


def _fit_c(train):
    """LambdaRank — grup = gün. Doğrudan gün-içi sıralamayı optimize eder."""
    from lightgbm import LGBMRanker
    tr = train.sort_values("date")
    groups = tr.groupby("date", sort=True).size().values
    params = {k: v for k, v in LGBM_PARAMS.items() if k != "objective"}
    m = LGBMRanker(objective="lambdarank", label_gain=[0, 1], **params)
    m.fit(tr[FEATURE_NAMES], tr["label"].astype(int), group=groups)
    return lambda test: m.predict(test[FEATURE_NAMES])


def _fit_d(train):
    """
    Model yok — üç anlamlı özelliğin gün-içi rank ortalaması.

    DİKKAT: bu üç özellik TÜM veriye bakılarak seçildi (20 özelliğin taraması).
    Yani D'nin sonucu SEÇİM YANLILIĞI taşır ve olduğundan iyi görünür.
    Dürüst hâli D2'dir; D burada yalnızca üst sınır referansı olarak durur.
    """
    def score(test):
        s = np.zeros(len(test))
        for f, sign in SIMPLE_FEATURES.items():
            if f not in test.columns:
                continue
            r = test.groupby("date")[f].rank(pct=True).values
            s += sign * r
        return s
    return score


def _select_features(train, k: int = 3) -> dict:
    """Yalnız EĞİTİM penceresine bakarak en güçlü k özelliği ve yönünü seçer."""
    scores = []
    for f in FEATURE_NAMES:
        cors = []
        for _, g in train.groupby("date"):
            if len(g) < 10:
                continue
            x, y = g[f].values, g["label"].values
            if np.std(x) == 0 or np.std(y) == 0:
                continue
            c = pd.Series(x).corr(pd.Series(y), method="spearman")
            if c == c:
                cors.append(c)
        if len(cors) < 30:
            continue
        v = np.asarray(cors)
        se = v.std(ddof=1) / np.sqrt(len(v))
        if se > 0:
            scores.append((abs(v.mean() / se), f, 1 if v.mean() > 0 else -1))
    scores.sort(reverse=True)
    return {f: sign for _, f, sign in scores[:k]}


def _fit_d2(train):
    """
    D'nin DÜRÜST hâli: özellikler her adımda yalnız eğitim penceresinden seçilir.
    Geleceğe bakma yok — canlıda gerçekten yapılabilecek olan budur.
    """
    chosen = _select_features(train, k=3)

    def score(test):
        s = np.zeros(len(test))
        for f, sign in chosen.items():
            if f in test.columns:
                s += sign * test.groupby("date")[f].rank(pct=True).values
        return s
    return score


def _fit_e(train):
    """
    Lojistik regresyon — gün-içi rank'lenmiş özellikler üzerinde.
    Gerekçe: aranan sinyal r≈0.03. Yüksek kapasiteli ağaç topluluğu bu kadar
    zayıf sinyali gürültüye boğuyor; doğrusal model doğru tümevarım önyargısına
    sahip ve zayıf-doğrusal ilişkileri korur.
    """
    from sklearn.linear_model import LogisticRegression
    from sklearn.preprocessing import StandardScaler
    from sklearn.pipeline import make_pipeline

    def ranked(df):
        return df.groupby("date")[FEATURE_NAMES].rank(pct=True).fillna(0.5)

    pipe = make_pipeline(StandardScaler(),
                         LogisticRegression(C=0.05, max_iter=2000, random_state=42))
    pipe.fit(ranked(train), train["label"].astype(int))
    return lambda test: pipe.predict_proba(ranked(test))[:, 1]


def _fit_f(train):
    """
    Ağır düzenlileştirilmiş, gün-ağırlıklı LGBM.
    B ile aynı ağırlıklandırma ama kapasite çok düşük (50 ağaç, 7 yaprak,
    derinlik 3). Soru: B'nin başarısızlığı hedefte mi, kapasitede mi?
    """
    from lightgbm import LGBMClassifier
    y = train["label"].astype(int)
    w = pd.Series(1.0, index=train.index)
    for _, idx in train.groupby("date").groups.items():
        yy = y.loc[idx]
        n1, n0 = int(yy.sum()), int((1 - yy).sum())
        w.loc[idx] = 0.0 if (n1 == 0 or n0 == 0) else np.where(yy == 1, 0.5 / n1, 0.5 / n0)
    params = dict(LGBM_PARAMS)
    params.update(n_estimators=50, num_leaves=7, max_depth=3,
                  learning_rate=0.05, min_child_samples=200,
                  reg_alpha=1.0, reg_lambda=5.0)
    m = LGBMClassifier(**params)
    m.fit(train[FEATURE_NAMES], y, sample_weight=w.values)
    return lambda test: m.predict_proba(test[FEATURE_NAMES])[:, 1]


VARIANTS = [
    ("A · baseline (mevcut)",       _fit_a),
    ("B · gün-ağırlıklı binary",    _fit_b),
    ("C · LambdaRank (grup=gün)",   _fit_c),
    ("D · 3-özellik (YANLI)",       _fit_d),
    ("D2 · 3-özellik (dürüst seçim)", _fit_d2),
    ("E · lojistik (rank, C=0.05)", _fit_e),
    ("F · küçük LGBM + gün-ağırlık", _fit_f),
]


# ── Walk-forward ─────────────────────────────────────────────────────────────

def run_walk_forward(data: pd.DataFrame) -> dict:
    data = data.sort_values("date").reset_index(drop=True)
    dates = pd.to_datetime(data["date"])
    min_d, max_d = dates.min(), dates.max()

    gap  = datetime.timedelta(days=WF_PURGE_DAYS + WF_EMBARGO_DAYS)
    step = datetime.timedelta(days=WF_STEP_DAYS)

    preds = {name: [] for name, _ in VARIANTS}
    train_cutoff = min_d + datetime.timedelta(days=WF_INITIAL_TRAIN_DAYS)
    fold = 0

    while train_cutoff + gap < max_d:
        test_start = train_cutoff + gap
        test_end   = test_start + step
        train = data[dates <= train_cutoff]
        test  = data[(dates > test_start) & (dates <= test_end)]

        if len(train) >= MIN_TRAIN_ROWS and len(test) >= 20:
            fold += 1
            print(f"[WF] adım {fold:>2} | eğitim {len(train):>6} test {len(test):>4}", flush=True)
            for name, fit in VARIANTS:
                try:
                    scorer = fit(train)
                    preds[name].append(pd.DataFrame({
                        "date": test["date"].values,
                        "y":    test["label"].astype(int).values,
                        "score": scorer(test),
                    }))
                except Exception as e:
                    print(f"    [{name}] hata: {e}")
        train_cutoff += step

    results = []
    for name, _ in VARIANTS:
        if not preds[name]:
            continue
        df = pd.concat(preds[name], ignore_index=True)
        results.append({
            "variant": name,
            "n_oos": int(len(df)),
            "n_days": int(df["date"].nunique()),
            "within_day_spearman": t_stat(score_day_corrs(df, "score")),
            "lift_top10": t_stat(topk_lift(df, "score", 0.10)),
            "lift_top20": t_stat(topk_lift(df, "score", 0.20)),
            "lift_top30": t_stat(topk_lift(df, "score", 0.30)),
        })
    return {"folds": fold, "results": results}


def main():
    if not TRAIN_CACHE.exists():
        print(f"[deney] Eğitim verisi yok: {TRAIN_CACHE}")
        return
    data = pd.read_csv(TRAIN_CACHE)
    data = data[data["label"].isin([0, 1])].copy()
    print(f"[deney] {len(data):,} satır · {data['date'].nunique()} gün\n")

    out = run_walk_forward(data)
    out["computed_at"] = datetime.datetime.utcnow().isoformat()
    ML_DIR.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")

    print("\n" + "=" * 88)
    print("GÜN-İÇİ SIRALAMA GÜCÜ  (t≥2 = şanstan ayırt edilebilir; havuzlama yok)")
    print("=" * 88)
    print(f"  {'varyant':28} {'spearman':>10} {'t':>7}   {'top%10 lift':>12} {'t':>7}   {'top%20 lift':>12} {'t':>7}")
    for r in out["results"]:
        s, l10, l20 = r["within_day_spearman"], r["lift_top10"], r["lift_top20"]
        f = lambda d, key='mean': (f"{d[key]:+.4f}" if d.get(key) is not None else "—")
        star = "  ✓" if s.get("significant") else ""
        print(f"  {r['variant']:28} {f(s):>10} {f(s,'t'):>7}   {f(l10):>12} {f(l10,'t'):>7}   {f(l20):>12} {f(l20,'t'):>7}{star}")
    print(f"\n[deney] Kaydedildi → {OUT_FILE}")


if __name__ == "__main__":
    main()
