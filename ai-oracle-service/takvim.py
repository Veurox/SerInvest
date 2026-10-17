"""
SerInvest — BIST takvimi: TEK KAYNAK
=====================================

NEDEN VAR (18.10.2026)
Takvim üç yerde ayrı ayrı tutuluyordu: kâğıt portföy (10:00–18:30 + tatil
listesi), bar kapısı (portföyün listesini parametre alıyordu) ve arayüz
(10:00–18:00, tatil HİÇ yok). Ayrışan kopyalar iki somut hata üretti:

  • Arife yarım günleri TAM TATİL sayılıyordu. Oysa BIST arifede öğlene kadar
    işlem görür — 2026-03-19 ve 2026-05-26'da XU100 barı VAR (ölçüldü).
    28.10.2026 sabahı bar kapısı "piyasa kapalı" sanıp YARIM bardan tahmin
    üretecek, o günün bekleyen emirleri düşecek, I10 o günü hiç aramayacaktı.
  • 2027 listesi yoktu: 1 Ocak'tan itibaren tatiller işlem günü sanılacaktı.

Bu modül saf: tarih alır, karar döndürür; ağ ve saat okuma yok (saat yalnız
varsayılan argümanda). Listeler YILLIK güncellenir — `eksik_yil` öz denetimde
gelecek yılın listesi yoksa Kasım'dan itibaren uyarır.
"""
from __future__ import annotations

import datetime as _dt

import bar_durumu

# ── Seans saatleri ───────────────────────────────────────────────────────────
ACILIS = _dt.time(10, 0)
# Bar "tamamlanmış" sayılma saati. Kapanış seansı ~18:10'da biter, yfinance
# ~15 dk gecikmeli yayınlar. 18.10.2026 ölçümü: 600 tahminin kayıtlı kapanışı
# kesin kapanışla birebir aynı — 18:30 doğru.
KAPANIS = _dt.time(18, 30)
# Arifede pay piyasası 12:40'ta kapanır (bazı kaynaklar 13:00 der); aynı
# gecikme payıyla bar 13:30'da tamam sayılır.
YARIM_GUN_KAPANIS = _dt.time(13, 30)

# ── Tam gün kapalı ───────────────────────────────────────────────────────────
# Hafta sonuna denk gelenler de yazıldı: liste "takvimde ne var" sorusunun
# cevabı, "hangi hafta içi günü kapalı" değil.
TATILLER: dict[str, str] = {
    # 2026
    "2026-01-01": "Yılbaşı",
    "2026-03-20": "Ramazan Bayramı",
    "2026-03-21": "Ramazan Bayramı",
    "2026-03-22": "Ramazan Bayramı",
    "2026-04-23": "Ulusal Egemenlik ve Çocuk Bayramı",
    "2026-05-01": "İşçi Bayramı",
    "2026-05-19": "Atatürk'ü Anma, Gençlik ve Spor Bayramı",
    "2026-05-27": "Kurban Bayramı",
    "2026-05-28": "Kurban Bayramı",
    "2026-05-29": "Kurban Bayramı",
    "2026-05-30": "Kurban Bayramı",
    "2026-07-15": "Demokrasi ve Millî Birlik Günü",
    "2026-08-30": "Zafer Bayramı",
    "2026-10-29": "Cumhuriyet Bayramı",
    # 2027 — dinî bayramlar Diyanet 2027 takvimine göre (Ramazan 9–11 Mart,
    # Kurban 16–19 Mayıs). Hükümet idari izin ilan ederse BIST yine de açık
    # olabilir; borsa kendi duyurusunu Aralık'ta yapar — o zaman doğrulanmalı.
    "2027-01-01": "Yılbaşı",
    "2027-03-09": "Ramazan Bayramı",
    "2027-03-10": "Ramazan Bayramı",
    "2027-03-11": "Ramazan Bayramı",
    "2027-04-23": "Ulusal Egemenlik ve Çocuk Bayramı",
    "2027-05-01": "İşçi Bayramı",
    "2027-05-16": "Kurban Bayramı",
    "2027-05-17": "Kurban Bayramı",
    "2027-05-18": "Kurban Bayramı",
    "2027-05-19": "Kurban Bayramı · Atatürk'ü Anma, Gençlik ve Spor Bayramı",
    "2027-07-15": "Demokrasi ve Millî Birlik Günü",
    "2027-08-30": "Zafer Bayramı",
    "2027-10-29": "Cumhuriyet Bayramı",
}

