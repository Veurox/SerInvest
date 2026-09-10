"""
TEFAS istemcisi — ağsız testler.

Neden burası: `tefas_api` bilerek saf tutuldu (istek at, normalize et) ki
zamanlama/kalıcılık olmadan sınanabilsin. Ağa çıkan tek nokta `requests`;
o da sahte oturumla değiştiriliyor.

Sınanan davranışlar, hepsi 11.09.2026 saha denemesinde GÖRÜLEN durumlar:
  • sayfalama (960 kayıt, 200'lük sayfa)
  • HTTP 429 hız sınırı → geri çekilme
  • "Index 0 out of bounds" → hata DEĞİL, boş gün
  • bozuk kayıtların atılması
"""
import datetime

import pytest

import tefas_api as T


BAS = datetime.date(2026, 9, 1)
BIT = datetime.date(2026, 9, 5)


class SahteCevap:
    def __init__(self, govde, status=200, headers=None):
        self.status_code = status
        self._govde = govde
        self.headers = headers or {}

    def json(self):
        return self._govde


class SahteOturum:
    """post() çağrılarını kaydeden, sıradaki cevabı döndüren sahte oturum."""
    def __init__(self, cevaplar):
        self.cevaplar = list(cevaplar)
        self.istekler = []

    def post(self, url, json=None, timeout=None):
        self.istekler.append(json)
        return self.cevaplar.pop(0) if self.cevaplar else SahteCevap(
            {"errorMessage": None, "resultList": [], "toplamSayi": 0})

    def get(self, *a, **k):
        return SahteCevap({})


def _kayit(kod, tarih="2026-09-04", fiyat=10.0):
    return {"fonKodu": kod, "fonUnvan": f"{kod} FONU", "tarih": tarih,
            "fiyat": fiyat, "portfoyBuyukluk": 1000.0,
            "tedPaySayisi": 100.0, "kisiSayisi": 5}


# ── normalize ────────────────────────────────────────────────────────────────

def test_normalize_alanlari_dogru_esler():
    n = T.normalize(_kayit("AAV", "2026-09-04", 62.077527), "104")
    assert n["kod"] == "AAV"
    assert n["tarih"] == "2026-09-04"
    assert n["fiyat"] == pytest.approx(62.077527)
    assert n["kategori"] == "Hisse Senedi"
    assert n["kategori_kod"] == "104"


def test_normalize_high_low_URETMEZ():
    """
    Fonda açılış/yüksek/düşük YOKTUR. Şema bu alanları içermemeli — olmayan
    alanı sıfırla doldurmak "fiyat sıfırdı" gibi okunur ve sessizce yanlış
    hesaplara yol açar (hisse tarafında NaN→0 dersini almıştık).
    """
    n = T.normalize(_kayit("AAV"), "104")
    for yasak in ("high", "low", "open", "hacim", "volume"):
        assert yasak not in n


@pytest.mark.parametrize("bozuk", [
    {"fonKodu": "", "tarih": "2026-09-04", "fiyat": 10},      # kod yok
    {"fonKodu": "AAV", "tarih": "", "fiyat": 10},             # tarih yok
    {"fonKodu": "AAV", "tarih": "2026-09-04", "fiyat": None}, # fiyat yok
    {"fonKodu": "AAV", "tarih": "2026-09-04", "fiyat": 0},    # fiyat sıfır
    {"fonKodu": "AAV", "tarih": "2026-09-04", "fiyat": -3},   # negatif
])
def test_normalize_bozuk_kaydi_atar(bozuk):
    assert T.normalize(bozuk, "104") is None


# ── sayfalama ────────────────────────────────────────────────────────────────

