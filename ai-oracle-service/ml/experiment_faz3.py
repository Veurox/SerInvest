"""
SerInvest — Faz 3 deneyi: model hisse SEÇEBİLİYOR mu? (çevrimdışı, canlıya dokunmaz)
=====================================================================================
Protokol docs/PLAN_2026-10.md §4c'de, SONUÇLARDAN ÖNCE yazıldı ve
değiştirilmez. Bu dosya o protokolün birebir uygulamasıdır.

Sınanan üç bulgu (18.10.2026 denetimi):
  K2  Eğitim verisinin %30'unda EMA200 hesaplanamamış (ısınma satırları).
  K1  Evet/hayır özellikleri kesitsel sıraya çevrilince eşitler ortalama sıra
      alıyor; sıra değeri piyasa genişliğini taşıyor.
  K4  Özellikler göreli, etiket ve karar mutlak.

Varyantlar bir öncekinin üstüne TEK değişiklik ekler:
  A mevcut · B ısınmasız · C ham ikili · D göreli etiket · E lojistik göreli

Bütün varyantlar AYNI test satırlarında ölçülür (ısınma dışı, nötr dahil).
Ölçütler günlük serilerdir; 10 günlük getiriler örtüştüğü için t değerleri
Newey-West (gecikme 9).

Çalıştırma:  docker compose exec ai-oracle-service python -m ml.experiment_faz3
Çıktı:       models/ml_v3/experiment_faz3.json
             models/ml_v3/experiment_faz3_gunluk.csv   (HİÇBİR canlı dosya değişmez)
"""
import datetime
import json
import sys
import time

import numpy as np
import pandas as pd
import yfinance as yf

sys.path.insert(0, "/app")

from ml.config import FEATURE_NAMES, HORIZON, LGBM_PARAMS, ML_DIR, TRANSACTION_COST_PCT
from ml.features import compute_features, fetch_context
from ml.labels import compute_labels
from ml.universe import is_quality_data, load_universe

OUT_FILE = ML_DIR / "experiment_faz3.json"
GUNLUK_FILE = ML_DIR / "experiment_faz3_gunluk.csv"

# ── Protokol sabitleri (PLAN_2026-10 §4c) ────────────────────────────────────
YIL = 4                      # geriye indirilen yıl
ISINMA_BAR = 252             # her sembolün ilk 252 barı ısınma
TEST_GUN = 30                # test penceresi (takvim günü)
BOSLUK_GUN = 21              # eğitim–test arası (10 işlem günü ≈ 14 takvim + 5 ambargo + pay)
ILK_EGITIM_GUN = 365         # ilk testten önceki eğitim süresi
EVREN_ORANI = 0.90           # ilk test: evrenin %90'ı ısınmayı bitirince + 365 gün
NW_GECIKME = 9               # Newey-West gecikmesi (10 günlük örtüşme)
HAM_OZELLIKLER = ["above_ema200", "ema_alignment"]   # C, D, E'de sıraya çevrilmez
BUY_THRESHOLD_A = 0.58       # A'nın canlı karar eşiği (tanı için)
MALIYET = TRANSACTION_COST_PCT   # %0,20 gidiş-dönüş (config tanımı)

ESIK_SPEARMAN_T = 2.5        # çoklu karşılaştırma payıyla
ESIK_FAZLA_T = 2.0
ESIK_FAZLA = MALIYET         # en iyi %10 fazlası maliyetin üstünde olmalı
EN_AZ_GUNLUK_SEMBOL = 20


# ── İstatistik ───────────────────────────────────────────────────────────────

def nw(x) -> dict:
    """Ortalama ve Newey-West t (Bartlett, gecikme NW_GECIKME)."""
    v = np.asarray([a for a in x if a is not None and a == a], dtype=float)
    n = len(v)
    if n < NW_GECIKME + 5:
        return {"n": n, "ort": None, "t": None}
    e = v - v.mean()
    s = float(e @ e) / n
    for k in range(1, NW_GECIKME + 1):
        s += 2 * (1 - k / (NW_GECIKME + 1)) * float(e[k:] @ e[:-k]) / n
    se = np.sqrt(max(s, 1e-18) / n)
    return {"n": n, "ort": round(float(v.mean()), 5), "t": round(float(v.mean() / se), 2)}


