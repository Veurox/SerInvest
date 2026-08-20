"""
İlerleme deposu (ml/progress.py) — jeton disiplini.

Neden kritik: depo TEK slot ve birden çok yazar var (zamanlanmış döngü +
kullanıcının tetiklediği işler, ayrı thread'lerde). Jeton koruması olmadan
30 dk'lık döngü, kullanıcının başlattığı doğrulamanın göstergesini ezebilir
ve arayüz yanlış işin ilerlemesini gösterirdi.
"""
import threading

import ml.progress as progress


def _reset():
    """Her test temiz slotla başlasın — modül durumu süreç boyunca yaşar."""
    with progress._LOCK:
        progress._S.update(running=False, task=None, stage=None,
                           done=0, total=None, started_at=None, last=None)


def test_start_update_finish_roundtrip():
    _reset()
    t = progress.start("analiz")
    progress.update(t, stage="özellikler: THYAO", done=3, total=100)
    s = progress.snapshot()
    assert s["running"] and s["task"] == "analiz"
    assert s["done"] == 3 and s["total"] == 100
    progress.finish(t, True, "bitti")
    s = progress.snapshot()
    assert not s["running"]
    assert s["last"]["ok"] is True and s["last"]["task"] == "analiz"
    assert s["last"]["duration_s"] is not None


def test_stale_token_cannot_touch_new_job():
    """ESKİ işin jetonu YENİ işin göstergesine yazamaz — asıl koruma bu."""
    _reset()
    old = progress.start("analiz")
    new = progress.start("dogrulama")          # slotu devraldı
    progress.update(old, stage="hayalet", done=99, total=100)
    s = progress.snapshot()
    assert s["task"] == "dogrulama" and s["done"] == 0 and s["stage"] is None
    progress.finish(old, False, "hayalet hata")
    assert progress.snapshot()["running"]      # eski jeton kapatamadı
    progress.finish(new, True, "gerçek sonuç")
    assert progress.snapshot()["last"]["message"] == "gerçek sonuç"


def test_start_if_idle_is_polite():
    """Zamanlanmış döngü, koşan işin göstergesini ÇALMAMALI."""
    _reset()
    t = progress.start("dogrulama")
    assert progress.start_if_idle("analiz") is None     # slot dolu → kibarca çekil
    assert progress.snapshot()["task"] == "dogrulama"
    progress.finish(t, True, "")
    assert progress.start_if_idle("analiz") is not None  # slot boş → alabilir


def test_none_token_is_noop():
    """start_if_idle None dönünce çağıran update/finish'i yine de çağırabilir —
    hepsi sessizce yok sayılır, başkasının göstergesi bozulmaz."""
    _reset()
    t = progress.start("terfi")
    progress.update(None, stage="x", done=5)
    progress.finish(None, True, "x")
    s = progress.snapshot()
    assert s["running"] and s["task"] == "terfi" and s["done"] == 0
    progress.finish(t, True, "")


def test_fail_running_only_matching_task():
    """Jetonsuz acil kapatma yalnız AYNI görevi kapatabilir."""
    _reset()
    progress.start("dogrulama")
    progress.fail_running("analiz", "alakasız hata")     # farklı görev → dokunma
    assert progress.snapshot()["running"]
    progress.fail_running("dogrulama", "gerçek çökme")
    s = progress.snapshot()
    assert not s["running"]
    assert s["last"]["ok"] is False and "çökme" in s["last"]["message"]


def test_total_none_means_uncountable():
    """Birim sayılamıyorsa total None KALIR — arayüz yüzde uydurmaz."""
    _reset()
    t = progress.start("veri-egitim")
    progress.update(t, stage="veri seti kuruluyor")
    s = progress.snapshot()
    assert s["total"] is None and s["stage"] == "veri seti kuruluyor"
    progress.finish(t, True, "")


def test_concurrent_writers_do_not_corrupt():
    """İki thread aynı anda yazarsa depo tutarlı kalmalı (kilit sınaması)."""
    _reset()
    t = progress.start("analiz")

    def spam(tok, n):
        for i in range(n):
            progress.update(tok, done=i, total=n)

    threads = [threading.Thread(target=spam, args=(t, 200)) for _ in range(4)]
    for th in threads: th.start()
    for th in threads: th.join()
    s = progress.snapshot()
    assert s["running"] and 0 <= s["done"] <= 200 and s["total"] == 200
    progress.finish(t, True, "")
