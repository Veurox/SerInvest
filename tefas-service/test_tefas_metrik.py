"""
Fon ölçümleri — testler.

Testlerin çoğu HESABIN DOĞRULUĞUNU değil, HESAPLANMAMASI GEREKEN YERDE
hesaplanmadığını sınıyor. Getiri formülü üç satır ve yanlış yazılırsa hemen
görülür; asıl tehlike 4 aylık geçmişi olan bir fona "1 yıllık getiri" yazmak —
o sessizce yanlış olur ve kullanıcı onunla fon seçer.
"""
import datetime

import pytest

import tefas_metrik as M

REF = datetime.date(2026, 9, 14)


def _satir(kod, gun, fiyat, kategori="104", buyukluk=1000.0, kisi=100):
    return {"kod": kod, "unvan": f"{kod} FONU", "kategori_kod": kategori,
            "kategori": "Hisse Senedi", "event_ts": gun, "fiyat": fiyat,
            "buyukluk": buyukluk, "kisi_sayisi": kisi}


def _gunluk(kod, bas: datetime.date, gun_sayisi: int, ilk=100.0,
            gunluk_artis=0.0, kategori="104"):
    """Ardışık takvim günleri için basit bir seri üretir."""
    satirlar = []
    f = ilk
    for i in range(gun_sayisi):
        g = bas + datetime.timedelta(days=i)
        satirlar.append(_satir(kod, g.isoformat(), f, kategori))
        f *= (1.0 + gunluk_artis)
    return satirlar


# ── dönem getirisi: asıl mesele ──────────────────────────────────────────────

def test_getiri_dogru_hesaplanir():
    seri = M.seri_kur([_satir("A", "2025-09-14", 100.0),
                       _satir("A", "2026-09-14", 150.0)])
    d = M.donem_getirisi(seri, REF, 365)
    assert d["getiri"] == pytest.approx(0.5)
    assert d["gun"] == 365


def test_YETERSIZ_gecmiste_getiri_URETILMEZ():
    """
    Bu testin koruduğu şey tablonun tamamı. Fon 4 aydır var; "1 yıllık getiri"
    hücresi BOŞ kalmalı. 4 aylık sayıyı oraya yazmak teknik olarak mümkün ama
    kullanıcı o kolonla fonları karşılaştırıyor.
    """
    seri = M.seri_kur(_gunluk("A", datetime.date(2026, 5, 14), 120))
    assert M.donem_getirisi(seri, REF, 365) is None      # 1 yıl: yok
    assert M.donem_getirisi(seri, REF, 91) is not None   # 3 ay: var


def test_donem_basi_kesime_uzaksa_getiri_URETILMEZ():
    """
    Fonun dönem başında gözlemi var ama 3 ay öncesine ait. Bu artık "1 aylık
    getiri" değil; elde tutulan tek sayı yüzünden yanlış dönem etiketi
    yapıştırılmamalı.
    """
    seri = M.seri_kur([_satir("A", "2026-05-01", 100.0),
                       _satir("A", "2026-09-14", 130.0)])
    assert M.donem_getirisi(seri, REF, 30) is None
    # Tolerans içindeki küçük boşluk (tatil) kabul edilir.
    seri2 = M.seri_kur([_satir("A", "2026-08-12", 100.0),
                        _satir("A", "2026-09-14", 130.0)])
    assert M.donem_getirisi(seri2, REF, 30) is not None


def test_kullanilan_gun_sayisi_cikti_da_yazar():
    """Dönem yazılmadan getiri anlamsızdır (MODEL_KANIT §5)."""
    seri = M.seri_kur([_satir("A", "2026-08-15", 100.0),
                       _satir("A", "2026-09-14", 110.0)])
    d = M.donem_getirisi(seri, REF, 30)
    assert d["gun"] == 30
    assert d["taban_gun"] == "2026-08-15"
    assert d["son_gun"] == "2026-09-14"


