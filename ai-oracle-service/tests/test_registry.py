"""
Model sürüm defteri — arşivleme, atomik yazım, geri alma (Katman D1).

Neden burası: şampiyon yedeksiz üzerine yazılıyordu. Terfi eden rakip canlıda
kötü çıkarsa dönüş yoktu. 08/2026'da terfi terazisi bozukken sahte bir
"şampiyon %73" ölçümü vardı — o rakip terfi etseydi eskiye dönemezdik.
"""
import json

import joblib
import pytest

import ml.registry as registry


class FakeModel:
    """joblib ile yazılıp okunabilen, kimliği ayırt edilebilir sahte model."""
    def __init__(self, tag):
        self.tag = tag

    def __eq__(self, other):
        return isinstance(other, FakeModel) and other.tag == self.tag


@pytest.fixture
def reg(tmp_path, monkeypatch):
    """Defteri tamamen tmp_path'e taşır — canlı ml_data'ya ASLA dokunulmaz."""
    ml_dir = tmp_path / "ml_v3"
    ml_dir.mkdir(parents=True)
    monkeypatch.setattr(registry, "ML_DIR", ml_dir)
    monkeypatch.setattr(registry, "CHAMPION_FILE", ml_dir / "champion.joblib")
    monkeypatch.setattr(registry, "META_FILE", ml_dir / "champion_meta.json")
    monkeypatch.setattr(registry, "VERSIONS_DIR", ml_dir / "versions")
    monkeypatch.setattr(registry, "INDEX_FILE", ml_dir / "versions" / "index.jsonl")
    return registry


def _set_champion(reg, tag, meta=None):
    reg.dump_atomic(FakeModel(tag), reg.CHAMPION_FILE)
    if meta is not None:
        reg.META_FILE.write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")


# ── Atomik model yazımı ──────────────────────────────────────────────────────

def test_dump_atomic_roundtrip(reg):
    reg.dump_atomic(FakeModel("v1"), reg.CHAMPION_FILE)
    assert joblib.load(reg.CHAMPION_FILE) == FakeModel("v1")


def test_dump_atomic_leaves_no_temp_files(reg):
    reg.dump_atomic(FakeModel("v1"), reg.CHAMPION_FILE)
    assert [f.name for f in reg.ML_DIR.iterdir() if f.name.startswith(".tmp_")] == []


def test_failed_dump_keeps_old_model_loadable(reg, monkeypatch):
    """
    Yazım ortasında patlarsa ESKİ model yüklenebilir kalmalı.
    joblib.dump doğrudan hedefe yazsaydı burada yarım dosya kalırdı ve
    sistem açılışta modelsiz kalırdı.
    """
    _set_champion(reg, "iyi")

    def boom(*a, **k):
        raise RuntimeError("yazım ortasında çöktü")
    monkeypatch.setattr(registry.joblib, "dump", boom)

    with pytest.raises(Exception):
        reg.dump_atomic(FakeModel("bozuk"), reg.CHAMPION_FILE)

    assert joblib.load(reg.CHAMPION_FILE) == FakeModel("iyi")
    assert [f.name for f in reg.ML_DIR.iterdir() if f.name.startswith(".tmp_")] == []


# ── Arşivleme ────────────────────────────────────────────────────────────────

def test_archive_returns_none_without_champion(reg):
    assert reg.archive_current("test") is None


def test_archive_copies_model_and_meta(reg):
    _set_champion(reg, "v1", meta={"trained_at": "2026-06-24T10:00:00", "n_rows": 12345, "auc": 0.61})
    entry = reg.archive_current("terfi öncesi")

    assert entry is not None
    d = reg.VERSIONS_DIR / entry["version_id"]
    assert (d / "champion.joblib").exists()
    assert (d / "champion_meta.json").exists()
    assert joblib.load(d / "champion.joblib") == FakeModel("v1")
    # Kullanıcı sürümü tanıyabilmeli
    assert entry["trained_at"] == "2026-06-24T10:00:00"
    assert entry["n_rows"] == 12345
    assert entry["reason"] == "terfi öncesi"


def test_archive_skips_identical_model(reg):
    """Aynı model iki kez arşivlenmez — disk israfı ve kafa karışıklığı olmasın."""
    _set_champion(reg, "v1")
    assert reg.archive_current("ilk") is not None
    assert reg.archive_current("ikinci") is None
    assert len(reg.list_versions()) == 1


def test_archive_records_changed_model(reg):
    _set_champion(reg, "v1")
    reg.archive_current("ilk")
    _set_champion(reg, "v2")
    assert reg.archive_current("ikinci") is not None
    assert len(reg.list_versions()) == 2


def test_list_versions_newest_first(reg):
    for tag in ("v1", "v2", "v3"):
        _set_champion(reg, tag)
        reg.archive_current(tag)
    reasons = [e["reason"] for e in reg.list_versions()]
    assert reasons == ["v3", "v2", "v1"]


