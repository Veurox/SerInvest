"""
D gölge sınavı (docs/PLAN_2026-10.md §4e) — ağsız, diske yalnız tmp_path.

Sınanan: dönüşüm sınanan tarifle aynı (ikili özellikler ham, diğerleri
gün içi sıra), aynı gün iki kez yazılmaz, 60 sınav gününden önce hüküm yok,
karar kuralı protokoldeki dört şartı uyguluyor.
"""
import numpy as np
import pandas as pd
import pytest

import ml.golge_sinav as gs
from ml.config import FEATURE_NAMES


def _ham(n=25, seed=0):
    rng = np.random.default_rng(seed)
    out = {}
    for i in range(n):
        f = {c: float(rng.normal()) for c in FEATURE_NAMES}
        f["above_ema200"] = float(i % 2)
        f["ema_alignment"] = float((i % 3) - 1)
        out[f"S{i:02d}"] = f
    return out


def test_donusum_ikili_ham_digerleri_sira():
    X = gs.donustur(_ham())
    assert set(X["above_ema200"].unique()) <= {0.0, 1.0}          # ham kaldı
    assert set(X["ema_alignment"].unique()) <= {-1.0, 0.0, 1.0}
    diger = [c for c in FEATURE_NAMES if c not in gs.HAM_OZELLIKLER][0]
    assert X[diger].between(0, 1).all() and X[diger].max() == 1.0  # sıraya çevrildi


class _SabitModel:
    def predict_proba(self, X):
        p = np.linspace(0.4, 0.6, len(X))
        return np.c_[1 - p, p]


@pytest.fixture
def gecici(tmp_path, monkeypatch):
    monkeypatch.setattr(gs, "LOG_FILE", tmp_path / "golge_d.csv")
    monkeypatch.setattr(gs, "RAPOR_FILE", tmp_path / "golge_d_rapor.json")
    monkeypatch.setattr(gs, "META_FILE", tmp_path / "golge_d_meta.json")
    monkeypatch.setattr(gs, "ML_DIR", tmp_path)
    monkeypatch.setattr(gs, "_MODEL", _SabitModel())
    monkeypatch.setattr(gs, "_model", lambda: gs._MODEL)
    return tmp_path


def test_ayni_gun_iki_kez_yazilmaz(gecici):
    ham = _ham()
    gunler = {s: "2026-10-20" for s in ham}
    assert gs.kaydet_gun(ham, gunler) == 25
    assert gs.kaydet_gun(ham, gunler) == 0
    assert len(pd.read_csv(gs.LOG_FILE)) == 25


def test_az_sembollu_gun_kaydedilmez(gecici):
    ham = _ham(n=10)
    assert gs.kaydet_gun(ham, {s: "2026-10-20" for s in ham}) == 0


def _seri(n, sp, fz):
    return pd.DataFrame({"spearman": [sp] * n, "fazla10": [fz] * n})


def test_60_gunden_once_hukum_yok():
    k = gs._karar(_seri(30, 0.05, 0.01), _seri(506, 0.05, 0.01), 30)
    assert k["durum"] == "TOPLANIYOR"


def test_karar_ileri_isaret_negatifse_kalir():
    rng = np.random.default_rng(1)
    ileri = pd.DataFrame({"spearman": -0.02 + rng.normal(0, 0.01, 60),
                          "fazla10": 0.005 + rng.normal(0, 0.001, 60)})
    birlesik = pd.DataFrame({"spearman": 0.06 + rng.normal(0, 0.01, 536),
                             "fazla10": 0.006 + rng.normal(0, 0.001, 536)})
    k = gs._karar(ileri, birlesik, 60)
    assert k["durum"] == "KALDI" and not k["sartlar"]["ileri_spearman_pozitif"]


def test_karar_dort_sart_saglanirsa_gecer():
    rng = np.random.default_rng(2)
    ileri = pd.DataFrame({"spearman": 0.05 + rng.normal(0, 0.01, 60),
                          "fazla10": 0.006 + rng.normal(0, 0.001, 60)})
    birlesik = pd.DataFrame({"spearman": 0.05 + rng.normal(0, 0.01, 536),
                             "fazla10": 0.006 + rng.normal(0, 0.001, 536)})
    assert gs._karar(ileri, birlesik, 60)["durum"] == "GEÇTİ"


def test_maliyet_esigi_yuksek_tanim():
    """K9 çözülene dek %0,40 — %0,30'luk fazla yetmez."""
    rng = np.random.default_rng(3)
    ileri = pd.DataFrame({"spearman": 0.05 + rng.normal(0, 0.01, 60),
                          "fazla10": 0.003 + rng.normal(0, 0.0005, 60)})
    birlesik = pd.DataFrame({"spearman": 0.05 + rng.normal(0, 0.01, 536),
                             "fazla10": 0.003 + rng.normal(0, 0.0005, 536)})
    k = gs._karar(ileri, birlesik, 60)
    assert k["durum"] == "KALDI" and not k["sartlar"]["birlesik_fazla"]


def test_rapor_sampiyon_degerlendirmesiyle_eslesir(gecici, monkeypatch):
    """Getiri şampiyonun eval'inden, (bar günü, sembol) ile; değerlendirilmemiş
    satır sayılmaz; şampiyon aynı satırlarda ölçülür."""
    ham = _ham()
    gunler = ["2026-10-20", "2026-10-21"]
    for g in gunler:
        gs.kaydet_gun(ham, {s: g for s in ham})
    satirlar = []
    for g in gunler:
        for i, s in enumerate(ham):
            ev = "" if (g == "2026-10-21") else f"UP|{(i - 12) / 1000:.4f}"
            satirlar.append({"timestamp": f"{g}T15:40:00", "symbol": s, "p_up": "0.6",
                             "bar_gunu": g, "eval": ev})
    pl = gecici / "predictions.csv"
    pd.DataFrame(satirlar).to_csv(pl, index=False)
    monkeypatch.setattr(gs, "PREDICTION_LOG", pl)
    monkeypatch.setattr(gs, "GECMIS_GUNLUK_FILE", gecici / "yok.csv")
    r = gs.rapor(yaz=False)
    assert r["kayitli_gun"] == 2
    assert r["sinav_gunu"] == 1                       # 21.10 henüz değerlendirilmedi
    assert r["ileri"]["D"]["spearman"]["n"] == 1
    assert r["karar"]["durum"] == "TOPLANIYOR"
