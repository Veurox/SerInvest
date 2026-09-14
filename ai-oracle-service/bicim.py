"""
SerInvest — Kullanıcıya giden metinlerin sayı biçimi
====================================================

NEDEN AYRI BİR MODÜL
Arka uç, arayüzde olduğu gibi yazı da üretiyor: izleme maddeleri, risk
notları, sürüm açıklamaları. Bu metinler ekranda Türkçe arayüzün ortasında
görünüyor, ama Python'un varsayılan biçimi İngilizce: `%45.5`, `19,608`.
Sonuç, aynı ekranda iki ayrı yazım — "%45,5" (arayüzün ürettiği) ile
"45.5%" (arka ucun ürettiği) yan yana.

Arayüz tarafında bu iş `frontend/src/lib/format.ts` içindeki `yuzde`/`fmt`
ile çözüldü; burası onun Python ikizi. İKİSİ AYNI KARARLARI VERİR:
  • yüzde işareti sayının ÖNÜNDE:      %45,5
  • işaret en dışta:                   -%7,5   ·   +%0,7
  • ondalık ayracı virgül, binlik nokta: 1.234,56
  • değer yoksa "—" (sıfır yazmak veri yokluğunu gizlerdi)

KAPSAM: yalnız KULLANICIYA GÖRÜNEN metinler. Günlük/konsol çıktıları
(print, send_syslog) İngilizce biçimde kalır — onları okuyan bir geliştirici,
ve orada tutarlılık `grep`'e hizmet eder.
"""
from __future__ import annotations


def sayi(deger: float | int | None, basamak: int = 2,
         isaret: bool = False) -> str:
    """
    Türkçe sayı: 1.234,56 · None → '—'.

    `isaret=True` artıyı da yazar (+0,43). Beklenen değer gibi ölçülerde
    işaretin kendisi bilgidir; "0,43R" ile "+0,43R" aynı şeyi söylemez.
    Eksi işareti her hâlükârda yazılır.
    """
    if deger is None:
        return "—"
    try:
        v = float(deger)
    except (TypeError, ValueError):
        return "—"
    if v != v or v in (float("inf"), float("-inf")):   # NaN / sonsuz
        return "—"
    # Python "1,234.56" üretir; ayraçları takas et.
    metin = f"{abs(v):,.{basamak}f}"
    metin = metin.replace(",", "\x00").replace(".", ",").replace("\x00", ".")
    on = "-" if v < 0 else ("+" if isaret else "")
    return f"{on}{metin}"


def tamsayi(deger: float | int | None) -> str:
    """Binlik ayraçlı tam sayı: 19.608 · None → '—'."""
    if deger is None:
        return "—"
    try:
        return f"{int(round(float(deger))):,}".replace(",", ".")
    except (TypeError, ValueError):
        return "—"


def yuzde(deger: float | None, basamak: int = 1, isaret: bool = False) -> str:
    """
    Yüzde biçimi. `deger` ZATEN yüzde birimindedir (45.5 → '%45,5').
    Oran (0–1) elinizdeyse `oran_yuzde` kullanın.
    """
    if deger is None:
        return "—"
    try:
        v = float(deger)
    except (TypeError, ValueError):
        return "—"
    if v != v or v in (float("inf"), float("-inf")):   # NaN / sonsuz
        return "—"
    on = "-" if v < 0 else ("+" if isaret else "")
    return f"{on}%{sayi(abs(v), basamak)}"


def oran_yuzde(deger: float | None, basamak: int = 1, isaret: bool = False) -> str:
    """Oranı (0–1) yüzdeye çevirip biçimler: 0.455 → '%45,5'."""
    if deger is None:
        return "—"
    try:
        return yuzde(float(deger) * 100, basamak, isaret)
    except (TypeError, ValueError):
        return "—"
