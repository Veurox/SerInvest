"""
Çekim zamanlaması — testler.

Bu dosyanın varlık sebebi somut bir arıza: 11-14 Eylül 2026 arası makine
kapalı kaldı, açıldığında program Cuma'nın kapanışını ALMADI ve akşam 21:00'i
beklemeye geçti. Kullanıcı bilgisayarı akşama kadar açık tutmadığı için o
boşluk kendi kendine kapanmayacaktı — üstelik her kapanıp açılışta
tekrarlayacaktı.

Aşağıdaki `test_kapali_kalinan_gunler_...` testi tam o günü canlandırıyor.
"""
import datetime

import pytest

from tefas_zaman import cekim_gerekli, son_yayin_gunu

CEKIM_SAATI = 21

PER = datetime.date(2026, 9, 10)   # Perşembe
CUM = datetime.date(2026, 9, 11)   # Cuma
CMT = datetime.date(2026, 9, 12)   # Cumartesi
PAZ = datetime.date(2026, 9, 13)   # Pazar
PZT = datetime.date(2026, 9, 14)   # Pazartesi


# ── son_yayin_gunu ───────────────────────────────────────────────────────────

def test_yayin_saatinden_once_dune_bakar():
    """Sabah 10'da bugünün kapanışı henüz yayımlanmamıştır."""
    assert son_yayin_gunu(CUM, 10, CEKIM_SAATI) == "2026-09-10"


def test_yayin_saatinden_sonra_bugune_bakar():
    assert son_yayin_gunu(CUM, 21, CEKIM_SAATI) == "2026-09-11"


def test_hafta_sonu_cumaya_geri_yurur():
    """Pazartesi sabahı beklenen son yayın günü Cuma'dır, Pazar değil."""
    assert son_yayin_gunu(PZT, 10, CEKIM_SAATI) == "2026-09-11"
    assert son_yayin_gunu(PAZ, 23, CEKIM_SAATI) == "2026-09-11"
    assert son_yayin_gunu(CMT, 23, CEKIM_SAATI) == "2026-09-11"


# ── telafi: asıl arıza ───────────────────────────────────────────────────────

def test_kapali_kalinan_gunler_saati_beklemeden_telafi_edilir():
    """
    14.09.2026 ARIZASI. Makine 11-14 arası kapalıydı; depoda en yeni gün
    10 Eylül. Pazartesi öğlen açıldığında Cuma'nın kapanışı HEMEN alınmalı.

    Eski davranış: "bugün henüz çekilmedi ama saat 21 değil" → bekle.
    Kullanıcı akşamdan önce kapatınca Cuma sonsuza kadar kayboluyordu.
    """
    sebep = cekim_gerekli({"son_basarili_gun": "2026-09-11"}, "2026-09-10",
                          PZT, 12, CEKIM_SAATI)
    assert sebep is not None
    assert "geride" in sebep


def test_telafi_gunde_bir_kez_denenir():
    """
    Tatilde veri hiç yayımlanmaz; depo geride kalmaya devam eder. Üst sınır
    olmasa program her 15 dakikada bir boşuna deneyip siteyi yorardı —
    ki site hız sınırlıyor (bkz. tefas_api.BEKLEME_SN).
    """
    durum = {"son_telafi_gun": "2026-09-14"}
    assert cekim_gerekli(durum, "2026-09-10", PZT, 12, CEKIM_SAATI) is None


def test_veri_hic_yokken_telafi_calisir():
    assert cekim_gerekli({}, None, PZT, 12, CEKIM_SAATI) is not None


def test_guncel_veri_varsa_gunduz_cekim_yok():
    """
    Dün akşam çekilmişse sabah yapacak bir şey yok. Elde Cuma'nın kapanışı
    var, Pazartesi'ninki daha yayımlanmadı.
    """
    assert cekim_gerekli({"son_aksam_gun": "2026-09-11"}, "2026-09-11",
                         PZT, 10, CEKIM_SAATI) is None


# ── akşam çekimi ─────────────────────────────────────────────────────────────

def test_yayin_saatinde_bugunun_kapanisi_cekilir():
    sebep = cekim_gerekli({"son_telafi_gun": "2026-09-14"}, "2026-09-11",
                          PZT, 21, CEKIM_SAATI)
    assert sebep == "yayın saati geldi"


def test_gunduzki_telafi_aksam_cekimini_KARSILAMAZ():
    """
    Asıl hatanın kökü buydu: karar "bugün çalıştık mı"ya bakıyordu. Sabah
    çalışmak bugünü çekilmiş sayıyordu; oysa o saatte bugünün kapanışı henüz
    yayımlanmamıştı. İki hak ayrı sayılmalı.
    """
    durum = {"son_telafi_gun": "2026-09-14", "son_basarili_gun": "2026-09-14"}
    assert cekim_gerekli(durum, "2026-09-11", PZT, 22, CEKIM_SAATI) \
        == "yayın saati geldi"


def test_aksam_cekimi_yapildiysa_tekrarlanmaz():
    durum = {"son_aksam_gun": "2026-09-14", "son_telafi_gun": "2026-09-14"}
    assert cekim_gerekli(durum, "2026-09-14", PZT, 23, CEKIM_SAATI) is None


def test_gunde_en_fazla_iki_cekim():
    """
    Üst sınır: bir telafi + bir akşam. Hız sınırlayan bir siteye günde
    onlarca istek atmamak için bu sayı bilinçli.
    """
    durum: dict = {}
    depo = "2026-09-10"
    sayac = 0
    for saat in range(24):
        sebep = cekim_gerekli(durum, depo, PZT, saat, CEKIM_SAATI)
        if sebep:
            sayac += 1
            if saat >= CEKIM_SAATI:
                durum["son_aksam_gun"] = "2026-09-14"
                depo = "2026-09-14"
            else:
                durum["son_telafi_gun"] = "2026-09-14"
                depo = "2026-09-11"       # Cuma geldi
    assert sayac == 2


def test_ertesi_gun_haklar_yenilenir():
    durum = {"son_aksam_gun": "2026-09-14", "son_telafi_gun": "2026-09-14"}
    yarin = datetime.date(2026, 9, 15)
    assert cekim_gerekli(durum, "2026-09-14", yarin, 21, CEKIM_SAATI) is not None


@pytest.mark.parametrize("gun", [CMT, PAZ])
def test_hafta_sonu_bos_yere_cekmez(gun):
    """
    Cumartesi/Pazar yeni veri yok. Elde Cuma'nın kapanışı varsa telafi
    tetiklenmemeli.
    """
    assert cekim_gerekli({"son_aksam_gun": gun.isoformat()}, "2026-09-11",
                         gun, 12, CEKIM_SAATI) is None