def test_list_versions_survives_corrupt_index_line(reg):
    """Defterdeki bozuk satır tüm listeyi çökertmemeli."""
    _set_champion(reg, "v1")
    reg.archive_current("iyi")
    with open(reg.INDEX_FILE, "a", encoding="utf-8") as f:
        f.write("{bozuk json\n")
    assert len(reg.list_versions()) == 1


def test_prune_keeps_only_last_n(reg, monkeypatch):
    monkeypatch.setattr(reg, "KEEP_VERSIONS", 3)
    for i in range(6):
        _set_champion(reg, f"v{i}")
        reg.archive_current(f"v{i}")
    on_disk = [d for d in reg.VERSIONS_DIR.iterdir() if d.is_dir()]
    assert len(on_disk) == 3
    # Defterde kayıt kalsa da diskte olmayanlar available=False ile işaretlenir
    assert sum(1 for e in reg.list_versions(limit=99) if e["available"]) == 3


# ── save_champion ────────────────────────────────────────────────────────────

def test_save_champion_archives_old_and_writes_new(reg):
    _set_champion(reg, "eski")
    archived = reg.save_champion(FakeModel("yeni"), reason="terfi")

    assert archived is not None
    assert joblib.load(reg.CHAMPION_FILE) == FakeModel("yeni")
    assert joblib.load(reg.VERSIONS_DIR / archived["version_id"] / "champion.joblib") == FakeModel("eski")


def test_save_champion_works_on_first_ever_train(reg):
    """İlk eğitimde arşivlenecek bir şey yok — çökmemeli."""
    assert reg.save_champion(FakeModel("ilk"), reason="ilk eğitim") is None
    assert joblib.load(reg.CHAMPION_FILE) == FakeModel("ilk")


# ── Geri alma ────────────────────────────────────────────────────────────────

def test_rollback_restores_model_and_meta(reg):
    _set_champion(reg, "iyi", meta={"trained_at": "2026-06-24", "auc": 0.61})
    v = reg.archive_current("terfi öncesi")["version_id"]

    reg.save_champion(FakeModel("kotu"), reason="terfi")
    reg.META_FILE.write_text(json.dumps({"trained_at": "2026-08-02", "auc": 0.52}), encoding="utf-8")

    res = reg.rollback(v)
    assert res["ok"] is True
    assert joblib.load(reg.CHAMPION_FILE) == FakeModel("iyi")
    assert json.loads(reg.META_FILE.read_text(encoding="utf-8"))["trained_at"] == "2026-06-24"


def test_rollback_is_itself_reversible(reg):
    """
    Asıl güvence: yanlış sürüme dönülse bile çıkış yolu var.
    Geri alma öncesi mevcut şampiyon da arşivlenir.
    """
    _set_champion(reg, "A")
    va = reg.archive_current("A")["version_id"]
    reg.save_champion(FakeModel("B"), reason="terfi")

    reg.rollback(va)                                  # A'ya dön
    assert joblib.load(reg.CHAMPION_FILE) == FakeModel("A")

    vb = next(e["version_id"] for e in reg.list_versions()
              if e.get("available") and e["version_id"] != va
              and joblib.load(reg.VERSIONS_DIR / e["version_id"] / "champion.joblib") == FakeModel("B"))
    reg.rollback(vb)                                  # fikir değişti → B'ye dön
    assert joblib.load(reg.CHAMPION_FILE) == FakeModel("B")


def test_rollback_rejects_unknown_version(reg):
    _set_champion(reg, "v1")
    res = reg.rollback("olmayan-surum")
    assert res["ok"] is False and "bulunamadı" in res["error"]
    assert joblib.load(reg.CHAMPION_FILE) == FakeModel("v1")


def test_rollback_rejects_corrupt_archive_without_touching_live(reg):
    """
    Bozuk arşiv canlıya ALINMAMALI — önce yüklenebilirliği doğrulanır.
    Aksi hâlde geri alma sistemi tamamen modelsiz bırakabilirdi.
    """
    _set_champion(reg, "iyi")
    v = reg.archive_current("arşiv")["version_id"]
    (reg.VERSIONS_DIR / v / "champion.joblib").write_bytes(b"bu bir joblib degil")

    res = reg.rollback(v)
    assert res["ok"] is False and "yüklenemedi" in res["error"]
    assert joblib.load(reg.CHAMPION_FILE) == FakeModel("iyi")   # canlı sağlam


def test_rollback_logged_in_index(reg):
    _set_champion(reg, "A")
    v = reg.archive_current("A")["version_id"]
    reg.save_champion(FakeModel("B"), reason="terfi")
    reg.rollback(v)

    entries = reg.list_versions(limit=99)
    assert any(e.get("restored_from") == v for e in entries), "geri alma deftere yazılmadı"
