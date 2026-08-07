"""
Atomik dosya yazımı — veri bütünlüğü.

Neden burası: 07/2026'da predictions.csv'nin 3. satırında timestamp'in başındaki
"2026" kaybolmuştu (`-07-08T19:08:26`). Sebep: oku-değiştir-yaz sırasında
konteyner yeniden başladı. atomic.py bunu çözdü; bu testler çözümün
bozulmadığını garanti eder.
"""
import csv
import json

import pytest

import ml.atomic as atomic

FIELDS = ["symbol", "timestamp", "p"]
ROWS = [
    {"symbol": "ZOREN", "timestamp": "2026-07-09T19:08:26", "p": "0.53"},
    {"symbol": "THYAO", "timestamp": "2026-07-09T19:08:27", "p": "0.61"},
]


def _read(path):
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


# ── Temel yazım ──────────────────────────────────────────────────────────────

def test_write_csv_roundtrip(tmp_path):
    p = tmp_path / "predictions.csv"
    atomic.write_csv(p, FIELDS, ROWS)
    assert _read(p) == ROWS


def test_write_csv_no_blank_lines(tmp_path):
    """newline='' olmazsa Windows'ta satır aralarına boş satır girer."""
    p = tmp_path / "a.csv"
    atomic.write_csv(p, FIELDS, ROWS)
    assert "" not in p.read_text(encoding="utf-8").split("\n")[:-1]


def test_write_json_roundtrip_preserves_turkish(tmp_path):
    p = tmp_path / "rapor.json"
    data = {"durum": "İHLAL", "mesaj": "kapsam zarfı dışında", "n": 3}
    atomic.write_json(p, data)
    assert json.loads(p.read_text(encoding="utf-8")) == data


def test_creates_missing_directory(tmp_path):
    p = tmp_path / "yeni" / "alt" / "x.json"
    atomic.write_json(p, {"ok": True})
    assert p.exists()


def test_overwrite_replaces_content(tmp_path):
    p = tmp_path / "x.json"
    atomic.write_json(p, {"v": 1})
    atomic.write_json(p, {"v": 2})
    assert json.loads(p.read_text(encoding="utf-8")) == {"v": 2}


# ── Asıl mesele: hata anında hedef BOZULMAMALI ───────────────────────────────

def test_failed_write_leaves_target_untouched(tmp_path):
    """
    Yazım ortasında patlarsa ESKİ dosya aynen kalmalı — yarım dosya ASLA.
    Bu, timestamp'in başının kaybolduğu hatanın birebir testidir.
    """
    p = tmp_path / "predictions.csv"
    atomic.write_csv(p, FIELDS, ROWS)
    before = p.read_bytes()

    class Exploding(dict):
        def get(self, *a, **k):
            raise RuntimeError("yazım ortasında çöktü")

    with pytest.raises(Exception):
        atomic.write_csv(p, FIELDS, ROWS + [Exploding()])

    assert p.read_bytes() == before, "hedef dosya bozuldu"
    assert _read(p) == ROWS


def test_failed_write_cleans_temp_files(tmp_path):
    """Başarısız yazım geçici dosya bırakmamalı (disk sızıntısı)."""
    p = tmp_path / "x.json"

    class NotSerializable:
        pass

    with pytest.raises(Exception):
        atomic.write_json(p, {"bad": NotSerializable()})

    leftovers = [f.name for f in tmp_path.iterdir() if f.name.startswith(".tmp_")]
    assert leftovers == [], f"geçici dosya kaldı: {leftovers}"


def test_failed_first_write_creates_nothing(tmp_path):
    """Hedef hiç yoksa ve yazım patlarsa, yarım dosya oluşmamalı."""
    p = tmp_path / "yok.json"

    class NotSerializable:
        pass

    with pytest.raises(Exception):
        atomic.write_json(p, {"bad": NotSerializable()})
    assert not p.exists()


# ── append ───────────────────────────────────────────────────────────────────

def test_append_writes_header_once(tmp_path):
    p = tmp_path / "log.csv"
    for r in ROWS:
        atomic.append_csv_row(p, FIELDS, r)
    assert p.read_text(encoding="utf-8").count("symbol,timestamp,p") == 1
    assert _read(p) == ROWS


def test_append_to_existing_file_keeps_rows(tmp_path):
    p = tmp_path / "log.csv"
    atomic.write_csv(p, FIELDS, ROWS)
    atomic.append_csv_row(p, FIELDS, {"symbol": "ASELS", "timestamp": "2026-07-10T19:00:00", "p": "0.49"})
    rows = _read(p)
    assert len(rows) == 3 and rows[-1]["symbol"] == "ASELS"


def test_extra_keys_are_ignored_not_crash(tmp_path):
    """Şema dışı alan gelirse yazım çökmez (extrasaction='ignore')."""
    p = tmp_path / "log.csv"
    atomic.append_csv_row(p, FIELDS, {**ROWS[0], "beklenmeyen": "x"})
    assert _read(p) == [ROWS[0]]


def test_missing_keys_use_restval(tmp_path):
    p = tmp_path / "log.csv"
    atomic.write_csv(p, FIELDS, [{"symbol": "ZOREN"}], restval="")
    assert _read(p) == [{"symbol": "ZOREN", "timestamp": "", "p": ""}]