# ── Yarım gün (arife) — İŞLEM GÜNÜDÜR, seans öğlen biter ────────────────────
YARIM_GUNLER: dict[str, str] = {
    "2026-03-19": "Ramazan Bayramı arifesi",
    "2026-05-26": "Kurban Bayramı arifesi",
    "2026-10-28": "Cumhuriyet Bayramı arifesi",
    "2027-03-08": "Ramazan Bayramı arifesi",
    "2027-05-15": "Kurban Bayramı arifesi",       # Cumartesi — etkisiz, kayıt için
    "2027-10-28": "Cumhuriyet Bayramı arifesi",
}


def _iso(gun) -> str:
    return gun if isinstance(gun, str) else gun.isoformat()


def islem_gunu_mu(gun) -> bool:
    """Hafta içi ve tam tatil değilse işlem günüdür (yarım gün DAHİL)."""
    d = _dt.date.fromisoformat(_iso(gun))
    return d.weekday() < 5 and _iso(gun) not in TATILLER


def kapanis_saati(gun) -> _dt.time | None:
    """O günün barının tamamlanmış sayıldığı saat; işlem günü değilse None."""
    if not islem_gunu_mu(gun):
        return None
    return YARIM_GUN_KAPANIS if _iso(gun) in YARIM_GUNLER else KAPANIS


def kapali_sebebi(simdi: _dt.datetime | None = None) -> str | None:
    """Piyasa kapalıysa nedeni ('Hafta sonu' / 'Tatil: X' / 'Seans dışı' /
    'Yarım gün: X — seans bitti'); açıksa None."""
    simdi = simdi or _dt.datetime.now()
    iso = simdi.date().isoformat()
    if iso in TATILLER:
        return f"Tatil: {TATILLER[iso]}"
    if simdi.weekday() >= 5:
        return "Hafta sonu"
    kapanis = kapanis_saati(iso)
    if simdi.time() < ACILIS:
        return "Seans dışı"
    if simdi.time() > kapanis:
        if iso in YARIM_GUNLER:
            return f"Yarım gün: {YARIM_GUNLER[iso]} — seans bitti"
        return "Seans dışı"
    return None


def acik_mi(simdi: _dt.datetime | None = None) -> bool:
    return kapali_sebebi(simdi) is None


def son_kapanmis_islem_gunu(simdi: _dt.datetime | None = None) -> str:
    """Barı TAMAMLANMIŞ en son işlem günü — yarım günlerin erken kapanışıyla."""
    yarim = {g: YARIM_GUN_KAPANIS for g in YARIM_GUNLER}
    return bar_durumu.son_kapanmis_islem_gunu(
        simdi or _dt.datetime.now(), TATILLER, KAPANIS, yarim_gunler=yarim)


def kacan_gunler(son_tahmin_bari: str | None, simdi: _dt.datetime | None = None,
                 azami: int = 30) -> list[str]:
    """Tahmini olmayan KAPANMIŞ işlem günleri — I10 ve işler ekranı aynı ölçütü
    kullansın diye tek yerde (ikisi ayrışınca ekran boş yere "gecikmiş" diyordu)."""
    return bar_durumu.kacirilan_islem_gunleri(
        son_tahmin_bari, son_kapanmis_islem_gunu(simdi), TATILLER, azami)


def islem_gunu_sayisi(bas, bit) -> int:
    """`bas`tan SONRA, `bit` DAHİL kaç işlem günü var. Etiketin ufku gibi
    sayar: giriş günü 0, ertesi işlem günü 1."""
    d = _dt.date.fromisoformat(_iso(bas)) + _dt.timedelta(days=1)
    son = _dt.date.fromisoformat(_iso(bit))
    n = 0
    while d <= son:
        if islem_gunu_mu(d):
            n += 1
        d += _dt.timedelta(days=1)
    return n


def eksik_yil(bugun: _dt.date | None = None) -> int | None:
    """Kasım'dan itibaren gelecek yılın listesi yoksa o yıl; değilse None."""
    bugun = bugun or _dt.date.today()
    hedef = bugun.year + 1 if bugun.month >= 11 else bugun.year
    var = any(g.startswith(f"{hedef}-") for g in TATILLER)
    return None if var else hedef
