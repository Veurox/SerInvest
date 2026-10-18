"""
Tarif parmak izi ve I15 (18.10.2026).

Kalibratör tarifin walk-forward sınavından kurulur; aynı tarifle yeniden
eğitilen şampiyon için geçerli kalır, tarif değişirse geçersizdir. Bu testler
izin kararlı olduğunu, tarif değişince değiştiğini ve öz denetimin üç durumu
ayırdığını sınar.
"""
import json

import ml.config as cfg
import selftest


def test_iz_kararli_ve_kisa():
    a, b = cfg.tarif_parmak_izi(), cfg.tarif_parmak_izi()
    assert a == b and len(a) == 12


def test_ozellik_degisince_iz_degisir(monkeypatch):
    once = cfg.tarif_parmak_izi()
    monkeypatch.setattr(cfg, "FEATURE_NAMES", list(cfg.FEATURE_NAMES)[:-1])
    assert cfg.tarif_parmak_izi() != once


def test_lgbm_ayari_degisince_iz_degisir(monkeypatch):
    once = cfg.tarif_parmak_izi()
    monkeypatch.setattr(cfg, "LGBM_PARAMS", dict(cfg.LGBM_PARAMS, num_leaves=63))
    assert cfg.tarif_parmak_izi() != once


def test_calisma_ayari_izi_degistirmez(monkeypatch):
    """İş parçacığı sayısı modelin öğrendiğini değiştirmez — iz değişmemeli."""
    once = cfg.tarif_parmak_izi()
    monkeypatch.setattr(cfg, "LGBM_PARAMS", dict(cfg.LGBM_PARAMS, n_jobs=2))
    assert cfg.tarif_parmak_izi() == once


def _kunyeler(tmp_path, monkeypatch, kal_tarif, sam_tarif):
    kal = tmp_path / "calibrator_meta.json"
    sam = tmp_path / "champion_meta.json"
    kal.write_text(json.dumps({"fitted_at": "2026-09-25", **({"tarif": kal_tarif} if kal_tarif else {})}))
    sam.write_text(json.dumps({"trained_at": "2026-09-04", **({"tarif": sam_tarif} if sam_tarif else {})}))
    monkeypatch.setattr(selftest, "CALIBRATOR_META_FILE", kal)
    monkeypatch.setattr(selftest, "META_FILE", sam)


def test_i15_uyumlu(tmp_path, monkeypatch):
    iz = cfg.tarif_parmak_izi()
    _kunyeler(tmp_path, monkeypatch, iz, iz)
    assert selftest.i15_recipe_matches(None)["status"] == "PASS"


def test_i15_kalibrator_farkli_tarif_fail(tmp_path, monkeypatch):
    _kunyeler(tmp_path, monkeypatch, "eskitarif000", cfg.tarif_parmak_izi())
    assert selftest.i15_recipe_matches(None)["status"] == "FAIL"


def test_i15_sampiyon_eski_tarif_warn(tmp_path, monkeypatch):
    _kunyeler(tmp_path, monkeypatch, cfg.tarif_parmak_izi(), "eskitarif000")
    assert selftest.i15_recipe_matches(None)["status"] == "WARN"


def test_i15_iz_yoksa_skip(tmp_path, monkeypatch):
    _kunyeler(tmp_path, monkeypatch, None, None)
    assert selftest.i15_recipe_matches(None)["status"] == "SKIP"