# ── Veri ─────────────────────────────────────────────────────────────────────

def veri_hazirla() -> pd.DataFrame:
    evren = load_universe()
    bas = (datetime.date.today() - datetime.timedelta(days=int(365.25 * YIL))).isoformat()
    print(f"[faz3] evren {len(evren)} sembol, başlangıç {bas}", flush=True)
    ctx = fetch_context(period="5y")     # yalnız XU100 5g/20g getirisi — fazla geçmiş zararsız

    parcalar, atlanan = [], []
    for i, (sym, yf_sym) in enumerate(evren.items(), 1):
        try:
            df = yf.download(yf_sym, start=bas, interval="1d",
                             auto_adjust=True, progress=False, threads=False)
            if df is not None and isinstance(df.columns, pd.MultiIndex):
                df.columns = df.columns.droplevel(1)
            ok, neden = is_quality_data(df)
            if not ok:
                atlanan.append((sym, neden))
                continue
            feat = compute_features(df, ctx=ctx)
            etiket = compute_labels(df, feat["atr_pct"], horizon=HORIZON)
            close = df["Close"].squeeze().astype(float)
            p = feat.copy()
            p["label"] = etiket.values
            p["ileri"] = (close.shift(-HORIZON) / close - 1).values
            idx = pd.to_datetime(df.index)
            if idx.tz is not None:
                idx = idx.tz_localize(None)
            p["date"] = idx.normalize()
            p["symbol"] = sym
            p["isinma"] = np.arange(len(p)) < ISINMA_BAR
            parcalar.append(p[p["ileri"].notna()])
            print(f"  [{i}/{len(evren)}] {sym}: {len(df)} bar", flush=True)
        except Exception as e:
            atlanan.append((sym, str(e)))
        time.sleep(0.4)

    data = pd.concat(parcalar, ignore_index=True).sort_values(["date", "symbol"])
    data = data.reset_index(drop=True)
    print(f"[faz3] {len(data)} satır, {data.symbol.nunique()} sembol, atlanan {len(atlanan)}", flush=True)
    data.attrs["atlanan"] = atlanan
    return data


def sirala(df: pd.DataFrame, ham=()) -> pd.DataFrame:
    """Gün içi kesitsel sıra (canlıyla aynı: rank(pct=True), NaN → 0,5)."""
    out = df.copy()
    cols = [f for f in FEATURE_NAMES if f not in ham]
    out[cols] = df.groupby("date")[cols].rank(pct=True).fillna(0.5)
    return out


# ── Varyantlar ───────────────────────────────────────────────────────────────

def _lgbm(X, y):
    from lightgbm import LGBMClassifier
    m = LGBMClassifier(**LGBM_PARAMS)
    m.fit(X[FEATURE_NAMES], y.astype(int))
    return lambda T: m.predict_proba(T[FEATURE_NAMES])[:, 1]


def _lojistik(X, y):
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler
    m = make_pipeline(StandardScaler(), LogisticRegression(C=0.05, max_iter=2000, random_state=42))
    m.fit(X[FEATURE_NAMES], y.astype(int))
    return lambda T: m.predict_proba(T[FEATURE_NAMES])[:, 1]


# (ad, eğitim çerçevesi anahtarı, test çerçevesi anahtarı, etiket türü, model)
VARYANTLAR = [
    ("A · mevcut",          "A_egitim", "sira_nw", "mutlak", _lgbm),
    ("B · ısınmasız",       "sira_nw",  "sira_nw", "mutlak", _lgbm),
    ("C · ham ikili",       "ham_nw",   "ham_nw",  "mutlak", _lgbm),
    ("D · göreli etiket",   "ham_nw",   "ham_nw",  "goreli", _lgbm),
    ("E · lojistik göreli", "ham_nw",   "ham_nw",  "goreli", _lojistik),
]


