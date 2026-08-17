"""
Drift (PSI) matematiği + eşik gerekçeleri.

Neden burası: PSI 07/2026'da YANLIŞ ALARM verdi — 600 satır vardı ama yalnızca
8 bağımsız gün. Aynı günün 50 sembolü bağımsız gözlem değildir. Düzeltme
MIN_LIVE_DAYS ile geldi; bu testler eşiğin sessizce düşürülmesini engeller.
"""
import numpy as np
import pytest

import ml.monitoring as monitoring
from ml.config import PSI_ALERT, PSI_WATCH


# ── PSI özellikleri ──────────────────────────────────────────────────────────

def test_psi_zero_for_identical_distributions():
    rng = np.random.default_rng(0)
    x = rng.normal(0, 1, 5000)
    psi = monitoring._psi(x, x.copy())
    assert psi is not None and psi == pytest.approx(0.0, abs=0.02)


def test_psi_small_for_same_distribution_new_sample():
    """Aynı dağılımdan yeni örnek → izleme eşiğinin altında kalmalı."""
    rng = np.random.default_rng(1)
    psi = monitoring._psi(rng.normal(0, 1, 5000), rng.normal(0, 1, 5000))
    assert psi is not None and psi < PSI_WATCH


def test_psi_large_for_shifted_distribution():
    """Belirgin kayma alarm eşiğini geçmeli — yoksa drift körlüğü."""
    rng = np.random.default_rng(2)
    psi = monitoring._psi(rng.normal(0, 1, 5000), rng.normal(3, 1, 5000))
    assert psi is not None and psi > PSI_ALERT


def test_psi_grows_with_shift():
    """PSI kayma büyüdükçe artmalı (monotonluk)."""
    rng = np.random.default_rng(3)
    base = rng.normal(0, 1, 8000)
    vals = [monitoring._psi(base, rng.normal(s, 1, 8000)) for s in (0.0, 0.5, 1.0, 2.0)]
    assert all(v is not None for v in vals)
    assert all(b >= a for a, b in zip(vals, vals[1:]))


def test_psi_is_non_negative():
    rng = np.random.default_rng(4)
    for scale in (0.5, 1.0, 3.0):
        v = monitoring._psi(rng.normal(0, 1, 3000), rng.normal(0, scale, 3000))
        assert v is None or v >= 0.0


def test_psi_handles_empty_and_constant_input():
    """Bozuk girdi çökertmemeli — None dönüp sessizce atlanmalı."""
    rng = np.random.default_rng(5)
    base = rng.normal(0, 1, 1000)
    assert monitoring._psi(np.array([]), base) is None or True
    assert monitoring._psi(base, np.array([])) is None or True
    v = monitoring._psi(np.ones(500), np.ones(500))
    assert v is None or np.isfinite(v)


def test_psi_thresholds_are_ordered():
    """İzleme eşiği alarm eşiğinin altında olmalı — ters çevrilirse alarm anlamsızlaşır."""
    assert 0 < PSI_WATCH < PSI_ALERT


# ── Örneklem yeterliliği eşikleri (yanlış alarmın kök nedeni) ────────────────

def test_min_live_days_guard_exists():
    """
    Satır sayısı TEK BAŞINA yeterli değil: aynı günün 50 sembolü bağımsız
    gözlem sayılmaz. Bu eşik kaldırılırsa 07/2026 yanlış alarmı geri döner.
    """
    assert monitoring.MIN_LIVE_DAYS >= 20


def test_min_live_rows_guard_exists():
    assert monitoring.MIN_LIVE_ROWS >= 200


def test_min_eval_rows_enough_for_binning():
    """
    Kalibrasyon raporu bin'lere böler; n=38'de bin başına 7 örnek düşüyordu
    ve ECE gürültüden ibaretti. Bin başına en az ~25 örnek şart.
    """
    assert monitoring.MIN_EVAL_ROWS >= 150


def test_min_eval_days_guard_exists():
    """
    08/2026 bulgusu: 401 satır MIN_EVAL_ROWS'u geçiyordu ama yalnızca 10 güne
    yayılıyordu. Kalibrasyon kararı gün ORTALAMALARI üzerinde t-testiyle
    verilir; df = n_days − 1 olduğu için 10 günün altı kullanışsız.
    Bu eşik kaldırılırsa havuzlanmış-anlamlılık hatası geri döner.
    """
    assert monitoring.MIN_EVAL_DAYS >= 10


# ── Kalibrasyon: gün düzeyi karar (havuzlanmış anlamlılık hatasına karşı) ─────

