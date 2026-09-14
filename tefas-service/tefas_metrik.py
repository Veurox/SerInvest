"""
TEFAS fon ölçümleri — SAF hesap katmanı
=======================================
Depodan gelen ham satırları ekranda gösterilebilir ölçümlere çevirir.
Ağ yok, disk yok, "bugün" okuma yok: referans günü parametre. Böylece
"fonun 4 aylık geçmişi var" gibi durumlar beklemeden sınanabiliyor.

BU DOSYANIN ASIL İŞİ HESAP DEĞİL, HESAPLAMAYI REDDETMEK
  Getiri hesaplamak üç satır. Zor olan, hesaplanamayacak yerde SAYI
  ÜRETMEMEK. Elinde 4 aylık veri olan bir fona "1 yıllık getiri" yazmak
  teknik olarak mümkün ama yalandır; kullanıcı o kolona bakıp fonları
  karşılaştıracak.

  Bu yüzden her dönem için üç şey birden aranıyor:
    1. Dönem başında GERÇEKTEN bir gözlem var mı (yoksa None)
    2. O gözlem kesim tarihine yeterince YAKIN mı (büyük boşluk varsa None)
    3. Kaç günlük aralıkla hesaplandığı çıktıya yazılıyor (`gun`)

  MODEL_KANIT §5'in fon tarafındaki karşılığı: dönem yazılmadan getiri
  anlamsızdır.

BAYAT FON
  Fonlar kapanır ve birleşir. Kapanan fonun serisi biter ama depoda durur;
  "son fiyat" aylar öncesine ait olur ve getiri tablosunda canlı fonlarla
  yan yana görünür. `bayat_gun` bunu görünür kılıyor — silmiyor, çünkü
  veriyi saklamak da bir bilgi.

HAYATTA KALMA YANLILIĞI
  Burada ÇÖZÜLEMEZ. Elimizde yalnız bugün TEFAS'ta listelenen fonlar var;
  kapanmış fonlar hiç girmedi. Bu tablo gerçekten olandan iyimserdir ve
  bunun ekranda yazması gerekir (docs/PLAN_TEFAS.md §5).
"""
from __future__ import annotations

import datetime
import math

# Dönemler takvim GÜNÜ cinsinden. İşlem günü değil: fon serisinde tatil/hafta
# sonu boşlukları var, "son 30 işlem günü" fonlar arasında farklı tarihlere
# denk gelir ve karşılaştırma bozulur.
DONEMLER: dict[str, int] = {"1a": 30, "3a": 91, "1y": 365}

# Dönem başı gözlemi, kesim tarihinden en çok bu kadar eski olabilir. Fonlar
# iş günlerinde yayımlar; uzun bir tatilde bile 4-5 günü geçmez. 10 gün hem
# tatilleri tolere eder hem de gerçek boşlukları yakalar.
TABAN_TOLERANS_GUN = 10

# Risk ölçümleri (oynaklık, maksimum düşüş) için pencere ve asgari gözlem.
# 60 gözlemin altında oynaklık tahmini gürültüden ibaret.
RISK_PENCERE_GUN = 365
ASGARI_RISK_GOZLEM = 60

# Son gözlem bu kadar günden eskiyse fon "bayat" sayılır (kapanmış/birleşmiş
# olabilir). Silinmez, işaretlenir.
BAYATLIK_SINIRI_GUN = 7

ISLEM_GUNU = 252          # yıllıklaştırma
ESIK_KATEGORI = "107"     # Para Piyasası — kıyas eşiği (PLAN_TEFAS.md §4)


def _tarih(s: str) -> datetime.date | None:
    try:
        return datetime.date.fromisoformat(s[:10])
    except (ValueError, TypeError):
        return None


def seri_kur(satirlar: list[dict]) -> list[tuple[datetime.date, float]]:
    """Depo satırlarını (gün, fiyat) dizisine çevirir; güne göre sıralı."""
    cikti = []
    for s in satirlar:
        g = _tarih(s.get("event_ts", ""))
        f = s.get("fiyat")
        if g is None or not isinstance(f, (int, float)) or f <= 0:
            continue
        cikti.append((g, float(f)))
    cikti.sort(key=lambda x: x[0])
    return cikti


def _son_gozlem(seri, tarih: datetime.date):
    """`tarih` ve öncesindeki SON gözlem. Yoksa None."""
    bulunan = None
    for g, f in seri:
        if g <= tarih:
            bulunan = (g, f)
        else:
            break
    return bulunan


