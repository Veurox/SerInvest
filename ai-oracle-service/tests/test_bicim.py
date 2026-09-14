"""
bicim.py — kullanıcıya giden sayı biçimi.

Bu testlerin varlık sebebi: arayüzdeki `lib/format.ts` ile AYNI kararları
verdiğini kilitlemek. İki taraf ayrışırsa ekranda yine iki yazım olur, ki
bu modül tam olarak onu önlemek için yazıldı.
"""
import math

import pytest

import bicim


# ── sayi ────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("giren, basamak, beklenen", [
    (1234.56, 2, "1.234,56"),
    (0.5, 2, "0,50"),
    (-42.126, 2, "-42,13"),
    (1000000, 0, "1.000.000"),
    (7, 1, "7,0"),
])
def test_sayi_turkce_ayraclar(giren, basamak, beklenen):
    assert bicim.sayi(giren, basamak) == beklenen


def test_yarim_durumda_cifte_yuvarlar():
    """
    Python'un varsayılanı: tam yarımda en yakın ÇİFT basamağa yuvarlar
    (-42.125 → -42,12, 0.125 → 0,12). Beklenen "yukarı yuvarlama" değil.

    Bu davranışı değiştirmiyoruz — para hesabı burada yapılmıyor, bu modül
    yalnız GÖSTERİM biçimlendiriyor. Test, sürprizi belgelemek için var.
    """
    assert bicim.sayi(-42.125, 2) == "-42,12"
    assert bicim.sayi(0.125, 2) == "0,12"
    assert bicim.sayi(0.135, 2) == "0,14"


def test_sayi_isaret_istege_bagli():
    """Beklenen değer gibi ölçülerde '+' bilginin parçası."""
    assert bicim.sayi(0.43, 2, isaret=True) == "+0,43"
    assert bicim.sayi(0.43, 2) == "0,43"
    assert bicim.sayi(-0.43, 2) == "-0,43"            # eksi her zaman
    assert bicim.sayi(-0.43, 2, isaret=True) == "-0,43"


def test_sayi_olcelemeyen_deger_tire():
    assert bicim.sayi(math.nan) == "—"
    assert bicim.sayi(math.inf) == "—"


def test_sayi_none_tire_verir():
    """Sıfır yazmak veri yokluğunu gizlerdi."""
    assert bicim.sayi(None) == "—"


# ── tamsayi ─────────────────────────────────────────────────────────────────
def test_tamsayi_binlik_ayraci_nokta():
    assert bicim.tamsayi(19608) == "19.608"
    assert bicim.tamsayi(999) == "999"
    assert bicim.tamsayi(None) == "—"


# ── yuzde ───────────────────────────────────────────────────────────────────
def test_yuzde_isareti_sayinin_onunde():
    """Türkçe yazım: %45,5 — '45.5%' değil."""
    assert bicim.yuzde(45.5) == "%45,5"


def test_eksi_her_zaman_yazilir_arti_istege_bagli():
    assert bicim.yuzde(-7.5) == "-%7,5"
    assert bicim.yuzde(0.7) == "%0,7"
    assert bicim.yuzde(0.7, isaret=True) == "+%0,7"
    # Eksi, isaret=False olsa da kaybolmaz — yön bilgisi veridir.
    assert bicim.yuzde(-7.5, isaret=False).startswith("-")


def test_oran_yuzde_yuzle_carpar():
    assert bicim.oran_yuzde(0.455) == "%45,5"
    assert bicim.oran_yuzde(0.5054, 2) == "%50,54"


def test_olcelemeyen_degerler_tire():
    """NaN ve sonsuz, '%nan' diye ekrana basılmamalı."""
    assert bicim.yuzde(None) == "—"
    assert bicim.yuzde(math.nan) == "—"
    assert bicim.yuzde(math.inf) == "—"
    assert bicim.oran_yuzde(None) == "—"


def test_sifir_tire_degildir():
    """None ile 0 farklı şeyler: biri veri yok, diğeri ölçülmüş sıfır."""
    assert bicim.yuzde(0) == "%0,0"
    assert bicim.sayi(0) == "0,00"