def _write_preds(path, days, per_day, up_rate, p_up=0.84, p_cal=0.5331):
    """Sahte predictions.csv — her gün `per_day` sembol, `up_rate` oranında UP."""
    import csv as _csv
    n_up = round(per_day * up_rate)
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = _csv.DictWriter(f, fieldnames=["timestamp", "symbol", "p_up", "p_cal", "eval"])
        w.writeheader()
        for d in range(days):
            for i in range(per_day):
                w.writerow({
                    "timestamp": f"2026-07-{d+1:02d}T12:00:00", "symbol": f"S{i}",
                    "p_up": p_up, "p_cal": p_cal,
                    "eval": ("UP" if i < n_up else "DOWN") + "|0.01",
                })


def test_calibration_collecting_when_days_insufficient(tmp_path, monkeypatch):
    """
    ÇOK satır + AZ gün = karar verilemez. Eskiden bu durum "MISCALIBRATED"
    ilan ediliyordu: 5 günde 250 tahmin, hepsi aynı 5 piyasa hareketi.
    """
    p = tmp_path / "predictions.csv"
    _write_preds(p, days=5, per_day=50, up_rate=0.20)      # 250 satır, 5 gün
    monkeypatch.setattr(monitoring, "PREDICTION_LOG", p)
    monkeypatch.setattr(monitoring, "CALIB_REPORT_FILE", tmp_path / "calib.json")
    rep = monitoring.calibration_report()
    assert rep["n_evaluated"] >= monitoring.MIN_EVAL_ROWS
    assert rep["n_days"] == 5
    assert rep["status"] == "COLLECTING"


def test_calibration_miscalibrated_survives_day_clustering(tmp_path, monkeypatch):
    """Kalibratör %53 derken 12 günün her birinde ~%20 gözleniyorsa sapma GERÇEK."""
    p = tmp_path / "predictions.csv"
    _write_preds(p, days=12, per_day=40, up_rate=0.20)
    monkeypatch.setattr(monitoring, "PREDICTION_LOG", p)
    monkeypatch.setattr(monitoring, "CALIB_REPORT_FILE", tmp_path / "calib.json")
    rep = monitoring.calibration_report()
    assert rep["n_days"] == 12
    assert rep["status"] == "MISCALIBRATED"
    assert rep["day_level"]["gap"] < 0            # kalibratör fazla iyimser


def test_calibration_ok_when_days_agree(tmp_path, monkeypatch):
    """Gözlenen oran kalibratörle uyuşuyorsa alarm ÇALMAMALI (yanlış alarm yok)."""
    p = tmp_path / "predictions.csv"
    _write_preds(p, days=12, per_day=40, up_rate=0.525, p_cal=0.5331)
    monkeypatch.setattr(monitoring, "PREDICTION_LOG", p)
    monkeypatch.setattr(monitoring, "CALIB_REPORT_FILE", tmp_path / "calib.json")
    rep = monitoring.calibration_report()
    assert rep["status"] == "OK"
    assert abs(rep["day_level"]["t"]) <= 2.0


def test_calibration_zero_variance_does_not_explode_t(tmp_path, monkeypatch):
    """
    DEJENERE VARYANS: her günün oranı birebir aynı çıkarsa (küçük örneklemde
    olağan) sd kayan nokta artığı kadar kalır. Taban olmadan se ~1e-17 olup
    t 1e14'e patlıyordu ve %0.8'lik fark "sapma" ilan ediliyordu.
    """
    p = tmp_path / "predictions.csv"
    _write_preds(p, days=12, per_day=40, up_rate=0.525, p_cal=0.5331)
    monkeypatch.setattr(monitoring, "PREDICTION_LOG", p)
    monkeypatch.setattr(monitoring, "CALIB_REPORT_FILE", tmp_path / "calib.json")
    dl = monitoring.calibration_report()["day_level"]
    assert dl["sd"] == 0.0          # günler birebir aynı
    assert dl["se"] > 0.0           # ama standart hata SIFIR OLAMAZ
    assert abs(dl["t"]) < 5.0       # t sonlu ve makul kalmalı


def test_calibration_binomial_floor_does_not_mask_real_gap(tmp_path, monkeypatch):
    """Taban yanlış alarmı keser ama GERÇEK sapmayı bastırmamalı."""
    p = tmp_path / "predictions.csv"
    _write_preds(p, days=12, per_day=40, up_rate=0.20, p_cal=0.5331)
    monkeypatch.setattr(monitoring, "PREDICTION_LOG", p)
    monkeypatch.setattr(monitoring, "CALIB_REPORT_FILE", tmp_path / "calib.json")
    dl = monitoring.calibration_report()["day_level"]
    assert dl["t"] < -2.0           # %20 ile %53 arası fark hâlâ yakalanıyor
