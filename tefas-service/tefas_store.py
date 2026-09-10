"""
TEFAS deposu — noktasal-zamanlı, EKLEMELİ kayıt
==============================================
Tek işi: gelen kayıtları kaybetmeden ve GEÇMİŞİ DEĞİŞTİRMEDEN saklamak.

NEDEN EKLEMELİ (append-only)
  TEFAS bir günün değerini sonradan düzeltebilir. Üzerine yazarsak "o gün ne
  biliyorduk" sorusunun cevabı silinir; geriye dönük hesaplar sessizce bugünün
  bilgisiyle yapılır. Bu projenin en pahalı dersi buydu (MODEL_KANIT §8.2 —
  CNN Türk sızıntısı). Bu yüzden düzeltme eski satırı SİLMEZ; yeni bir satır
  ekler ve okuyucu "şu ana kadar bilinenler" diyerek süzer.

İKİ ZAMAN DAMGASI — karıştırılmamalı
  event_ts   fonun kendi günü (birim pay değerinin ait olduğu tarih)
  ingest_ts  BİZİM öğrendiğimiz an (UTC)
  Getiri hesabı event_ts ile, "o gün bilinir miydi" sorusu ingest_ts ile yanıtlanır.

GERİYE DÖNÜK DOLDURMA DÜRÜSTÇE ETİKETLENİR
  İlk kurulumda geçmiş çekilir. Bu satırların hepsinin ingest_ts'i bugündür —
  yani onları o gün bilmiyorduk. `geriye_donuk: true` bayrağı bunu açıkça
  söyler; hiçbir ölçüm "sanki canlı izliyormuşuz" gibi davranamasın.

DOSYA DÜZENİ
  <kok>/gunluk/YYYY-MM.jsonl   satır başına bir kayıt (JSON)
  Aylık bölme tarih aralığı okumalarını ucuzlatır: 3 aylık getiri için 12
  dosyanın yalnız 4'ü açılır.
"""
from __future__ import annotations

import datetime
import json
import os
import threading
from pathlib import Path

# Dedup karşılaştırmasında kullanılan sayısal alanlar. Bunlardan biri
# değiştiyse TEFAS düzeltme yapmış demektir -> yeni satır eklenir.
DEGER_ALANLARI = ("fiyat", "buyukluk", "pay_sayisi", "kisi_sayisi")


def simdi() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")


def _ay(event_ts: str) -> str:
    """'2026-09-04' -> '2026-09'. Bozuk tarihi çağıran zaten elemiş olmalı."""
    return event_ts[:7]


def _yuvarla(v):
    """
    Karşılaştırma için normalleştirme. Kayan nokta gürültüsü (62.077527 ile
    62.0775270001) sahte "düzeltme" satırları üretmesin.
    """
    if v is None:
        return None
    try:
        return round(float(v), 6)
    except (TypeError, ValueError):
        return None


