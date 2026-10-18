"""
SerInvest — D modeli gölge sınavı (ileriye dönük, karara KARIŞMAZ)
=================================================================
Protokol docs/PLAN_2026-10.md §4e'de, ilk kayıttan ÖNCE yazıldı.

Faz 3 deneyinde (§4d) en iyi aday D "göreli etiket" oldu ama ikinci ölçütü
kılpayı kaçırdı (en iyi %10 fazlası t 1,96 < 2,0). Aynı veride eşiği esnetmek
yerine D yeni veride sınanır:

  • Model 18.10.2026'da BİR KEZ eğitilir ve dondurulur (`egit`).
  • Her akşam şampiyonun tahmin ürettiği bardan D skoru kaydedilir
    (`kaydet_gun`, ml_live analiz döngüsü çağırır).
  • Getiri, şampiyonun değerlendirmesinden (predictions.csv `eval`) alınır —
    aynı (sembol, bar günü) satırı, aynı 10 günlük kapanış getirisi.
  • `rapor` ileri dönemi ve birleşik seriyi (geçmiş sınav + ileri) ölçer;
    60 sınav gününden önce hüküm vermez.

Hiçbir tavsiyeye, portföye ya da kalibrasyona dokunmaz.

Eğitim:  docker compose exec ai-oracle-service python -m ml.golge_sinav egit
Rapor:   docker compose exec ai-oracle-service python -m ml.golge_sinav rapor
"""
from __future__ import annotations

import csv
import datetime
import json
import sys

import numpy as np
import pandas as pd

from ml.config import FEATURE_NAMES, LGBM_PARAMS, ML_DIR, PREDICTION_LOG
# Sınanan tarifle BİREBİR aynı olsun diye veri hazırlığı ve dönüşüm deneyden alınır.
from ml.experiment_faz3 import (GUNLUK_FILE as GECMIS_GUNLUK_FILE, HAM_OZELLIKLER,
                                gunluk_olcutler, nw, sirala, veri_hazirla)

MODEL_FILE = ML_DIR / "golge_d.joblib"
META_FILE = ML_DIR / "golge_d_meta.json"
LOG_FILE = ML_DIR / "golge_d.csv"
RAPOR_FILE = ML_DIR / "golge_d_rapor.json"

LOG_ALANLARI = ["bar_gunu", "symbol", "skor", "kayit"]
GECMIS_VARYANT = "D · göreli etiket"

# ── Protokol §4e ─────────────────────────────────────────────────────────────
EN_AZ_SINAV_GUNU = 60
EN_AZ_GUNLUK_SEMBOL = 20
ESIK_SPEARMAN_T = 2.5
ESIK_FAZLA = 0.004            # %0,40 — K9 çözülene dek iki maliyet tanımının yükseği
ESIK_FAZLA_T = 2.0


# ── Eğitim (bir kez) ─────────────────────────────────────────────────────────

def egit() -> dict:
    """D'yi tüm ısınma dışı, etiketi bilinen veriyle eğitir ve dondurur."""
    import joblib
    from lightgbm import LGBMClassifier
    from ml.config import tarif_parmak_izi

    if MODEL_FILE.exists():
        raise SystemExit(f"{MODEL_FILE.name} zaten var — protokol gereği model DONDURULDU, "
                         f"yeniden eğitilmez. Bilerek baştan başlamak için dosyayı elle kaldırın.")
    data = veri_hazirla()
    nw_rows = data[~data["isinma"]].copy()
    nw_rows["goreli"] = (nw_rows["ileri"] >
                         nw_rows.groupby("date")["ileri"].transform("median")).astype(int)
    X = sirala(nw_rows, ham=HAM_OZELLIKLER)
    m = LGBMClassifier(**LGBM_PARAMS)
    m.fit(X[FEATURE_NAMES], nw_rows["goreli"].astype(int))
    joblib.dump(m, MODEL_FILE)
    meta = {
        "egitildi": datetime.datetime.now().isoformat(timespec="seconds"),
        "protokol": "docs/PLAN_2026-10.md §4e",
        "tarif": "D · göreli etiket (§4c)",
        "temel_tarif_izi": tarif_parmak_izi(),
        "ham_ozellikler": HAM_OZELLIKLER,
        "n_satir": int(len(nw_rows)),
        "tarih_min": str(nw_rows["date"].min().date()),
        "tarih_max": str(nw_rows["date"].max().date()),
        "n_sembol": int(nw_rows["symbol"].nunique()),
        "donduruldu": True,
    }
    META_FILE.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[gölge] D eğitildi ve donduruldu: {meta['n_satir']} satır, "
          f"{meta['tarih_min']} → {meta['tarih_max']}", flush=True)
    return meta