# ── Walk-forward ─────────────────────────────────────────────────────────────

def calistir(data: pd.DataFrame) -> dict:
    nw_rows = data[~data["isinma"]].copy()
    # Göreli etiket: 10 günlük getiri o günün medyanının üstünde mi (ısınma dışı evrende)
    nw_rows["goreli"] = (nw_rows["ileri"] >
                         nw_rows.groupby("date")["ileri"].transform("median")).astype(int)

    cerceve = {
        # A: üretimdeki gibi — ısınma dahil tüm satırlar, o günün TÜM satırları arasında sıra
        "A_egitim": sirala(data),
        # B ve A'nın testi: ısınma dışı satırlar, kendi aralarında sıra (canlıdaki evren)
        "sira_nw":  sirala(nw_rows),
        "ham_nw":   sirala(nw_rows, ham=HAM_OZELLIKLER),
    }
    for k in ("sira_nw", "ham_nw"):
        cerceve[k]["goreli"] = nw_rows["goreli"].values

    n_sembol = data["symbol"].nunique()
    gunluk_n = nw_rows.groupby("date")["symbol"].nunique()
    hazir = gunluk_n[gunluk_n >= EVREN_ORANI * n_sembol]
    if hazir.empty:
        return {"hata": "evrenin %90'ı hiçbir gün ısınmayı bitirmemiş"}
    t0 = hazir.index.min()
    son = nw_rows["date"].max()
    kesim = t0 + pd.Timedelta(days=ILK_EGITIM_GUN)
    bosluk, adim = pd.Timedelta(days=BOSLUK_GUN), pd.Timedelta(days=TEST_GUN)
    print(f"[faz3] ısınma bitişi {t0.date()}, ilk test {(kesim + bosluk).date()}, son {son.date()}", flush=True)

    tahmin = {ad: [] for ad, *_ in VARYANTLAR}
    adim_no = 0
    while kesim + bosluk < son:
        t_bas, t_bit = kesim + bosluk, kesim + bosluk + adim
        adim_no += 1
        print(f"[faz3] adım {adim_no}: eğitim ≤ {kesim.date()}, test {t_bas.date()}→{t_bit.date()}", flush=True)
        for ad, egitim_k, test_k, etiket, model in VARYANTLAR:
            E = cerceve[egitim_k]
            E = E[E["date"] <= kesim]
            if etiket == "mutlak":
                E = E[E["label"] >= 0]
                y = E["label"]
            else:
                y = E["goreli"]
            T = cerceve[test_k]
            T = T[(T["date"] > t_bas) & (T["date"] <= t_bit)]
            if len(E) < 2000 or len(T) < 100:
                continue
            skor = model(E, y)
            tahmin[ad].append(pd.DataFrame({
                "date": T["date"].values, "symbol": T["symbol"].values,
                "skor": skor(T), "ileri": T["ileri"].values,
            }))
        kesim += adim

    sonuc, gunluk_hepsi = [], []
    for ad, *_ in VARYANTLAR:
        if not tahmin[ad]:
            continue
        P = pd.concat(tahmin[ad], ignore_index=True)
        g = gunluk_olcutler(P)
        g["varyant"] = ad
        gunluk_hepsi.append(g)
        sonuc.append(ozet(ad, P, g))
    return {"t0": str(t0.date()), "adim": adim_no, "varyantlar": sonuc,
            "gunluk": pd.concat(gunluk_hepsi, ignore_index=True) if gunluk_hepsi else None}


