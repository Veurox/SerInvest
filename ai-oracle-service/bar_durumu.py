"""
SerInvest — Bugünün barı kullanılabilir mi?
===========================================

NEDEN VAR (16.09.2026)
Model TAMAMLANMIŞ günlük barlarla eğitildi. Canlı döngü ise indirdiği serinin
SON barını alıyordu — seans sürerken o bar yarımdır ve "kapanış" dediği şey o
anki fiyattır. Ölçüldü: 8 Eylül'de THYAO 297,75 diye loglandı, gerçek kapanış
305,00 idi (%2,38 sapma); AEFES'te %1,82.

Bu yalnız görüntü hatası değil:
  • Hedef ve stop o fiyattan ATR katı olarak hesaplanıyor — %2'lik giriş
    hatası bariyerleri kabaca bir ATR kaydırıyor.
  • RSI/EMA/ATR gibi özellikler yarım barla hesaplanıyor → eğitim/servis
    uyuşmazlığı.
  • O tahmin 10 gün sonra değerlendirilip isabet oranına yazılıyor, yani
    hata modelin karnesine de bulaşıyor.

İKİNCİ HÂL: BAR YENİ Mİ?
7 Eylül Pazartesi BIST'te bar yok, ama günlükte o güne ait 50 tahmin var.
Yani makine açıktı, döngü koştu ve ELİNDEKİ ESKİ BARI yeni bir günmüş gibi
kaydetti. Aynı bahis iki kez sayılırsa örneklem şişer ve isabet oranı yalan
söyler.

İKİSİNİN ORTAK KÖKÜ
Karar "süreç çalışıyor mu" ile veriliyordu, "elimde yeni ve tamamlanmış bar
var mı" ile değil. TEFAS zamanlamasında düzelttiğimiz hatanın aynısı
(tefas_zaman.py): ölçüt ÇALIŞMA ANI değil, VERİNİN KENDİSİ olmalı.

Bu modül saf: tarih ve bayrak alır, karar döndürür. Ağ yok, saat okuma yok —
o yüzden sınanabilir.
"""
from __future__ import annotations

import datetime as _dt


# Döndürülen sebepler — çağıran tarafta karşılaştırılıyor, sabit tutulmalı.
YOK = "bar yok"
GELECEK = "gelecek tarihli bar"
YARIM = "bugünün barı henüz kapanmadı"
ESKI = "bu bar için tahmin zaten var"


def bar_engeli(
    bar_gunu: str | None,
    bugun: str,
    piyasa_acik: bool,
    son_tahmin_bari: str | None = None,
) -> str | None:
    """
    Bu bardan tahmin üretilebilir mi?

    None → üretilebilir. Aksi hâlde ENGELİN SEBEBİ döner (ekrana ve günlüğe
    o sebep yazılır; "atlandı" demek yetmez, neden atlandığı bilinmeli).

    Parametreler
      bar_gunu          serinin son barının tarihi (YYYY-MM-DD, borsa takvimi)
      bugun             bugünün tarihi (aynı takvim)
      piyasa_acik       seans şu an açık mı
      son_tahmin_bari   bu sembol için en son hangi barın tahmini kayıtlı

    NEDEN `bar_gunu < bugun` SERBEST
    Hafta sonu, tatil ya da makinenin kapalı kaldığı günlerden sonra elde en
    son TAMAMLANMIŞ bar bulunur; o bar geçmişe ait olsa da eksiksizdir.
    Reddetmek, kapalı kaldığımız her günden sonra sistemi susturmak olurdu.
    """
    if not bar_gunu:
        return YOK
    if bar_gunu > bugun:
        # Saat dilimi ya da kaynak hatası. Gelecekten bir bar "tamamlanmış"
        # sayılamaz; sessizce kullanmak sızıntı olur.
        return GELECEK
    if bar_gunu == bugun and piyasa_acik:
        return YARIM
    if son_tahmin_bari and son_tahmin_bari >= bar_gunu:
        return ESKI
    return None


def ozet(engeller: dict[str, str | None]) -> str:
    """
    Sembol→engel eşlemesini tek satırlık insan cümlesine çevirir.

    Sayıyı değil SEBEBİ öne alır: "12 atlandı" bir şey anlatmıyor, "12 sembol:
    bugünün barı henüz kapanmadı" ne yapılacağını söylüyor.
    """
    sayim: dict[str, int] = {}
    for sebep in engeller.values():
        if sebep:
            sayim[sebep] = sayim.get(sebep, 0) + 1
    if not sayim:
        return "tüm semboller tamamlanmış bardan analiz edildi"
    return " · ".join(f"{n} sembol: {sebep}"
                      for sebep, n in sorted(sayim.items(), key=lambda kv: -kv[1]))


# ── Kaçırılan işlem günleri (I10 için) ──────────────────────────────────────
#
# NEDEN (25.09.2026)
# I10 "analiz gecikmiş mi"yi SON TAHMİNİN YAZILDIĞI SAATLE ölçüyordu. Bar
# kapısından sonra bu yanlış alarm üretir: makine yalnız gün içinde açıksa
# iş her 30 dakikada koşar ve doğru şekilde REDDEDER, ama "son tahmin 3 gün
# önce" görünür. Doğru soru saat değil: KAPANMIŞ bir işlem günü var mı ki
# tahmini yok?


def son_kapanmis_islem_gunu(simdi: _dt.datetime, tatiller, kapanis: _dt.time) -> str:
    """
    Barı TAMAMLANMIŞ en son işlem günü.

    Bugün işlem günüyse ve seans kapandıysa bugün; değilse geriye doğru ilk
    işlem günü. Hafta sonu ve `tatiller` atlanır.
    """
    g = simdi.date()
    if not (g.weekday() < 5 and g.isoformat() not in tatiller and simdi.time() > kapanis):
        g -= _dt.timedelta(days=1)
    while g.weekday() >= 5 or g.isoformat() in tatiller:
        g -= _dt.timedelta(days=1)
    return g.isoformat()


def kacirilan_islem_gunleri(son_tahmin_bari: str | None, son_kapanmis: str,
                            tatiller, azami: int = 30) -> list[str]:
    """
    `son_tahmin_bari`ndan sonra gelen ve `son_kapanmis` dahil, tahmini
    OLMAYAN işlem günleri. Tahmin hiç yoksa boş liste (ölçülecek bir şey yok;
    o hâli çağıran "hiç çalışmamış" diye ayrıca söyler).
    """
    if not son_tahmin_bari or son_tahmin_bari >= son_kapanmis:
        return []
    g = _dt.date.fromisoformat(son_tahmin_bari) + _dt.timedelta(days=1)
    son = _dt.date.fromisoformat(son_kapanmis)
    cikti: list[str] = []
    while g <= son and len(cikti) < azami:
        if g.weekday() < 5 and g.isoformat() not in tatiller:
            cikti.append(g.isoformat())
        g += _dt.timedelta(days=1)
    return cikti