# ── Günlük kayıt ─────────────────────────────────────────────────────────────

_MODEL = None


def _model():
    global _MODEL
    if _MODEL is None and MODEL_FILE.exists():
        import joblib
        _MODEL = joblib.load(MODEL_FILE)
    return _MODEL


def donustur(ham: dict[str, dict]) -> pd.DataFrame:
    """{sembol: ham özellikler} → D'nin girdisi: gün içi sıra, ikili özellikler ham."""
    df = pd.DataFrame.from_dict(ham, orient="index")
    for c in FEATURE_NAMES:
        if c not in df.columns:
            df[c] = np.nan
    df = df[FEATURE_NAMES].astype(float)
    df["date"] = "bugun"
    out = sirala(df, ham=HAM_OZELLIKLER)
    return out[FEATURE_NAMES]


def _mevcut_anahtarlar() -> set[tuple[str, str]]:
    if not LOG_FILE.exists():
        return set()
    with open(LOG_FILE, encoding="utf-8") as f:
        return {(r["bar_gunu"], r["symbol"]) for r in csv.DictReader(f)}


def kaydet_gun(ham_ozellikler: dict[str, dict], bar_gunleri: dict[str, str]) -> int:
    """
    Bu turda tahmini üretilen hisseler için D skorlarını kaydeder.
    Aynı (bar günü, sembol) ikinci kez yazılmaz. Model yoksa sessizce 0.
    """
    model = _model()
    if model is None or not ham_ozellikler:
        return 0
    mevcut = _mevcut_anahtarlar()
    gruplar: dict[str, list[str]] = {}
    for sym, gun in bar_gunleri.items():
        if gun and sym in ham_ozellikler:
            gruplar.setdefault(gun, []).append(sym)

    yeni = []
    simdi = datetime.datetime.utcnow().isoformat(timespec="seconds")
    for gun, semboller in gruplar.items():
        if len(semboller) < EN_AZ_GUNLUK_SEMBOL:
            continue      # kesitsel sıra anlamlı olsun — evrenin çoğu gerekli
        X = donustur({s: ham_ozellikler[s] for s in semboller})
        skor = model.predict_proba(X)[:, 1]
        for sym, s in zip(X.index, skor):
            if (gun, sym) not in mevcut:
                yeni.append({"bar_gunu": gun, "symbol": sym, "skor": round(float(s), 5), "kayit": simdi})

    if yeni:
        ML_DIR.mkdir(parents=True, exist_ok=True)
        baslik = not LOG_FILE.exists()
        with open(LOG_FILE, "a", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=LOG_ALANLARI)
            if baslik:
                w.writeheader()
            w.writerows(yeni)
    return len(yeni)


# ── Rapor ────────────────────────────────────────────────────────────────────

def _ileri_cerceve() -> pd.DataFrame:
    """Gölge skorları + şampiyonun aynı satırlardaki p_up ve gerçekleşen getirisi."""
    if not LOG_FILE.exists() or not PREDICTION_LOG.exists():
        return pd.DataFrame()
    g = pd.read_csv(LOG_FILE, dtype={"bar_gunu": str, "symbol": str})
    p = pd.read_csv(PREDICTION_LOG, dtype=str)
    p = p[p["bar_gunu"].fillna("").str.len() > 0]
    p = p[p["eval"].fillna("").str.contains(r"\|")]
    if p.empty or g.empty:
        return pd.DataFrame()
    p["ileri"] = p["eval"].str.split("|").str[1].astype(float)
    p["p_up"] = p["p_up"].astype(float)
    j = g.merge(p[["bar_gunu", "symbol", "ileri", "p_up"]], on=["bar_gunu", "symbol"], how="inner")
    j["date"] = pd.to_datetime(j["bar_gunu"])
    return j


