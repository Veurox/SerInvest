"""
SerInvest — Atomik Dosya Yazımı
================================
Sorun (07/2026 denetim bulgusu): predictions.csv / meta_log.csv / feature_log.csv
"hepsini oku → hepsini yaz" deseniyle güncelleniyordu. Yazma sırasında konteyner
yeniden başlarsa dosya YARIM kalıyor — canlıda `predictions.csv` 3. satırında
timestamp'in başındaki "2026" kaybolmuştu (`-07-08T19:08:26`).

Çözüm: aynı dizine geçici dosya yaz → fsync → os.replace().
os.replace() aynı dosya sisteminde ATOMİK'tir: okuyucular ya eski ya yeni tam
dosyayı görür, asla yarısını. Sık konteyner restart'ında veri bütünlüğü korunur.
"""
import csv
import json
import os
import tempfile


def _atomic_write(path, write_fn, encoding: str = "utf-8", newline: str | None = None):
    """
    write_fn(dosya_nesnesi) ile içeriği geçici dosyaya yazar, sonra hedefe taşır.
    Hata olursa geçici dosya temizlenir, hedef DOKUNULMAZ (eski hali korunur).
    """
    path = os.fspath(path)
    directory = os.path.dirname(path) or "."
    os.makedirs(directory, exist_ok=True)

    fd, tmp = tempfile.mkstemp(dir=directory, prefix=".tmp_", suffix=".part")
    os.close(fd)
    try:
        with open(tmp, "w", encoding=encoding, newline=newline) as f:
            write_fn(f)
            f.flush()
            os.fsync(f.fileno())   # diske gerçekten insin (restart'a karşı)
        os.replace(tmp, path)      # ATOMİK takas
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def write_csv(path, fieldnames: list, rows: list, restval: str = "") -> None:
    """CSV'yi atomik yazar (başlık + satırlar)."""
    def _w(f):
        w = csv.DictWriter(f, fieldnames=fieldnames, restval=restval,
                           extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    _atomic_write(path, _w, newline="")


def write_json(path, data, indent: int = 2) -> None:
    """JSON'u atomik yazar."""
    def _w(f):
        json.dump(data, f, ensure_ascii=False, indent=indent)
    _atomic_write(path, _w)


def append_csv_row(path, fieldnames: list, row: dict) -> None:
    """
    Tek satır ekler (append). Append tek yazımda olduğu için zaten büyük ölçüde
    güvenlidir; burada sadece flush+fsync ile diske inmesi garanti edilir.
    """
    path = os.fspath(path)
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    write_header = not os.path.exists(path) or os.path.getsize(path) == 0
    with open(path, "a", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        if write_header:
            w.writeheader()
        w.writerow(row)
        f.flush()
        os.fsync(f.fileno())
