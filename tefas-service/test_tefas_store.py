"""
TEFAS deposu — testler.

Buradaki testlerin çoğu tek bir soruyu koruyor: **"o gün ne biliyorduk?"**
Depo bu soruya doğru cevap veremezse, üstüne kurulacak her akran sıralaması
ve her getiri karşılaştırması sessizce geleceği görmüş olur.
"""
import json

import pytest

from tefas_store import Depo


def _k(kod, tarih, fiyat, buyukluk=1000.0, kisi=5, kategori="104"):
    return {"kod": kod, "unvan": f"{kod} FONU", "kategori_kod": kategori,
            "kategori": "Hisse Senedi", "tarih": tarih, "fiyat": fiyat,
            "buyukluk": buyukluk, "pay_sayisi": 100.0, "kisi_sayisi": kisi}


@pytest.fixture
def depo(tmp_path):
    return Depo(tmp_path)


# ── temel yazma/okuma ────────────────────────────────────────────────────────

def test_yaz_oku_gidis_donus(depo):
    depo.yaz([_k("AAV", "2026-09-04", 62.0), _k("BBB", "2026-09-04", 10.0)])
    r = depo.oku()
    assert [x["kod"] for x in r] == ["AAV", "BBB"]
    assert r[0]["fiyat"] == pytest.approx(62.0)
    assert r[0]["event_ts"] == "2026-09-04"
    assert r[0]["ingest_ts"]          # boş olmamalı


def test_ingest_ts_event_ts_ayri_kalir(depo):
    """
    İkisi karışırsa noktasal-zamanlılık ölür. event_ts fonun günü,
    ingest_ts bizim öğrendiğimiz an — farklı olmaları NORMALDİR.
    """
    depo.yaz([_k("AAV", "2026-09-04", 62.0)], ingest_ts="2026-09-11T18:00:00+00:00")
    s = depo.oku()[0]
    assert s["event_ts"] == "2026-09-04"
    assert s["ingest_ts"] == "2026-09-11T18:00:00+00:00"


def test_eksik_alan_atlanir(depo):
    n = depo.yaz([{"kod": "", "tarih": "2026-09-04", "fiyat": 1},
                  {"kod": "AAV", "tarih": "", "fiyat": 1}])
    assert n["atlanan"] == 2
    assert depo.oku() == []


# ── dedup ────────────────────────────────────────────────────────────────────

def test_ayni_kayit_ikinci_kez_yazilmaz(depo):
    """
    Her gün son N günü tarıyoruz. Dedup olmasa dosya her turda aynı satırlarla
    şişerdi — hem disk hem de okuma maliyeti boşuna artardı.
    """
    kayit = [_k("AAV", "2026-09-04", 62.0)]
    assert depo.yaz(kayit)["yeni"] == 1
    ikinci = depo.yaz(kayit)
    assert ikinci == {"yeni": 0, "duzeltme": 0, "atlanan": 1}
    assert len(depo.oku()) == 1


def test_kayan_nokta_gurultusu_duzeltme_sayilmaz(depo):
    """62.077527 ile 62.0775270001 aynı değerdir; sahte düzeltme üretmemeli."""
    depo.yaz([_k("AAV", "2026-09-04", 62.077527)])
    n = depo.yaz([_k("AAV", "2026-09-04", 62.0775270001)])
    assert n["duzeltme"] == 0 and n["atlanan"] == 1


def test_yeniden_baslatmadan_sonra_da_dedup_calisir(tmp_path):
    """Dedup indeksi bellekte; konteyner yeniden başlarsa diskten kurulmalı."""
    Depo(tmp_path).yaz([_k("AAV", "2026-09-04", 62.0)])
    yeni = Depo(tmp_path)                     # taze süreç gibi
    assert yeni.yaz([_k("AAV", "2026-09-04", 62.0)])["atlanan"] == 1


# ── düzeltme ve noktasal-zamanlılık ──────────────────────────────────────────

def test_duzeltme_eski_satiri_SILMEZ(depo):
    """
    Üzerine yazsaydık "o gün ne biliyorduk" sorusunun cevabı kaybolurdu.
    Dosyada iki satır durmalı; okuma en günceli vermeli.
    """
    depo.yaz([_k("AAV", "2026-09-04", 62.0)], ingest_ts="2026-09-05T18:00:00+00:00")
    n = depo.yaz([_k("AAV", "2026-09-04", 63.5)], ingest_ts="2026-09-08T18:00:00+00:00")
    assert n["duzeltme"] == 1

    ham = (depo.gunluk / "2026-09.jsonl").read_text(encoding="utf-8").strip().split("\n")
    assert len(ham) == 2, "eski satır silinmiş — geçmiş yeniden yazılıyor"
    assert json.loads(ham[0])["fiyat"] == pytest.approx(62.0)

    r = depo.oku()
    assert len(r) == 1 and r[0]["fiyat"] == pytest.approx(63.5)