def _karar(ileri_D: pd.DataFrame, birlesik: pd.DataFrame, n: int) -> dict:
    sp_i, fz_i = nw(ileri_D["spearman"]), nw(ileri_D["fazla10"])
    sp_b, fz_b = nw(birlesik["spearman"]), nw(birlesik["fazla10"])
    if n < EN_AZ_SINAV_GUNU:
        return {"durum": "TOPLANIYOR", "aciklama": f"{n}/{EN_AZ_SINAV_GUNU} sınav günü — hüküm 60. günden önce verilmez"}
    sartlar = {
        "ileri_spearman_pozitif": bool(sp_i["ort"] is not None and sp_i["ort"] > 0),
        "ileri_fazla_pozitif": bool(fz_i["ort"] is not None and fz_i["ort"] > 0),
        "birlesik_spearman_t": bool(sp_b["t"] is not None and sp_b["t"] >= ESIK_SPEARMAN_T),
        "birlesik_fazla": bool(fz_b["ort"] is not None and fz_b["ort"] > ESIK_FAZLA
                                and fz_b["t"] is not None and fz_b["t"] >= ESIK_FAZLA_T),
    }
    gecti = all(sartlar.values())
    return {"durum": "GEÇTİ" if gecti else "KALDI", "sartlar": sartlar,
            "aciklama": ("üç şart da sağlandı — canlıya geçiş ayrı karardır" if gecti
                         else "şartlardan en az biri sağlanmadı — D bırakılır")}


def rapor(yaz: bool = True) -> dict:
    meta = json.loads(META_FILE.read_text(encoding="utf-8")) if META_FILE.exists() else None
    out: dict = {"hesaplandi": datetime.datetime.now().isoformat(timespec="seconds"),
                 "protokol": "docs/PLAN_2026-10.md §4e", "model": meta,
                 "kayitli_gun": 0, "sinav_gunu": 0, "esik_gun": EN_AZ_SINAV_GUNU}
    if LOG_FILE.exists():
        with open(LOG_FILE, encoding="utf-8") as f:
            out["kayitli_gun"] = len({r["bar_gunu"] for r in csv.DictReader(f)})

    j = _ileri_cerceve()
    if j.empty:
        out["karar"] = {"durum": "TOPLANIYOR", "aciklama": "henüz değerlendirilmiş gölge günü yok "
                                                           "(bir tahmin ~20 takvim günü sonra yargılanır)"}
    else:
        D = gunluk_olcutler(j[["date", "symbol", "skor", "ileri"]])
        # Şampiyon AYNI satırlarda: skor yerine p_up (karşılaştırma, karar ölçütü değil)
        S = gunluk_olcutler(j[["date", "symbol", "p_up", "ileri"]].rename(columns={"p_up": "skor"}))
        n = int(len(D))
        out["sinav_gunu"] = n
        gecmis = pd.DataFrame()
        if GECMIS_GUNLUK_FILE.exists():
            gecmis = pd.read_csv(GECMIS_GUNLUK_FILE)
            gecmis = gecmis[gecmis["varyant"] == GECMIS_VARYANT][["spearman", "fazla10"]]
        birlesik = pd.concat([gecmis, D[["spearman", "fazla10"]]], ignore_index=True)
        out.update({
            "ileri": {"D": {"spearman": nw(D["spearman"]), "en_iyi_10_fazla": nw(D["fazla10"])},
                      "sampiyon_ayni_gunler": {"spearman": nw(S["spearman"]), "en_iyi_10_fazla": nw(S["fazla10"])},
                      "ilk_gun": str(D["date"].min().date()) if n else None,
                      "son_gun": str(D["date"].max().date()) if n else None},
            "birlesik": {"gun": int(len(birlesik)),
                         "spearman": nw(birlesik["spearman"]), "en_iyi_10_fazla": nw(birlesik["fazla10"])},
            "karar": _karar(D, birlesik, n),
        })
    if yaz:
        RAPOR_FILE.write_text(json.dumps(out, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    return out


if __name__ == "__main__":
    komut = sys.argv[1] if len(sys.argv) > 1 else "rapor"
    if komut == "egit":
        egit()
    print(json.dumps(rapor(), ensure_ascii=False, indent=2, default=str))
