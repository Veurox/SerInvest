"""
TEFAS API istemcisi — SAF ve SINANABİLİR katman
================================================
Yalnızca "istek at, cevabı normalize et". Zamanlama, kalıcılık ve mesajlaşma
main.py'de; böylece ağ olmadan sınanabilir.

API SÖZLEŞMESİ (11.09.2026'da doğrulandı — docs/PLAN_TEFAS.md §2):
  POST https://www.tefas.gov.tr/api/funds/fonGnlBlgSiraliGetir
  Eski `api/DB/BindHistoryInfo` hattı ÖLDÜ (404) — site Next.js'e geçti.

ÖNEMLİ NOTLAR
  • Site F5/TSPD bot koruması kullanıyor. Oturum + gerçekçi başlıklarla
    engellemiyor (doğrulandı), ama bu GARANTİ DEĞİL: koruma sıkılaşabilir.
    Bu yüzden hatalar sessizce yutulmaz, çağıran tarafa bildirilir.
  • BUGÜNÜN verisi gün içinde YOKTUR — birim pay değeri akşam yayımlanır.
    Boş cevap "hata" değil, "henüz yayımlanmadı" demektir.
  • Kibar olmak zorunludur: bu resmi bir API değil, kamuya açık bir sitenin
    kendi uç noktası. Sayfa boyu makul, istekler arası bekleme var.
"""
from __future__ import annotations

import datetime
import time

import requests

BASE = "https://www.tefas.gov.tr"
URL_VERI = f"{BASE}/api/funds/fonGnlBlgSiraliGetir"
URL_TUR  = f"{BASE}/api/funds/fonTurGetir"
SAYFA    = f"{BASE}/tr/fon-verileri"

# Kategoriler — docs/PLAN_TEFAS.md §0'da gerekçeleriyle seçildi.
KATEGORILER: dict[str, str] = {
    "104": "Hisse Senedi",
    "105": "Kıymetli Maden",
    "101": "Değişken",
    "107": "Para Piyasası",      # kıyas eşiği
}

SAYFA_BOYU = 200      # tek istekte alınacak kayıt
# İstekler arası bekleme. 0.8 sn ile HTTP 429 (Too Many Requests) yendi
# (11.09.2026 saha denemesi) — site gerçekten hız sınırlıyor. Burası kamuya
# açık bir devlet servisi; yormak hem kaba hem de engellenmeye davetiye.
BEKLEME_SN = 1.5
ZAMAN_ASIMI = 30
# 429 sonrası üstel geri çekilme: 5s, 15s, 45s. Üçü de tutmazsa vazgeç —
# sonsuz denemek siteyi daha da yorar.
GERI_CEKILME_SN = (5, 15, 45)


class TefasHata(RuntimeError):
    """Ağ/biçim hatası. Sessizce yutulmaz: çağıran karar versin."""


def _oturum() -> requests.Session:
    """Önce sayfayı ziyaret eden bir oturum. Bot koruması çerez bekliyor."""
    s = requests.Session()
    ua = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
          "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
    s.headers.update({
        "User-Agent": ua,
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "tr-TR,tr;q=0.9",
        "Origin": BASE,
        "Referer": SAYFA,
    })
    try:
        s.get(SAYFA, timeout=ZAMAN_ASIMI)
    except Exception:
        pass          # çerez alınamazsa yine de dene; API tolere edebiliyor
    return s


def _gun(d: datetime.date) -> str:
    """API tarihi YYYYMMDD ister (ISO değil)."""
    return d.strftime("%Y%m%d")


def _sayi(v) -> float | None:
    try:
        f = float(v)
        return f if f == f else None       # NaN ele
    except (TypeError, ValueError):
        return None


def _istek_geri_cekilmeli(s: requests.Session, govde: dict, kategori_kod: str):
    """
    Tek istek + 429'a üstel geri çekilme.

    11.09.2026 saha denemesi: art arda iki sorguda HTTP 429 alındı. Site hız
    sınırlıyor ve bu meşru — resmi bir API değil, kamuya açık bir sitenin kendi
    uç noktası. Doğru davranış ısrar etmek değil, geri çekilmek. `Retry-After`
    başlığı varsa ona uyulur; yoksa 5/15/45 sn beklenir.
    """
    son_hata = None
    for i, bekle in enumerate((0,) + GERI_CEKILME_SN):
        if bekle:
            time.sleep(bekle)
        try:
            r = s.post(URL_VERI, json=govde, timeout=ZAMAN_ASIMI)
        except Exception as e:
            son_hata = f"istek başarısız — {e}"
            continue
        if r.status_code == 200:
            return r
        if r.status_code == 429:
            # Sunucu ne kadar bekleyeceğimizi söylediyse ona uy.
            try:
                ra = int(r.headers.get("Retry-After", "0"))
                if ra > 0:
                    time.sleep(min(ra, 120))
            except (TypeError, ValueError):
                pass
            son_hata = "HTTP 429 (hız sınırı)"
            continue
        raise TefasHata(f"{kategori_kod}: HTTP {r.status_code}")
    raise TefasHata(f"{kategori_kod}: {son_hata} — {len(GERI_CEKILME_SN)} denemede geçilemedi")