def test_tek_gozlemli_fon_getiri_vermez():
    seri = M.seri_kur([_satir("A", "2026-09-14", 100.0)])
    assert all(M.donem_getirisi(seri, REF, g) is None for g in M.DONEMLER.values())


# ── risk ─────────────────────────────────────────────────────────────────────

def test_az_gozlemde_risk_olcumu_URETILMEZ():
    """60 gözlemin altında oynaklık tahmini gürültüdür; sıfır yazmak yalandır."""
    r = M.risk_olcumleri(M.seri_kur(_gunluk("A", datetime.date(2026, 8, 1), 30)), REF)
    assert r["oynaklik"] is None and r["max_dusus"] is None
    assert r["gozlem"] == 30, "kaç gözlem bulunduğu yazılmalı"


def test_sabit_fiyatta_oynaklik_sifir():
    r = M.risk_olcumleri(M.seri_kur(_gunluk("A", datetime.date(2026, 1, 1), 200)), REF)
    assert r["oynaklik"] == pytest.approx(0.0, abs=1e-12)
    assert r["max_dusus"] == pytest.approx(0.0)


def test_max_dusus_zirveden_dibe_olcer():
    satirlar = ([_satir("A", (datetime.date(2026, 3, 1) + datetime.timedelta(days=i)).isoformat(), f)
                 for i, f in enumerate([100.0] * 30 + [200.0] * 10 + [150.0] * 10 + [180.0] * 30)])
    r = M.risk_olcumleri(M.seri_kur(satirlar), REF)
    assert r["max_dusus"] == pytest.approx(0.25)      # 200 -> 150


# ── bayat fon ────────────────────────────────────────────────────────────────

def test_serisi_bitmis_fon_bayat_isaretlenir():
    """
    Kapanan fonun son fiyatı aylar öncesine ait olur ve tabloda canlılarla yan
    yana görünür. Silmiyoruz (veri bilgidir) ama işaretliyoruz.
    """
    o = M.fon_olcumleri(_gunluk("A", datetime.date(2026, 1, 1), 100), REF)
    assert o["bayat"] is True
    assert o["bayat_gun"] > M.BAYATLIK_SINIRI_GUN


def test_guncel_fon_bayat_degil():
    o = M.fon_olcumleri(_gunluk("A", datetime.date(2026, 6, 1), 106), REF)
    assert o["bayat"] is False


# ── akran sırası ─────────────────────────────────────────────────────────────

def _evren():
    """3 hisse fonu (farklı getiri) + 2 para piyasası fonu, hepsi 1 yıllık."""
    bas = datetime.date(2025, 9, 1)
    s = []
    s += _gunluk("IYI",  bas, 380, 100.0, 0.0015, "104")
    s += _gunluk("ORTA", bas, 380, 100.0, 0.0010, "104")
    s += _gunluk("KOTU", bas, 380, 100.0, 0.0003, "104")
    s += _gunluk("PP1",  bas, 380, 100.0, 0.0008, "107")
    s += _gunluk("PP2",  bas, 380, 100.0, 0.0009, "107")
    return s


def test_akran_sirasi_KATEGORI_ICINDE():
    """
    Hisse fonunu para piyasası fonuyla sıralamak anlamsız: farklı risk,
    farklı iş. En iyi hisse fonu kendi kategorisinde tepede olmalı.
    """
    t = M.tarama(_evren(), REF)
    by = {f["kod"]: f for f in t["fonlar"]}
    assert by["IYI"]["akran_1y"] > by["ORTA"]["akran_1y"] > by["KOTU"]["akran_1y"]
    assert by["IYI"]["akran_n_1y"] == 3, "havuz yalnız hisse fonları olmalı"
    assert by["PP1"]["akran_n_1y"] == 2