def donem_getirisi(seri, referans: datetime.date, gun_geri: int) -> dict | None:
    """
    Bir dönemin getirisi. Hesaplanamıyorsa None — TAHMİN ETMEZ.

    Döner: {"getiri": oran, "taban_gun": "YYYY-MM-DD", "son_gun": ..., "gun": n}
    """
    if not seri:
        return None
    kesim = referans - datetime.timedelta(days=gun_geri)
    taban = _son_gozlem(seri, kesim)
    son = _son_gozlem(seri, referans)
    if taban is None or son is None or taban[0] >= son[0]:
        return None
    # Dönem başı gözlemi kesime çok uzaksa bu artık "1 yıllık getiri" değildir.
    if (kesim - taban[0]).days > TABAN_TOLERANS_GUN:
        return None
    if taban[1] <= 0:
        return None
    return {
        "getiri": son[1] / taban[1] - 1.0,
        "taban_gun": taban[0].isoformat(),
        "son_gun": son[0].isoformat(),
        "gun": (son[0] - taban[0]).days,
    }


def risk_olcumleri(seri, referans: datetime.date) -> dict:
    """
    Oynaklık (yıllıklaştırılmış) ve maksimum düşüş.

    Gözlem sayısı yetmiyorsa None döner ve KAÇ gözlem bulunduğu yazılır —
    "hesaplanamadı" ile "sıfır çıktı" karışmasın.
    """
    bas = referans - datetime.timedelta(days=RISK_PENCERE_GUN)
    pencere = [(g, f) for g, f in seri if bas <= g <= referans]
    n = len(pencere)
    if n < ASGARI_RISK_GOZLEM:
        return {"oynaklik": None, "max_dusus": None, "gozlem": n}

    getiriler = []
    for i in range(1, n):
        onceki, simdiki = pencere[i - 1][1], pencere[i][1]
        if onceki > 0 and simdiki > 0:
            getiriler.append(math.log(simdiki / onceki))

    oynaklik = None
    if len(getiriler) >= 2:
        ort = sum(getiriler) / len(getiriler)
        var = sum((x - ort) ** 2 for x in getiriler) / (len(getiriler) - 1)
        oynaklik = math.sqrt(var) * math.sqrt(ISLEM_GUNU)

    # Maksimum düşüş: zirveden dibe en büyük kayıp (pozitif oran).
    zirve = pencere[0][1]
    max_dusus = 0.0
    for _, f in pencere:
        if f > zirve:
            zirve = f
        elif zirve > 0:
            max_dusus = max(max_dusus, (zirve - f) / zirve)

    return {"oynaklik": oynaklik, "max_dusus": max_dusus, "gozlem": n}


def fon_olcumleri(satirlar: list[dict], referans: datetime.date) -> dict | None:
    """
    Tek fonun bütün ölçümleri. Kullanılabilir hiç gözlem yoksa None.

    Referans gününden SONRAKİ satırlar burada eleniyor. Çağıranın doğru
    aralığı vermesini beklemek yetmez: bu katman kendi başına da doğru
    olmalı, yoksa bir gün biri geniş bir aralık verir ve tablo sessizce
    geleceği görür — "son fiyat" ileri bir tarihten gelir, `bayat_gun`
    negatife düşer, kimse fark etmez.
    """
    gecerli = sorted(
        (s for s in satirlar if (s.get("event_ts") or "")[:10] <= referans.isoformat()),
        key=lambda s: s.get("event_ts", ""))
    seri = seri_kur(gecerli)
    if not seri:
        return None
    son = gecerli[-1]
    son_gun, son_fiyat = seri[-1]

    olcum: dict = {
        "kod": son.get("kod", ""),
        "unvan": son.get("unvan", ""),
        "kategori": son.get("kategori", ""),
        "kategori_kod": son.get("kategori_kod", ""),
        "son_gun": son_gun.isoformat(),
        "fiyat": son_fiyat,
        "ilk_gun": seri[0][0].isoformat(),
        "gozlem": len(seri),
        # Kapanmış/birleşmiş fon canlılarla yan yana durmasın diye.
        "bayat_gun": (referans - son_gun).days,
        "buyukluk": son.get("buyukluk"),
        "kisi_sayisi": son.get("kisi_sayisi"),
    }
    olcum["bayat"] = olcum["bayat_gun"] > BAYATLIK_SINIRI_GUN

    for ad, gun in DONEMLER.items():
        d = donem_getirisi(seri, referans, gun)
        olcum[f"getiri_{ad}"] = d["getiri"] if d else None
        olcum[f"gun_{ad}"] = d["gun"] if d else None

    olcum.update(risk_olcumleri(seri, referans))
    return olcum