def gunluk_olcutler(P: pd.DataFrame) -> pd.DataFrame:
    satirlar = []
    for d, g in P.groupby("date"):
        if len(g) < EN_AZ_GUNLUK_SEMBOL:
            continue
        n10 = max(1, int(round(len(g) * 0.10)))
        satirlar.append({
            "date": d,
            "spearman": g["skor"].corr(g["ileri"], method="spearman"),
            "fazla10": g.nlargest(n10, "skor")["ileri"].mean() - g["ileri"].mean(),
            "ort_skor": g["skor"].mean(),
            "piyasa": g["ileri"].mean(),
            "al_payi": float((g["skor"] >= BUY_THRESHOLD_A).mean()),
            "al_fazla": (g.loc[g["skor"] >= BUY_THRESHOLD_A, "ileri"].mean()
                         - g.loc[g["skor"] < BUY_THRESHOLD_A, "ileri"].mean()),
        })
    return pd.DataFrame(satirlar).sort_values("date").reset_index(drop=True)


def ozet(ad: str, P: pd.DataFrame, g: pd.DataFrame) -> dict:
    sp, fz = nw(g["spearman"]), nw(g["fazla10"])
    yari = len(g) // 2
    gecer = bool(
        sp["ort"] is not None and sp["ort"] > 0 and sp["t"] >= ESIK_SPEARMAN_T
        and fz["ort"] is not None and fz["ort"] > ESIK_FAZLA and fz["t"] >= ESIK_FAZLA_T)
    return {
        "varyant": ad,
        "n_test_satir": int(len(P)),
        "n_gun": int(len(g)),
        "spearman": sp,
        "en_iyi_10_fazla": fz,
        "gecer": gecer,
        "tani": {
            "gunluk_ort_skor_std": round(float(g["ort_skor"].std()), 4),
            "gunluk_ort_skor_piyasa_kor": round(float(g["ort_skor"].corr(g["piyasa"])), 3),
            "al_payi_ort": round(float(g["al_payi"].mean()), 3),
            "al_payi_std": round(float(g["al_payi"].std()), 3),
            "al_fazla_ayni_gun": nw(g["al_fazla"].dropna()),
        },
        "saglamlik": {
            "ilk_yari_spearman": nw(g["spearman"].iloc[:yari]),
            "ikinci_yari_spearman": nw(g["spearman"].iloc[yari:]),
        },
    }


def main():
    basla = time.time()
    data = veri_hazirla()
    r = calistir(data)
    gunluk = r.pop("gunluk", None)
    gecenler = [v["varyant"] for v in r.get("varyantlar", []) if v["gecer"]]
    cikti = {
        "hesaplandi": datetime.datetime.now().isoformat(timespec="seconds"),
        "protokol": "docs/PLAN_2026-10.md §4c (sonuçlardan önce yazıldı)",
        "esikler": {"spearman_nw_t": ESIK_SPEARMAN_T, "en_iyi_10_fazla": ESIK_FAZLA,
                    "en_iyi_10_nw_t": ESIK_FAZLA_T, "nw_gecikme": NW_GECIKME},
        "veri": {"yil": YIL, "satir": int(len(data)), "sembol": int(data["symbol"].nunique()),
                 "isinma_satir": int(data["isinma"].sum()),
                 "atlanan": data.attrs.get("atlanan", [])},
        **r,
        "gecenler": gecenler,
        "karar": ("hiçbir varyant geçmedi — model 'seçici' iddiasını bırakır; canlı model değişmez"
                  if not gecenler else
                  f"geçen: {', '.join(gecenler)} — ikinci doğrulama turu (farklı tohum + son 12 ay) gerekir"),
        "sure_dk": round((time.time() - basla) / 60, 1),
    }
    ML_DIR.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(json.dumps(cikti, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    if gunluk is not None:
        gunluk.to_csv(GUNLUK_FILE, index=False)
    print(json.dumps({k: cikti[k] for k in ("gecenler", "karar", "sure_dk")}, ensure_ascii=False), flush=True)
    for v in cikti.get("varyantlar", []):
        print(f"  {v['varyant']:<22} Spearman {v['spearman']['ort']} (t {v['spearman']['t']}) | "
              f"en iyi %10 fazla {v['en_iyi_10_fazla']['ort']} (t {v['en_iyi_10_fazla']['t']}) | "
              f"geçer={v['gecer']}", flush=True)


if __name__ == "__main__":
    main()