def test_bayat_fon_akran_havuzuna_girmez():
    """Serisi aylar önce bitmiş bir fon, yaşayanların sırasını bozmamalı."""
    satirlar = _evren() + _gunluk("OLU", datetime.date(2025, 9, 1), 120, 100.0, 0.01, "104")
    t = M.tarama(satirlar, REF)
    by = {f["kod"]: f for f in t["fonlar"]}
    assert by["OLU"]["bayat"] is True
    assert by["OLU"]["akran_1y"] is None
    assert by["IYI"]["akran_n_1y"] == 3, "ölü fon havuza sızmış"


def test_getirisi_olmayan_fon_havuzu_kucultmez():
    satirlar = _evren() + _gunluk("YENI", datetime.date(2026, 8, 1), 44, 100.0, 0.001, "104")
    t = M.tarama(satirlar, REF)
    by = {f["kod"]: f for f in t["fonlar"]}
    assert by["YENI"]["getiri_1y"] is None
    assert by["YENI"]["akran_1y"] is None
    assert by["YENI"]["getiri_1a"] is not None, "1 aylık hesaplanabilmeliydi"
    assert by["IYI"]["akran_n_1y"] == 3


# ── eşik (para piyasası) ─────────────────────────────────────────────────────

def test_esik_para_piyasasinin_MEDYANI():
    t = M.tarama(_evren(), REF)
    by = {f["kod"]: f for f in t["fonlar"]}
    esik = t["esik"]["1y"]
    assert esik is not None
    # İki fon var: medyan ikisinin ortalaması.
    assert esik == pytest.approx(
        (by["PP1"]["getiri_1y"] + by["PP2"]["getiri_1y"]) / 2)


def test_esik_farki_fazla_getiriyi_verir():
    """
    Enflasyonlu ortamda bir hisse fonunu %0 ile kıyaslamak anlamsız. Anlamlı
    soru: "para piyasası fonunda dursaydım ne olurdu?" (PLAN_TEFAS.md §4)
    """
    t = M.tarama(_evren(), REF)
    by = {f["kod"]: f for f in t["fonlar"]}
    assert by["IYI"]["esik_farki_1y"] == pytest.approx(
        by["IYI"]["getiri_1y"] - t["esik"]["1y"])
    assert by["KOTU"]["esik_farki_1y"] < 0, "eşiğin altında kalan negatif olmalı"


def test_esik_kategorisi_yoksa_esik_farki_None():
    """Para piyasası fonu izlenmiyorsa eşik uydurulmaz."""
    sadece_hisse = [s for s in _evren() if s["kategori_kod"] == "104"]
    t = M.tarama(sadece_hisse, REF)
    assert t["esik"]["1y"] is None
    assert all(f["esik_farki_1y"] is None for f in t["fonlar"])


# ── tablo bütünü ─────────────────────────────────────────────────────────────

def test_hayatta_kalma_uyarisi_ciktida():
    """
    Uyarı arayüzde değil BURADA üretiliyor ki ekran onu unutamasın
    (PLAN_TEFAS.md §5 — fonlarda yanlılık hisseden daha ağır).
    """
    t = M.tarama(_evren(), REF)
    assert "kapanan" in t["uyari"].lower() or "kapanan" in t["uyari"]
    assert t["referans"] == "2026-09-14"


def test_bos_giris_patlamaz():
    t = M.tarama([], REF)
    assert t["adet"] == 0 and t["fonlar"] == []
    assert t["esik"]["1y"] is None


def test_gelecek_veri_kullanilmaz():
    """
    Referans gününden SONRAKİ satırlar hesaba girmemeli. Depo `as_of` ile
    süzüyor ama bu katman da kendi başına doğru olmalı.
    """
    satirlar = _gunluk("A", datetime.date(2025, 9, 1), 500, 100.0, 0.001)
    t = M.tarama(satirlar, REF)
    f = t["fonlar"][0]
    assert f["son_gun"] <= "2026-09-14"
    assert f["fiyat"] == pytest.approx(
        100.0 * (1.001 ** (REF - datetime.date(2025, 9, 1)).days))
