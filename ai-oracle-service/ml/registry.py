"""
SerInvest — Model Sürüm Defteri (Katman D1)
============================================
Sorun: `joblib.dump(model, CHAMPION_FILE)` şampiyonu YEDEKSİZ üzerine yazıyordu.

İki somut risk:
  1. **Geri dönüş yok.** Terfi eden rakip canlıda kötü çıkarsa eski şampiyon
     kalıcı olarak kayıp. 08/2026'da terfi terazisi bozukken sahte bir
     "şampiyon %73" ölçümü vardı — o rakip terfi etseydi eskiye dönemezdik.
  2. **Yazım ortasında restart.** joblib.dump doğrudan hedefe yazar; yarım
     kalan .joblib açılışta yüklenemez ve sistem modelsiz kalır
     (ml/atomic.py'nin CSV/JSON için çözdüğü sorunun aynısı).

Çözüm: her yazımdan ÖNCE mevcut şampiyon arşivlenir, yeni model geçici
dosyaya yazılıp `os.replace` ile atomik takas edilir. Arşiv `versions/`
altında, defter `versions/index.jsonl` içinde tutulur.

ML Test Score (Breck ve ark. 2017) "Model 7: modeller geri alınabilir mi?"
maddesinin karşılığıdır.
"""
import datetime
import hashlib
import json
import os
import shutil
import tempfile

import joblib

from ml.config import CHAMPION_FILE, META_FILE, ML_DIR

VERSIONS_DIR = ML_DIR / "versions"
INDEX_FILE   = VERSIONS_DIR / "index.jsonl"

# Kaç sürüm saklansın — her champion.joblib birkaç MB; 10 sürüm makul.
KEEP_VERSIONS = 10


def _now() -> str:
    return datetime.datetime.utcnow().isoformat(timespec="seconds")


def _file_hash(path) -> str:
    """Dosyanın kısa kimliği — aynı modelin iki kez arşivlenmesini önler."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()[:12]


# ── Atomik model yazımı ──────────────────────────────────────────────────────

def dump_atomic(model, path) -> None:
    """
    joblib.dump'ın atomik hâli: geçici dosyaya yaz → fsync → os.replace.
    Yazım sırasında konteyner ölürse hedef ESKİ hâlinde kalır, yarım kalmaz.
    """
    path = os.fspath(path)
    directory = os.path.dirname(path) or "."
    os.makedirs(directory, exist_ok=True)

    fd, tmp = tempfile.mkstemp(dir=directory, prefix=".tmp_", suffix=".joblib")
    os.close(fd)
    try:
        with open(tmp, "wb") as f:
            joblib.dump(model, f)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


# ── Defter ───────────────────────────────────────────────────────────────────

def _append_index(entry: dict) -> None:
    VERSIONS_DIR.mkdir(parents=True, exist_ok=True)
    with open(INDEX_FILE, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        f.flush()
        os.fsync(f.fileno())


def list_versions(limit: int = 20) -> list:
    """Arşivlenmiş sürümler — en yeni önce. Diskte karşılığı olmayanlar elenir."""
    if not INDEX_FILE.exists():
        return []
    rows = []
    for line in INDEX_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            e = json.loads(line)
        except Exception:
            continue                       # bozuk satır defteri çökertmesin
        e["available"] = (VERSIONS_DIR / e.get("version_id", "") / "champion.joblib").exists()
        rows.append(e)
    rows.reverse()
    return rows[:limit]


def _prune() -> None:
    """En eski sürümleri siler — disk sınırsız büyümesin."""
    if not VERSIONS_DIR.exists():
        return
    dirs = sorted((d for d in VERSIONS_DIR.iterdir() if d.is_dir()),
                  key=lambda d: d.name)
    for d in dirs[:-KEEP_VERSIONS]:
        shutil.rmtree(d, ignore_errors=True)


def archive_current(reason: str) -> dict | None:
    """
    Mevcut şampiyonu (+ metasını) `versions/<zaman>_<hash>/` altına kopyalar.
    Şampiyon yoksa veya aynı içerik zaten arşivliyse None döner.
    """
    if not CHAMPION_FILE.exists():
        return None

    try:
        digest = _file_hash(CHAMPION_FILE)
    except OSError:
        return None

    # Aynı model zaten arşivliyse tekrar kopyalama (disk israfı + kafa karışıklığı).
    for e in list_versions(limit=KEEP_VERSIONS):
        if e.get("hash") == digest and e.get("available"):
            return None

    stamp = datetime.datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    version_id = f"{stamp}_{digest}"
    dest = VERSIONS_DIR / version_id
    dest.mkdir(parents=True, exist_ok=True)

    shutil.copy2(CHAMPION_FILE, dest / "champion.joblib")
    meta = {}
    if META_FILE.exists():
        try:
            meta = json.loads(META_FILE.read_text(encoding="utf-8"))
            shutil.copy2(META_FILE, dest / "champion_meta.json")
        except Exception:
            meta = {}

    entry = {
        "version_id":  version_id,
        "archived_at": _now(),
        "reason":      reason,
        "hash":        digest,
        "size_bytes":  CHAMPION_FILE.stat().st_size,
        # Kullanıcının sürümü tanıyabilmesi için özet — hangi modeldi?
        "trained_at":  meta.get("trained_at"),
        "n_rows":      meta.get("n_rows"),
        "date_max":    meta.get("date_max"),
        "auc":         meta.get("auc"),
    }
    _append_index(entry)
    _prune()
    print(f"[registry] Şampiyon arşivlendi: {version_id} ({reason})")
    return entry


def save_champion(model, reason: str) -> dict | None:
    """
    Şampiyonu güvenle değiştirir: önce eskisini arşivle, sonra atomik yaz.
    `_write_meta` çağrısı ÇAĞIRANDA kalır (veri setine erişimi orada var).
    """
    archived = archive_current(reason=f"{reason} öncesi")
    ML_DIR.mkdir(parents=True, exist_ok=True)
    dump_atomic(model, CHAMPION_FILE)
    return archived


def rollback(version_id: str) -> dict:
    """
    Arşivdeki bir sürümü canlıya alır.

    Geri alma işleminin KENDİSİ de geri alınabilir: mevcut şampiyon önce
    arşivlenir. Böylece yanlış sürüme dönülse bile çıkış yolu vardır.
    """
    src = VERSIONS_DIR / version_id
    model_path = src / "champion.joblib"
    if not model_path.exists():
        return {"ok": False, "error": f"sürüm bulunamadı: {version_id}"}

    # Yüklenebilirliğini ÖNCE doğrula — bozuk dosyayı canlıya almayalım.
    try:
        model = joblib.load(model_path)
    except Exception as e:
        return {"ok": False, "error": f"sürüm yüklenemedi ({version_id}): {e}"}

    archive_current(reason=f"{version_id} sürümüne dönüş öncesi")

    dump_atomic(model, CHAMPION_FILE)
    meta_src = src / "champion_meta.json"
    if meta_src.exists():
        shutil.copy2(meta_src, META_FILE)

    _append_index({
        "version_id":  f"rollback-{datetime.datetime.utcnow().strftime('%Y%m%d-%H%M%S')}",
        "archived_at": _now(),
        "reason":      f"GERİ ALMA → {version_id}",
        "restored_from": version_id,
        "hash":        _file_hash(CHAMPION_FILE),
        "size_bytes":  CHAMPION_FILE.stat().st_size,
    })
    print(f"[registry] Geri alındı → {version_id}")
    return {"ok": True, "restored": version_id, "model": model}
