"""
BIST takvimi (takvim.py) — tek kaynak.

Neden burası: takvim üç yerde ayrı tutuluyordu ve ayrıştı. Arife yarım günleri
tam tatil sayıldığı için 28.10.2026 sabahı bar kapısı yarım bardan tahmin
üretecekti; 2027 listesi hiç yoktu (18.10.2026 denetimi).
"""
import datetime as dt

import bar_durumu
import takvim


def _t(s: str) -> dt.datetime:
    return dt.datetime.fromisoformat(s)


# ── 28 Ekim 2026: arife yarım günü ───────────────────────────────────────────

def test_arife_sabahi_piyasa_acik():
    assert takvim.acik_mi(_t("2026-10-28T11:00"))
    assert takvim.islem_gunu_mu("2026-10-28")


def test_arife_ogleden_sonra_kapali_ve_bar_tamam():
    assert not takvim.acik_mi(_t("2026-10-28T14:00"))
    assert takvim.kapali_sebebi(_t("2026-10-28T14:00")).startswith("Yarım gün")
    assert takvim.son_kapanmis_islem_gunu(_t("2026-10-28T14:00")) == "2026-10-28"


def test_arife_seans_icinde_bar_yarim_sayilir():
    """Asıl hata: kapı arifeyi 'kapalı' sanıp yarım barı geçiriyordu."""
    acik = takvim.acik_mi(_t("2026-10-28T11:00"))
    assert bar_durumu.bar_engeli("2026-10-28", "2026-10-28", acik, "2026-10-27") == bar_durumu.YARIM
    sonra = takvim.acik_mi(_t("2026-10-28T14:00"))
    assert bar_durumu.bar_engeli("2026-10-28", "2026-10-28", sonra, "2026-10-27") is None


def test_bayram_gunu_tam_kapali():
    assert takvim.kapali_sebebi(_t("2026-10-29T12:00")) == "Tatil: Cumhuriyet Bayramı"


def test_bayram_sonrasi_seansta_son_kapanmis_gun_arife():
    """30.10 seansında bekleyen emirler 28.10 sinyaliyle geçerli olmalı —
    eskiden arife tatil sayıldığı için 27.10 çıkıyor, emirler düşüyordu."""
    assert takvim.son_kapanmis_islem_gunu(_t("2026-10-30T11:00")) == "2026-10-28"


# ── Normal günler değişmedi ──────────────────────────────────────────────────

def test_normal_gun_saatleri():
    assert not takvim.acik_mi(_t("2026-10-19T09:59"))
    assert takvim.acik_mi(_t("2026-10-19T10:00"))
    assert takvim.acik_mi(_t("2026-10-19T18:30"))
    assert not takvim.acik_mi(_t("2026-10-19T18:31"))
    assert takvim.kapali_sebebi(_t("2026-10-17T12:00")) == "Hafta sonu"


def test_son_kapanmis_gun_normal_ve_hafta_sonu():
    assert takvim.son_kapanmis_islem_gunu(_t("2026-10-19T18:00")) == "2026-10-16"
    assert takvim.son_kapanmis_islem_gunu(_t("2026-10-19T18:45")) == "2026-10-19"
    assert takvim.son_kapanmis_islem_gunu(_t("2026-10-18T12:00")) == "2026-10-16"


# ── 2027 ─────────────────────────────────────────────────────────────────────

def test_2027_bayramlari():
    assert not takvim.islem_gunu_mu("2027-01-01")
    assert takvim.islem_gunu_mu("2027-03-08")          # arife — yarım gün
    assert takvim.kapanis_saati("2027-03-08") == takvim.YARIM_GUN_KAPANIS
    for g in ("2027-03-09", "2027-03-10", "2027-03-11", "2027-05-17",
              "2027-05-18", "2027-05-19", "2027-10-29"):
        assert not takvim.islem_gunu_mu(g), g


def test_yarim_gun_tatil_listesinde_degil():
    """Yarım gün İŞLEM günüdür; iki listede birden olamaz."""
    assert not set(takvim.YARIM_GUNLER) & set(takvim.TATILLER)


def test_eksik_yil_uyarisi():
    assert takvim.eksik_yil(dt.date(2026, 10, 18)) is None
    assert takvim.eksik_yil(dt.date(2026, 11, 2)) is None       # 2027 var
    assert takvim.eksik_yil(dt.date(2027, 11, 2)) == 2028


# ── İşlem günü sayımı (kâğıt portföy süre sınırı) ────────────────────────────

def test_islem_gunu_sayisi_bayram_haftasi():
    # 27.10 sonrası: 28 (arife, sayılır), 29 (tatil), 30, 31-1 (hafta sonu), 2 Kasım
    assert takvim.islem_gunu_sayisi("2026-10-27", "2026-11-02") == 3


def test_islem_gunu_sayisi_giris_gunu_sayilmaz():
    assert takvim.islem_gunu_sayisi("2026-10-19", "2026-10-19") == 0
    assert takvim.islem_gunu_sayisi("2026-10-19", "2026-10-20") == 1


def test_kacan_gunler_arifeyi_arar():
    kacan = takvim.kacan_gunler("2026-10-27", _t("2026-10-30T20:00"))
    assert kacan == ["2026-10-28", "2026-10-30"]


# ── bar_durumu yarım gün parametresi ─────────────────────────────────────────

def test_bar_durumu_yarim_gun_parametresi_geriye_uyumlu():
    t = _t("2026-10-28T14:00")
    eski = bar_durumu.son_kapanmis_islem_gunu(t, {}, dt.time(18, 30))
    yeni = bar_durumu.son_kapanmis_islem_gunu(t, {}, dt.time(18, 30),
                                              yarim_gunler={"2026-10-28": dt.time(13, 30)})
    assert eski == "2026-10-27" and yeni == "2026-10-28"
