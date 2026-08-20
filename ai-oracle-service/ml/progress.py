"""
Uzun işlerin CANLI ilerlemesi — arayüzdeki ilerleme çubuğunun TEK kaynağı.
========================================================================

Neden gerçek birim: zamana göre kendiliğinden dolan çubuk kullanıcıya "bitmek
üzere" yalanı söyler. Burada done/total GERÇEK iş birimidir (sembol, adım,
pencere). Birim sayılamıyorsa total=None bırakılır ve arayüz yüzde yerine
aşama metni gösterir — bilmediğini söylemek yalan değildir.

Tek slot + jeton: aynı anda tek iş gösterilir. Her start() bir jeton üretir;
update/finish yalnız güncel jetonla çalışır. Böylece nadir çakışmada (30 dk'lık
zamanlanmış döngü, kullanıcının başlattığı işin ortasına denk gelirse) eski
işin güncellemeleri yeni işin göstergesini bozamaz. Zamanlanmış döngü
start_if_idle kullanır (kibar); kullanıcının tetiklediği işler start kullanır.

finish() son işin karnesini `last` alanına yazar — arayüz "başarılı mı,
kaç saniye sürdü" sorusuna buradan cevap verir.
"""
import datetime
import threading

_LOCK = threading.Lock()
_TOKEN = 0                      # monoton sayaç — güncel işin jetonu
_S: dict = {
    "running": False, "task": None, "stage": None,
    "done": 0, "total": None, "started_at": None,
    "last": None,   # {task, ok, message, finished_at, duration_s}
}


def start(task: str) -> int:
    """İşi başlatır ve slotu ALIR (önceki iş gösterimden düşer). Jeton döner."""
    global _TOKEN
    with _LOCK:
        _TOKEN += 1
        _S.update(running=True, task=task, stage=None, done=0, total=None,
                  started_at=datetime.datetime.utcnow().isoformat())
        return _TOKEN


def start_if_idle(task: str) -> int | None:
    """Slot boşsa alır, doluysa None döner — zamanlanmış işlerin kibar yolu.
    None alan çağıran update/finish çağırmaz (hepsi jeton istediği için
    yanlışlıkla başkasının göstergesine yazamaz)."""
    with _LOCK:
        if _S["running"]:
            return None
    return start(task)


def update(token: int | None, stage: str | None = None,
           done: int | None = None, total: int | None = None) -> None:
    if token is None:
        return
    with _LOCK:
        if token != _TOKEN or not _S["running"]:
            return              # bayat jeton — başkasının göstergesine yazma
        if stage is not None:
            _S["stage"] = stage
        if done is not None:
            _S["done"] = int(done)
        if total is not None:
            _S["total"] = int(total)


def finish(token: int | None, ok: bool, message: str = "") -> None:
    if token is None:
        return
    with _LOCK:
        if token != _TOKEN or not _S["running"]:
            return
        dur = None
        try:
            t0 = datetime.datetime.fromisoformat(_S["started_at"])
            dur = round((datetime.datetime.utcnow() - t0).total_seconds(), 1)
        except Exception:
            pass
        _S["last"] = {"task": _S["task"], "ok": bool(ok),
                      "message": str(message)[:300],
                      "finished_at": datetime.datetime.utcnow().isoformat(),
                      "duration_s": dur}
        _S.update(running=False, task=None, stage=None,
                  done=0, total=None, started_at=None)


def fail_running(task: str, message: str) -> None:
    """Verilen görev HÂLÂ koşuyor görünüyorsa başarısız olarak kapatır.
    İşçinin dışına kaçan istisnalar için: jeton işçinin yerelinde kaldığından
    çağıran (endpoint/sarmalayıcı) jetonsuz kapatma yapabilmeli. Görev adı
    eşleşmiyorsa dokunmaz — başka işin göstergesi kapatılamaz."""
    with _LOCK:
        if not _S["running"] or _S["task"] != task:
            return
        _S["last"] = {"task": task, "ok": False, "message": str(message)[:300],
                      "finished_at": datetime.datetime.utcnow().isoformat(),
                      "duration_s": None}
        _S.update(running=False, task=None, stage=None,
                  done=0, total=None, started_at=None)


def snapshot() -> dict:
    with _LOCK:
        out = dict(_S)
        out["last"] = dict(_S["last"]) if _S["last"] else None
        return out