def normalize(ham: dict, kategori_kod: str) -> dict | None:
    """
    API kaydını iç şemamıza çevirir. Bozuk kayıt None döner (atılır).

    `fiyat` = birim pay değeri. Hisse tarafındaki `close` ile AYNI rolü oynar
    ama TEK fiyattır: açılış/yüksek/düşük YOKTUR. Bu yüzden şemaya bilerek
    High/Low koymuyoruz — olmayan alanı boş bırakmak, sıfırla doldurmaktan
    dürüsttür (sıfır "fiyat sıfırdı" gibi okunur).
    """
    kod = (ham.get("fonKodu") or "").strip().upper()
    tarih = (ham.get("tarih") or "").strip()[:10]
    fiyat = _sayi(ham.get("fiyat"))
    if not kod or not tarih or fiyat is None or fiyat <= 0:
        return None
    return {
        "kod": kod,
        "unvan": (ham.get("fonUnvan") or "").strip(),
        "kategori_kod": kategori_kod,
        "kategori": KATEGORILER.get(kategori_kod, kategori_kod),
        "tarih": tarih,                                  # event_ts (yayın günü)
        "fiyat": fiyat,                                  # birim pay değeri
        "buyukluk": _sayi(ham.get("portfoyBuyukluk")),   # fon büyüklüğü (TL)
        "pay_sayisi": _sayi(ham.get("tedPaySayisi")),
        "kisi_sayisi": _sayi(ham.get("kisiSayisi")),     # yatırımcı sayısı
    }


def kategori_cek(kategori_kod: str, bas: datetime.date, bit: datetime.date,
                 oturum: requests.Session | None = None,
                 sayfa_boyu: int = SAYFA_BOYU) -> list[dict]:
    """
    Bir kategorinin [bas, bit] aralığındaki tüm günlük kayıtlarını getirir.

    Sayfalama `basSira`/`bitSira` ile 1-tabanlı ve KAPALI aralık. `toplamSayi`
    ilk cevapta geliyor; sonraki sayfalar ona göre çekilir. Kayıt yoksa boş
    liste döner — bu HATA DEĞİL (hafta sonu, tatil, ya da gün içi sorgu).
    """
    s = oturum or _oturum()
    toplandi: list[dict] = []
    bas_sira = 1
    toplam: int | None = None

    while True:
        govde = {
            "fonTipi": "YAT", "fonKodu": None, "aramaMetni": None,
            "fonTurKod": None, "fonGrubu": None,
            "sfonTurKod": str(kategori_kod),
            "basTarih": _gun(bas), "bitTarih": _gun(bit),
            "basSira": bas_sira, "bitSira": bas_sira + sayfa_boyu - 1,
            "fonTurAciklama": None, "dil": "TR", "kurucuKod": None,
        }
        r = _istek_geri_cekilmeli(s, govde, kategori_kod)
        try:
            j = r.json()
        except Exception as e:
            raise TefasHata(f"{kategori_kod}: JSON çözülemedi — {e}") from e

        hata = j.get("errorMessage")
        liste = j.get("resultList") or []
        if hata:
            # "Index 0 out of bounds" = o aralıkta kayıt yok. Sitenin kendisi de
            # boş filtrede bu hatayı veriyor; gerçek arıza değil.
            if "out of bounds" in str(hata).lower() and not liste:
                return toplandi
            raise TefasHata(f"{kategori_kod}: {hata}")

        for ham in liste:
            n = normalize(ham, str(kategori_kod))
            if n:
                toplandi.append(n)

        if toplam is None:
            toplam = int(j.get("toplamSayi") or 0)
        if not liste or toplam <= 0 or bas_sira + sayfa_boyu - 1 >= toplam:
            break
        bas_sira += sayfa_boyu
        time.sleep(BEKLEME_SN)

    return toplandi


def kategoriler_cek(bas: datetime.date, bit: datetime.date,
                    kodlar: list[str] | None = None) -> tuple[list[dict], list[str]]:
    """
    Seçili kategorilerin hepsini çeker.

    Döndürür: (kayıtlar, hatalar). Bir kategori patlarsa DİĞERLERİ SÜRER —
    tek bir kategorinin arızası tüm günü kaybettirmemeli. Hatalar çağırana
    liste olarak döner; sessizce yutulmaz.
    """
    s = _oturum()
    hepsi: list[dict] = []
    hatalar: list[str] = []
    for kod in (kodlar or list(KATEGORILER)):
        try:
            hepsi.extend(kategori_cek(kod, bas, bit, oturum=s))
        except TefasHata as e:
            hatalar.append(str(e))
        time.sleep(BEKLEME_SN)
    return hepsi, hatalar