class Depo:
    """
    Diske yazan/okuyan basit depo. İş parçacığı güvenli: HTTP sunucusu ve
    çekim döngüsü aynı anda dokunuyor.
    """

    def __init__(self, kok: str | Path):
        self.kok = Path(kok)
        self.gunluk = self.kok / "gunluk"
        self.gunluk.mkdir(parents=True, exist_ok=True)
        self._kilit = threading.RLock()
        # (kod, event_ts) -> son bilinen değerler. Tüm satırları bellekte
        # tutmuyoruz; yalnız bu özet — 1 yıl ~120 bin anahtar, birkaç MB.
        self._son: dict[str, tuple] = {}
        self._indeks_yuklendi = False

    # ── indeks ───────────────────────────────────────────────────────────────

    @staticmethod
    def _anahtar(kod: str, event_ts: str) -> str:
        return f"{kod}|{event_ts}"

    @staticmethod
    def _degerler(k: dict) -> tuple:
        return tuple(_yuvarla(k.get(a)) for a in DEGER_ALANLARI)

    def _indeksi_yukle(self) -> None:
        """Dedup indeksini dosyalardan kurar. Yalnız bir kez, ilk ihtiyaçta."""
        if self._indeks_yuklendi:
            return
        for p in sorted(self.gunluk.glob("*.jsonl")):
            for satir in self._dosya_oku(p):
                kod, ev = satir.get("kod"), satir.get("event_ts")
                if kod and ev:
                    self._son[self._anahtar(kod, ev)] = self._degerler(satir)
        self._indeks_yuklendi = True

    # ── dosya ────────────────────────────────────────────────────────────────

    @staticmethod
    def _dosya_oku(p: Path) -> list[dict]:
        """
        Bozuk satır TÜM dosyayı düşürmemeli. Yazma sırasında kapanan bir
        konteyner yarım satır bırakabilir; o satır atlanır, gerisi okunur.
        """
        cikti: list[dict] = []
        try:
            with open(p, "r", encoding="utf-8") as f:
                for satir in f:
                    satir = satir.strip()
                    if not satir:
                        continue
                    try:
                        cikti.append(json.loads(satir))
                    except json.JSONDecodeError:
                        continue
        except FileNotFoundError:
            return []
        return cikti

    # ── yazma ────────────────────────────────────────────────────────────────

    def yaz(self, kayitlar: list[dict], ingest_ts: str | None = None,
            geriye_donuk: bool = False) -> dict:
        """
        Kayıtları depoya ekler. Aynı (kod, gün) için değer DEĞİŞMEMİŞSE yazmaz.

        Bu tembellik şart: her gün son birkaç günü tarıyoruz; dedup olmasa
        dosya her turda binlerce gereksiz satırla şişerdi.

        Döner: {"yeni": n, "duzeltme": n, "atlanan": n}
        """
        ingest_ts = ingest_ts or simdi()
        sayac = {"yeni": 0, "duzeltme": 0, "atlanan": 0}
        with self._kilit:
            self._indeksi_yukle()
            # Aynı aya düşenleri tek dosya açılışında yaz.
            gruplar: dict[str, list[str]] = {}
            for k in kayitlar:
                kod = k.get("kod")
                ev = k.get("tarih") or k.get("event_ts")
                if not kod or not ev:
                    sayac["atlanan"] += 1
                    continue
                anahtar = self._anahtar(kod, ev)
                yeni_deger = self._degerler(k)
                eski = self._son.get(anahtar)
                if eski is not None and eski == yeni_deger:
                    sayac["atlanan"] += 1
                    continue

                satir = {
                    "kod": kod,
                    "unvan": k.get("unvan", ""),
                    "kategori_kod": k.get("kategori_kod", ""),
                    "kategori": k.get("kategori", ""),
                    "event_ts": ev,
                    "ingest_ts": ingest_ts,
                    "fiyat": _yuvarla(k.get("fiyat")),
                    "buyukluk": _yuvarla(k.get("buyukluk")),
                    "pay_sayisi": _yuvarla(k.get("pay_sayisi")),
                    "kisi_sayisi": _yuvarla(k.get("kisi_sayisi")),
                }
                if geriye_donuk:
                    satir["geriye_donuk"] = True
                if eski is not None:
                    # Düzeltme: eski satır SİLİNMEZ, üstüne yeni satır eklenir.
                    satir["duzeltme"] = True
                    sayac["duzeltme"] += 1
                else:
                    sayac["yeni"] += 1

                gruplar.setdefault(_ay(ev), []).append(
                    json.dumps(satir, ensure_ascii=False))
                self._son[anahtar] = yeni_deger

            for ay, satirlar in gruplar.items():
                p = self.gunluk / f"{ay}.jsonl"
                with open(p, "a", encoding="utf-8") as f:
                    f.write("\n".join(satirlar) + "\n")
                    f.flush()
                    os.fsync(f.fileno())
        return sayac

    # ── okuma ────────────────────────────────────────────────────────────────

    def oku(self, bas: str | None = None, bit: str | None = None,
            kod: str | None = None, kategori_kod: str | None = None,
            as_of: str | None = None) -> list[dict]:
        """
        [bas, bit] aralığındaki kayıtları döndürür (event_ts'e göre sıralı).

        `as_of` verilirse yalnız O ANA KADAR ÖĞRENDİKLERİMİZ döner — sonradan
        gelen düzeltmeler görünmez. Geriye dönük bir ölçüm yapılacaksa doğru
        kullanım budur; verilmezse bilinen en güncel değer döner.

        Her (kod, gün) için TEK satır döner: as_of süzgecinden geçenlerin en
        yeni ingest_ts'li olanı.
        """
        with self._kilit:
            en_iyi: dict[str, dict] = {}
            for p in self._ilgili_dosyalar(bas, bit):
                for s in self._dosya_oku(p):
                    ev = s.get("event_ts", "")
                    if bas and ev < bas:
                        continue
                    if bit and ev > bit:
                        continue
                    if kod and s.get("kod") != kod:
                        continue
                    if kategori_kod and s.get("kategori_kod") != str(kategori_kod):
                        continue
                    if as_of and s.get("ingest_ts", "") > as_of:
                        continue
                    a = self._anahtar(s.get("kod", ""), ev)
                    onceki = en_iyi.get(a)
                    if onceki is None or s.get("ingest_ts", "") >= onceki.get("ingest_ts", ""):
                        en_iyi[a] = s
            return sorted(en_iyi.values(),
                          key=lambda s: (s.get("event_ts", ""), s.get("kod", "")))

    def _ilgili_dosyalar(self, bas: str | None, bit: str | None) -> list[Path]:
        """Aylık bölmenin karşılığı: aralık dışındaki dosyalar hiç açılmaz."""
        hepsi = sorted(self.gunluk.glob("*.jsonl"))
        if not bas and not bit:
            return hepsi
        secili = []
        for p in hepsi:
            ay = p.stem                      # 'YYYY-MM'
            if bas and ay < bas[:7]:
                continue
            if bit and ay > bit[:7]:
                continue
            secili.append(p)
        return secili

    def son_gun(self) -> str | None:
        """Depodaki en yeni event_ts. Yoksa None."""
        with self._kilit:
            for p in reversed(sorted(self.gunluk.glob("*.jsonl"))):
                gunler = [s.get("event_ts", "") for s in self._dosya_oku(p)]
                gunler = [g for g in gunler if g]
                if gunler:
                    return max(gunler)
        return None

    def ozet(self) -> dict:
        """Durum ekranı için: kaç satır, hangi aralık, kaç fon."""
        with self._kilit:
            satir = 0
            kodlar: set[str] = set()
            ilk = son = None
            for p in sorted(self.gunluk.glob("*.jsonl")):
                for s in self._dosya_oku(p):
                    satir += 1
                    kodlar.add(s.get("kod", ""))
                    ev = s.get("event_ts", "")
                    if ev:
                        ilk = ev if ilk is None or ev < ilk else ilk
                        son = ev if son is None or ev > son else son
            return {"satir": satir, "fon": len(kodlar),
                    "ilk_gun": ilk, "son_gun": son,
                    "ay_dosyasi": len(list(self.gunluk.glob("*.jsonl")))}