def test_as_of_duzeltmeden_ONCEKI_degeri_verir(depo):
    """
    Bu testin koruduğu şey projenin en pahalı dersi (MODEL_KANIT §8.2).
    06 Eylül'de yapılmış bir ölçüm, 08 Eylül'de gelen düzeltmeyi GÖREMEZ.
    """
    depo.yaz([_k("AAV", "2026-09-04", 62.0)], ingest_ts="2026-09-05T18:00:00+00:00")
    depo.yaz([_k("AAV", "2026-09-04", 63.5)], ingest_ts="2026-09-08T18:00:00+00:00")

    o_gun = depo.oku(as_of="2026-09-06T00:00:00+00:00")
    assert len(o_gun) == 1
    assert o_gun[0]["fiyat"] == pytest.approx(62.0), "gelecekten değer sızdı"

    bugun = depo.oku(as_of="2026-09-09T00:00:00+00:00")
    assert bugun[0]["fiyat"] == pytest.approx(63.5)


def test_as_of_heniz_ogrenilmemis_gunu_gostermez(depo):
    depo.yaz([_k("AAV", "2026-09-04", 62.0)], ingest_ts="2026-09-05T18:00:00+00:00")
    assert depo.oku(as_of="2026-09-04T12:00:00+00:00") == []


def test_geriye_donuk_bayragi_yazilir(depo):
    """
    İlk kurulumda 1 yıllık geçmiş bir anda gelir. Bu satırları o gün
    bilmiyorduk; bayrak olmadan canlı toplanmış veriden ayırt edilemezler.
    """
    depo.yaz([_k("AAV", "2025-09-04", 40.0)], geriye_donuk=True)
    depo.yaz([_k("AAV", "2026-09-04", 62.0)])
    eski = depo.oku(bit="2025-12-31")[0]
    yeni = depo.oku(bas="2026-01-01")[0]
    assert eski.get("geriye_donuk") is True
    assert "geriye_donuk" not in yeni


# ── bölmeleme ve süzme ───────────────────────────────────────────────────────

def test_aylik_dosyalara_bolunur(depo):
    depo.yaz([_k("AAV", "2026-08-31", 60.0), _k("AAV", "2026-09-01", 61.0)])
    assert sorted(p.name for p in depo.gunluk.glob("*.jsonl")) == \
           ["2026-08.jsonl", "2026-09.jsonl"]


def test_aralik_disi_dosya_hic_acilmaz(depo, monkeypatch):
    """Aylık bölmenin tek gerekçesi bu: 3 aylık sorgu 12 dosyayı okumamalı."""
    depo.yaz([_k("AAV", "2026-07-01", 1.0), _k("AAV", "2026-08-01", 2.0),
              _k("AAV", "2026-09-01", 3.0)])
    acilan = []
    gercek = Depo._dosya_oku

    def izle(p):
        acilan.append(p.name)
        return gercek(p)

    monkeypatch.setattr(Depo, "_dosya_oku", staticmethod(izle))
    depo.oku(bas="2026-09-01", bit="2026-09-30")
    assert acilan == ["2026-09.jsonl"]


def test_kod_ve_kategori_suzgeci(depo):
    depo.yaz([_k("AAV", "2026-09-04", 62.0, kategori="104"),
              _k("PPP", "2026-09-04", 10.0, kategori="107")])
    assert [x["kod"] for x in depo.oku(kod="AAV")] == ["AAV"]
    assert [x["kod"] for x in depo.oku(kategori_kod="107")] == ["PPP"]


def test_tarih_araligi_kapali(depo):
    depo.yaz([_k("AAV", d, 1.0) for d in
              ("2026-09-01", "2026-09-02", "2026-09-03")])
    r = depo.oku(bas="2026-09-02", bit="2026-09-03")
    assert [x["event_ts"] for x in r] == ["2026-09-02", "2026-09-03"]


# ── dayanıklılık ─────────────────────────────────────────────────────────────

def test_yarim_satir_dosyayi_dusurmez(depo):
    """
    Yazarken kapanan bir konteyner yarım satır bırakabilir. O satır atlanır,
    gerisi okunur — tek bozuk bayt yüzünden bir ay kaybedilmez.
    """
    depo.yaz([_k("AAV", "2026-09-04", 62.0)])
    p = depo.gunluk / "2026-09.jsonl"
    with open(p, "a", encoding="utf-8") as f:
        f.write('{"kod": "BOZ", "event_ts": "2026-09-0')
    r = depo.oku()
    assert len(r) == 1 and r[0]["kod"] == "AAV"


def test_ozet_ve_son_gun(depo):
    depo.yaz([_k("AAV", "2026-08-31", 60.0), _k("BBB", "2026-09-04", 10.0)])
    o = depo.ozet()
    assert o["satir"] == 2 and o["fon"] == 2
    assert o["ilk_gun"] == "2026-08-31" and o["son_gun"] == "2026-09-04"
    assert depo.son_gun() == "2026-09-04"


def test_bos_depo_patlamaz(depo):
    assert depo.oku() == []
    assert depo.son_gun() is None
    assert depo.ozet()["satir"] == 0