def _medyan(degerler: list[float]) -> float | None:
    v = sorted(x for x in degerler if x is not None)
    if not v:
        return None
    orta = len(v) // 2
    return v[orta] if len(v) % 2 else (v[orta - 1] + v[orta]) / 2


def _yuzdelik(deger: float, akranlar: list[float]) -> float | None:
    """
    Akranlar içindeki yüzdelik dilim (0-100, büyük = daha iyi).

    Eşitlikler yarım sayılıyor (standart yüzdelik sırası); aksi hâlde para
    piyasası fonları gibi birbirine çok yakın getirilerde sıralama keyfi olur.
    """
    n = len(akranlar)
    if n < 2:
        return None
    alt = sum(1 for v in akranlar if v < deger)
    esit = sum(1 for v in akranlar if v == deger)
    return (alt + 0.5 * esit) / n * 100.0


def tarama(satirlar: list[dict], referans: datetime.date,
           esik_kategori: str = ESIK_KATEGORI) -> dict:
    """
    Depodan gelen tüm satırları ekran tablosuna çevirir.

    Akran sırası ve eşik farkı burada ekleniyor; ikisi de fonlar ARASI
    olduğu için tek fon bazında hesaplanamaz.

    NOKTASAL-ZAMANLILIK çağıranın sorumluluğunda: `satirlar` Depo.oku'dan
    hangi `as_of` ile geldiyse, bu tablo o anın tablosudur. Burada gelecekten
    veri çekilecek bir yol YOK — sadece verilen satırlar kullanılıyor.
    """
    gruplar: dict[str, list[dict]] = {}
    for s in satirlar:
        kod = s.get("kod")
        if kod:
            gruplar.setdefault(kod, []).append(s)

    fonlar = []
    for kod, grup in gruplar.items():
        grup.sort(key=lambda x: x.get("event_ts", ""))
        o = fon_olcumleri(grup, referans)
        if o:
            fonlar.append(o)

    # Eşik: para piyasası kategorisinin MEDYAN getirisi. Ortalama değil —
    # tek bir uç fon eşiği kaydırmasın.
    esik: dict[str, float | None] = {}
    for ad in DONEMLER:
        esik[ad] = _medyan([f[f"getiri_{ad}"] for f in fonlar
                            if f["kategori_kod"] == esik_kategori
                            and f[f"getiri_{ad}"] is not None
                            and not f["bayat"]])

    # Akran sırası: KATEGORİ İÇİNDE. Hisse fonunu para piyasası fonuyla
    # sıralamak anlamsız — farklı risk, farklı iş.
    for ad in DONEMLER:
        havuz: dict[str, list[float]] = {}
        for f in fonlar:
            v = f[f"getiri_{ad}"]
            # Bayat fonlar havuza GİRMEZ: serisi aylar önce bitmiş bir fon
            # yaşayanların sırasını bozar.
            if v is not None and not f["bayat"]:
                havuz.setdefault(f["kategori_kod"], []).append(v)
        for f in fonlar:
            v = f[f"getiri_{ad}"]
            akranlar = havuz.get(f["kategori_kod"], [])
            f[f"akran_{ad}"] = (_yuzdelik(v, akranlar)
                                if v is not None and not f["bayat"] else None)
            f[f"akran_n_{ad}"] = len(akranlar)
            f[f"esik_farki_{ad}"] = (v - esik[ad]
                                     if v is not None and esik[ad] is not None
                                     else None)

    fonlar.sort(key=lambda f: (f["kategori_kod"], f["kod"]))
    return {
        "referans": referans.isoformat(),
        "esik_kategori": esik_kategori,
        "esik": esik,
        "donemler": dict(DONEMLER),
        "adet": len(fonlar),
        "fonlar": fonlar,
        # Ekranda yazması gereken uyarı — burada üretiliyor ki arayüz
        # unutamasın (PLAN_TEFAS.md §5).
        "uyari": ("Bu karşılaştırma yalnız bugün TEFAS'ta listelenen fonları "
                  "içerir. Kapanan ve birleşen fonlar yoktur; tablo gerçekte "
                  "olandan iyimserdir."),
    }
