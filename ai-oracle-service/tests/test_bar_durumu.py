"""
bar_durumu — tahmin yalnız TAMAMLANMIŞ ve YENİ bardan üretilir.

Bu testler iki gerçek olayı kilitliyor:
  • 08.09.2026 — seans sürerken koşan döngü THYAO'yu 297,75 diye loglamıştı,
    gerçek kapanış 305,00'ti.
  • 07.09.2026 — BIST'te bar yokken 50 tahmin üretilmişti.
"""
import bar_durumu as bd


# ── Tamamlanmış bar ─────────────────────────────────────────────────────────
def test_kapanmis_gunun_bari_kullanilir():
    """Seans kapandıysa bugünün barı tamdır."""
    assert bd.bar_engeli("2026-09-16", "2026-09-16", piyasa_acik=False) is None


def test_seans_acikken_bugunun_bari_reddedilir():
    """08.09'da yaşanan hâl: yarım bar 'kapanış' diye kullanılıyordu."""
    assert bd.bar_engeli("2026-09-08", "2026-09-08", piyasa_acik=True) == bd.YARIM


def test_gecmis_bar_seans_acikken_de_kullanilir():
    """
    Seans açık ama elde yalnız DÜNÜN barı var (bugünkü henüz yayınlanmamış).
    O bar tamamlanmıştır — reddetmek gereksiz susmaktır.
    """
    assert bd.bar_engeli("2026-09-15", "2026-09-16", piyasa_acik=True) is None


def test_hafta_sonu_ve_tatil_sonrasi_susulmaz():
    """
    Makine günlerce kapalı kaldıysa en son tamamlanmış bar geçmişte olur.
    Bunu reddetmek, her kapalı günden sonra sistemi susturmak olurdu.
    """
    assert bd.bar_engeli("2026-09-11", "2026-09-14", piyasa_acik=False) is None


# ── Bozuk/eksik veri ────────────────────────────────────────────────────────
def test_bar_yoksa_engel():
    assert bd.bar_engeli(None, "2026-09-16", piyasa_acik=False) == bd.YOK
    assert bd.bar_engeli("", "2026-09-16", piyasa_acik=False) == bd.YOK


def test_gelecek_tarihli_bar_reddedilir():
    """Saat dilimi hatası sızıntıya dönüşmesin."""
    assert bd.bar_engeli("2026-09-17", "2026-09-16", piyasa_acik=False) == bd.GELECEK


# ── Aynı bar iki kez sayılmaz ───────────────────────────────────────────────
def test_ayni_bar_ikinci_kez_tahmin_edilmez():
    """07.09'da yaşanan hâl: eski bar yeni bir günmüş gibi kaydedilmişti."""
    assert bd.bar_engeli("2026-09-04", "2026-09-07", piyasa_acik=False,
                         son_tahmin_bari="2026-09-04") == bd.ESKI


def test_yeni_bar_gelince_tahmin_uretilir():
    assert bd.bar_engeli("2026-09-08", "2026-09-08", piyasa_acik=False,
                         son_tahmin_bari="2026-09-04") is None


def test_kayit_yoksa_engel_degil():
    """İlk kez analiz edilen sembol susturulmaz."""
    assert bd.bar_engeli("2026-09-16", "2026-09-16", piyasa_acik=False,
                         son_tahmin_bari=None) is None


def test_ileri_tarihli_kayit_da_engeldir():
    """Günlükte bardan YENİ bir kayıt varsa geriye gitmek yanlış olur."""
    assert bd.bar_engeli("2026-09-14", "2026-09-16", piyasa_acik=False,
                         son_tahmin_bari="2026-09-15") == bd.ESKI


# ── Öncelik sırası ──────────────────────────────────────────────────────────
def test_yarim_bar_kaydin_onune_gecer():
    """
    Hem yarım hem de 'zaten var' olabilir. Kullanıcıya söylenmesi gereken
    asıl sebep YARIM: veri henüz hazır değil, mükerrer olması ikincil.
    """
    assert bd.bar_engeli("2026-09-16", "2026-09-16", piyasa_acik=True,
                         son_tahmin_bari="2026-09-16") == bd.YARIM


# ── Özet cümlesi ────────────────────────────────────────────────────────────
def test_ozet_sebebi_one_alir():
    m = bd.ozet({"A": bd.YARIM, "B": bd.YARIM, "C": None, "D": bd.YOK})
    assert "2 sembol: " + bd.YARIM in m
    assert "1 sembol: " + bd.YOK in m


def test_ozet_engel_yoksa_acik_soyler():
    assert "tamamlanmış" in bd.ozet({"A": None, "B": None})


# ── Kaçırılan işlem günleri (I10) ───────────────────────────────────────────
import datetime as dt

KAPANIS = dt.time(18, 0)


def test_seans_icinde_son_kapanmis_gun_dundur():
    """25.09 Cuma 14:00 — bugün henüz kapanmadı, son kapanmış gün Perşembe."""
    simdi = dt.datetime(2026, 9, 25, 14, 0)
    assert bd.son_kapanmis_islem_gunu(simdi, set(), KAPANIS) == "2026-09-24"


def test_kapanistan_sonra_bugun_sayilir():
    simdi = dt.datetime(2026, 9, 25, 19, 0)
    assert bd.son_kapanmis_islem_gunu(simdi, set(), KAPANIS) == "2026-09-25"


def test_hafta_sonu_cumaya_doner():
    simdi = dt.datetime(2026, 9, 27, 12, 0)          # Pazar
    assert bd.son_kapanmis_islem_gunu(simdi, set(), KAPANIS) == "2026-09-25"


def test_tatil_atlanir():
    simdi = dt.datetime(2026, 9, 25, 14, 0)
    assert bd.son_kapanmis_islem_gunu(simdi, {"2026-09-24"}, KAPANIS) == "2026-09-23"


def test_makine_kapaliyken_kacan_gunler_sayilir():
    """25.09'da ölçülen hâl: son tahmin 22.09, makine 23-24'te kapalıydı."""
    assert bd.kacirilan_islem_gunleri("2026-09-22", "2026-09-24", set()) == \
        ["2026-09-23", "2026-09-24"]


def test_gun_icinde_acik_makine_gecikmis_sayilmaz():
    """
    I10'un yanlış alarmı: son tahmin dünün barından, şimdi seans içi.
    Kaçırılan kapanmış gün YOK — iş doğru şekilde reddediyor.
    """
    simdi = dt.datetime(2026, 9, 25, 14, 0)
    son = bd.son_kapanmis_islem_gunu(simdi, set(), KAPANIS)
    assert bd.kacirilan_islem_gunleri("2026-09-24", son, set()) == []


def test_hafta_sonu_kacirilmis_sayilmaz():
    assert bd.kacirilan_islem_gunleri("2026-09-25", "2026-09-28", set()) == ["2026-09-28"]


def test_tahmin_yoksa_bos():
    assert bd.kacirilan_islem_gunleri(None, "2026-09-24", set()) == []