def test_sayfalama_tum_kayitlari_toplar():
    """Saha denemesinde 960 kayıt / 200'lük sayfa görüldü — 5 sayfa."""
    toplam = 450
    sayfalar = []
    kalan = toplam
    while kalan > 0:
        n = min(200, kalan)
        sayfalar.append(SahteCevap({
            "errorMessage": None, "toplamSayi": toplam,
            "resultList": [_kayit(f"F{i}") for i in range(n)],
        }))
        kalan -= n
    s = SahteOturum(sayfalar)
    r = T.kategori_cek("104", BAS, BIT, oturum=s, sayfa_boyu=200)
    assert len(r) == toplam
    # İstenen aralıklar 1-200, 201-400, 401-600 olmalı
    assert [(i["basSira"], i["bitSira"]) for i in s.istekler] == \
           [(1, 200), (201, 400), (401, 600)]


def test_tarih_bicimi_YYYYMMDD():
    """API ISO değil YYYYMMDD ister; yanlış biçim sessizce boş sonuç verir."""
    s = SahteOturum([SahteCevap({"errorMessage": None, "resultList": [], "toplamSayi": 0})])
    T.kategori_cek("104", datetime.date(2026, 9, 1), datetime.date(2026, 9, 5), oturum=s)
    assert s.istekler[0]["basTarih"] == "20260901"
    assert s.istekler[0]["bitTarih"] == "20260905"


# ── hata durumları ───────────────────────────────────────────────────────────

def test_bos_gun_hata_degil():
    """
    'Index 0 out of bounds' TEFAS'ın boş filtreye verdiği cevap. Sitenin kendisi
    de bunu alıyor. Hafta sonu / tatil / gün-içi sorguda normaldir — İSTİSNA
    FIRLATILMAMALI, boş liste dönmeli.
    """
    s = SahteOturum([SahteCevap({
        "errorMessage": "Index 0 out of bounds for length 0",
        "resultList": None, "toplamSayi": None})])
    assert T.kategori_cek("104", BAS, BIT, oturum=s) == []


def test_gercek_hata_sessizce_yutulmaz():
    s = SahteOturum([SahteCevap({
        "errorMessage": "Hata:java.lang.NullPointerException",
        "resultList": None, "toplamSayi": None})])
    with pytest.raises(T.TefasHata):
        T.kategori_cek("104", BAS, BIT, oturum=s)


def test_429_geri_cekilir_sonra_basarir(monkeypatch):
    """
    Saha denemesinde art arda iki sorguda HTTP 429 alındı. Doğru davranış
    ısrar etmek değil, geri çekilip tekrar denemek.
    """
    uyuma = []
    monkeypatch.setattr(T.time, "sleep", lambda s: uyuma.append(s))
    s = SahteOturum([
        SahteCevap({}, status=429),
        SahteCevap({}, status=429),
        SahteCevap({"errorMessage": None, "toplamSayi": 1,
                    "resultList": [_kayit("AAV")]}),
    ])
    r = T.kategori_cek("104", BAS, BIT, oturum=s)
    assert len(r) == 1
    assert any(x >= 5 for x in uyuma), "geri çekilme beklenirdi"


def test_429_israr_etmez(monkeypatch):
    """Sonsuz deneme siteyi daha da yorar — sınırlı denemeden sonra vazgeçilir."""
    monkeypatch.setattr(T.time, "sleep", lambda s: None)
    s = SahteOturum([SahteCevap({}, status=429) for _ in range(10)])
    with pytest.raises(T.TefasHata):
        T.kategori_cek("104", BAS, BIT, oturum=s)
    assert len(s.istekler) <= len(T.GERI_CEKILME_SN) + 1


def test_retry_after_basligina_uyulur(monkeypatch):
    uyuma = []
    monkeypatch.setattr(T.time, "sleep", lambda s: uyuma.append(s))
    s = SahteOturum([
        SahteCevap({}, status=429, headers={"Retry-After": "7"}),
        SahteCevap({"errorMessage": None, "toplamSayi": 1, "resultList": [_kayit("A")]}),
    ])
    T.kategori_cek("104", BAS, BIT, oturum=s)
    assert 7 in uyuma, "sunucunun söylediği süreye uyulmalı"


def test_kibarlik_beklemesi_yeterince_uzun():
    """
    0.8 sn ile 429 yendi. Eşik sessizce düşürülürse aynı duvara toslanır ve
    kamuya açık bir servis yorulur.
    """
    assert T.BEKLEME_SN >= 1.0
