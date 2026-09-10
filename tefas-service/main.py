"""
SerInvest TEFAS Servisi (Faz 1 — veri hattı)
============================================
İki iş yapar:
  1. TEFAS'tan günlük fon verisini çeker ve noktasal-zamanlı olarak saklar
  2. Sakladığını HTTP üzerinden verir (core-api proxy'ler, arayüz oradan okur)

NEDEN AYRI SERVİS
  TEFAS resmi belgelenmiş bir API değil, sitenin kendi uç noktası. Kırılgan.
  Çökerse fiyat hattını (market-data) düşürmemeli.

NEDEN RABBITMQ/POSTGRES DEĞİL (11.09.2026 kararı — docs/PLAN_TEFAS.md §3)
  Fon verisi 5 dakikalık tick değil, günde tek satır. Mevcut PriceData tablosu
  OHLCV için biçimlenmiş; fonu oraya koymak High/Low/hacim alanlarını sıfırla
  doldurmayı gerektirirdi — tam da yasakladığımız şey (tefas_api.normalize'ın
  testi bunu koruyor). Ayrıca depo EKLEMELİ; bir EF tablosu upsert'e davet eder
  ve "o gün ne biliyorduk" cevabını sessizce siler. Grafik verisi zaten
  core-api -> market-data HTTP proxy'siyle akıyor; aynı desen izleniyor.

ZAMANLAMA
  Birim pay değeri akşam yayımlanır. Günde bir kez, TEFAS_CEKIM_SAATI'nden
  sonra çekilir. Pencere son birkaç gündür: geç yayımlanan ve düzeltilen
  kayıtlar da yakalansın (depo zaten değişmeyeni yazmıyor).
"""
from __future__ import annotations

import datetime
import json
import os
import threading
import time
import traceback
from pathlib import Path

from flask import Flask, jsonify, request

import tefas_api
from tefas_store import Depo, simdi

VERI_DIZINI = Path(os.getenv("TEFAS_DATA_DIR", "/app/data"))
HTTP_PORT = int(os.getenv("TEFAS_HTTP_PORT", "5003"))
# Yayın akşam; 21:00'de çekmek güvenli. Kaçırılırsa döngü sonraki turda alır.
CEKIM_SAATI = int(os.getenv("TEFAS_CEKIM_SAATI", "21"))
# Geç yayın + düzeltme yakalamak için geriye bakılan gün sayısı.
PENCERE_GUN = int(os.getenv("TEFAS_PENCERE_GUN", "7"))
# İlk kurulumda çekilecek geçmiş. 13 ay = 1 yıllık getiri + pay.
GERIYE_AY = int(os.getenv("TEFAS_GERIYE_AY", "13"))
DONGU_SN = int(os.getenv("TEFAS_DONGU_SN", "900"))     # 15 dk'da bir kontrol
# Hız sınırına takılınca ne kadar susulacak. TEFAS'ın sınırı birikimli
# (bkz. tefas_api.BEKLEME_SN notu): takıldıktan sonra ısrar etmek değil,
# çekilip beklemek gerekiyor.
SOGUMA_DK = int(os.getenv("TEFAS_SOGUMA_DK", "45"))


def _kategorileri_yukle() -> list[str]:
    """
    İzlenen kategoriler TEK KAYNAKTAN gelir: shared/symbols.json.

    Diğer servisler (market-data, oracle, fundamental) sembol listesini zaten
    oradan okuyor; fon kategorilerini koda gömmek ikinci bir doğru kaynak
    yaratırdı. Sıra: env > symbols.json > tefas_api varsayılanı.

    symbols.json'daki isimler tefas_api.KATEGORILER'e de işlenir; yoksa yeni
    eklenen bir kategori arayüzde ham kodla ("103") görünürdü.
    """
    env = (os.getenv("TEFAS_KATEGORILER") or "").strip()
    if env:
        return [k.strip() for k in env.split(",") if k.strip()]
    for p in (Path("/shared/symbols.json"),
              Path(__file__).parent.parent / "shared" / "symbols.json"):
        try:
            if not p.exists():
                continue
            fon = json.loads(p.read_text(encoding="utf-8")).get("fund", {})
            kat = fon.get("kategori") or {}
            if kat:
                tefas_api.KATEGORILER.update({str(k): str(v) for k, v in kat.items()})
                return [str(k) for k in kat]
        except Exception as e:
            print(f"[symbols] {p} okunamadı: {e}")
    print("[symbols] UYARI: fon kategorileri symbols.json'dan alınamadı, "
          "tefas_api varsayılanı kullanılıyor")
    return list(tefas_api.KATEGORILER)


KATEGORILER = _kategorileri_yukle()

DEPO = Depo(VERI_DIZINI)
DURUM_DOSYA = VERI_DIZINI / "durum.json"
_DURUM_KILIT = threading.RLock()


# ── durum (kalıcı) ───────────────────────────────────────────────────────────

def durum_oku() -> dict:
    try:
        return json.loads(DURUM_DOSYA.read_text(encoding="utf-8"))
    except Exception:
        return {}


def durum_yaz(guncelle: dict) -> dict:
    """
    Durum diskte tutulur: konteyner yeniden başladığında geriye dönük doldurma
    baştan başlamasın (TEFAS'ı boşuna yormayalım).
    """
    with _DURUM_KILIT:
        d = durum_oku()
        d.update(guncelle)
        try:
            DURUM_DOSYA.parent.mkdir(parents=True, exist_ok=True)
            DURUM_DOSYA.write_text(json.dumps(d, ensure_ascii=False, indent=2),
                                   encoding="utf-8")
        except Exception as e:
            print(f"[durum] yazılamadı: {e}")
        return d


# ── çekim ────────────────────────────────────────────────────────────────────

def _bugun() -> datetime.date:
    return datetime.datetime.now().date()


def soguma_baslat() -> None:
    """Sınıra dokunduk: bir süre hiç istek atma."""
    kadar = (datetime.datetime.now(datetime.timezone.utc)
             + datetime.timedelta(minutes=SOGUMA_DK)).isoformat(timespec="seconds")
    durum_yaz({"soguma_kadar": kadar})
    print(f"[tefas] hız sınırına dokunuldu — {SOGUMA_DK} dk susuluyor ({kadar})")


def soguma_kalan() -> str | None:
    """Soğuma sürüyorsa bitiş anını, sürmüyorsa None döner."""
    kadar = durum_oku().get("soguma_kadar")
    return kadar if kadar and simdi() < kadar else None


def kurulum_gunu() -> str:
    """
    Servisin ilk çalıştığı gün. "Geriye dönük" etiketi buna göre verilir:
    bu günden ÖNCEKİ her satırı canlı izleyemezdik, sonradan öğrendik.
    """
    d = durum_oku()
    ilk = d.get("ilk_kurulum")
    if not ilk:
        ilk = simdi()
        durum_yaz({"ilk_kurulum": ilk})
    return ilk[:10]


def cek_ve_yaz(bas: datetime.date, bit: datetime.date,
               etiket: str = "gunluk") -> dict:
    """
    Bir tarih aralığını çeker ve depoya yazar.

    Bir kategori patlarsa diğerleri sürer (tefas_api.kategoriler_cek). Hatalar
    yutulmaz; durum dosyasına ve /durum çıktısına yazılır — sessiz bozulma
    bu projede en pahalı hata türü.

    `geriye_donuk` bayrağı AY bazında değil SATIR bazında verilir: kurulumdan
    önceki günleri izleyemezdik, sonrakileri izleyebilirdik. Kaba bir "bu ay
    geçmiştendir" etiketi, kurulum ayının ilk günlerini yanlışlıkla canlı
    toplanmış gibi gösterirdi.
    """
    t0 = time.time()
    ingest = simdi()
    once = tefas_api.OLAY["hiz_siniri"]
    try:
        kayitlar, hatalar = tefas_api.kategoriler_cek(bas, bit, kodlar=KATEGORILER)
    except Exception as e:
        traceback.print_exc()
        return {"ok": False, "hata": str(e), "sn": round(time.time() - t0, 1)}

    # Sayaç arttıysa sınıra dokunduk demektir — hata metnine bakmıyoruz,
    # metin biçimi değişince sessizce bozulacak bir kontrol olurdu.
    if tefas_api.OLAY["hiz_siniri"] > once:
        soguma_baslat()

    kurulum = kurulum_gunu()
    eski = [k for k in kayitlar if (k.get("tarih") or "") < kurulum]
    canli = [k for k in kayitlar if (k.get("tarih") or "") >= kurulum]
    sayac = {"yeni": 0, "duzeltme": 0, "atlanan": 0}
    for grup, bayrak in ((eski, True), (canli, False)):
        if not grup:
            continue
        for k, v in DEPO.yaz(grup, ingest_ts=ingest, geriye_donuk=bayrak).items():
            sayac[k] += v
    sonuc = {
        "ok": not hatalar or bool(kayitlar),
        "etiket": etiket,
        "bas": bas.isoformat(), "bit": bit.isoformat(),
        "cekilen": len(kayitlar),
        "yeni": sayac["yeni"], "duzeltme": sayac["duzeltme"],
        "degismeyen": sayac["atlanan"],
        "hatalar": hatalar,
        "ingest_ts": ingest,
        "sn": round(time.time() - t0, 1),
    }
    print(f"[tefas] {etiket} {bas}..{bit}: {len(kayitlar)} kayıt, "
          f"yeni {sayac['yeni']}, düzeltme {sayac['duzeltme']}, "
          f"{sonuc['sn']}sn, hata {len(hatalar)}")
    return sonuc


def _ay_araliklari(ay_sayisi: int) -> list[tuple[datetime.date, datetime.date]]:
    """Geriye dönük doldurmayı aylık dilimlere böler (tek dev sorgu yerine)."""
    bugun = _bugun()
    dilimler = []
    yil, ay = bugun.year, bugun.month
    for _ in range(ay_sayisi):
        bas = datetime.date(yil, ay, 1)
        # Ayın son günü: bir sonraki ayın 1'inden bir gün geri.
        sy, sa = (yil + 1, 1) if ay == 12 else (yil, ay + 1)
        bit = datetime.date(sy, sa, 1) - datetime.timedelta(days=1)
        dilimler.append((bas, min(bit, bugun)))
        yil, ay = (yil - 1, 12) if ay == 1 else (yil, ay - 1)
    return list(reversed(dilimler))          # eskiden yeniye


def geriye_donuk_doldur() -> None:
    """
    İlk kurulumda geçmişi doldurur. Ay ay ilerler ve her aydan sonra durumu
    diske yazar: yeniden başlatma kaldığı yerden devam eder.

    Kurulumdan önceki satırlar `geriye_donuk: true` ile işaretlenir (bkz.
    cek_ve_yaz) — onları o gün BİLMİYORDUK. İşaret olmasa geriye dönük bir
    ölçüm bunları canlı toplanmış veriyle karıştırırdı.

    "Bitti" bayrağına GÜVENİLMEZ, her turda hedefle karşılaştırılır: kullanıcı
    TEFAS_GERIYE_AY'ı sonradan büyütürse yeni aylar kendiliğinden çekilsin.
    """
    d = durum_oku().get("geriye_donuk", {})
    tamam = set(d.get("tamamlanan_ay", []))
    dilimler = _ay_araliklari(GERIYE_AY)
    kalan = [x for x in dilimler if x[0].strftime("%Y-%m") not in tamam]
    if not kalan:
        if not d.get("bitti"):
            durum_yaz({"geriye_donuk": {"bitti": True,
                                        "tamamlanan_ay": sorted(tamam),
                                        "biten_ts": simdi()}})
        return

    # HER TURDA TEK AY. Peş peşe 13 ay çekmek, ikinci saha ölçümünde siteyi
    # birikimli sınıra soktu ve sonunda tek günlük sorgular bile reddedilir
    # oldu. Turlar arası 15 dk olduğu için 13 ay ~3,5 saate yayılır: bizim
    # için fark etmez (bir kerelik), site için görünmez bir yük olur.
    bas, bit = kalan[0]
    etiket = bas.strftime("%Y-%m")
    print(f"[tefas] geriye dönük doldurma: {etiket} çekiliyor, "
          f"{len(kalan)} ay kaldı ({GERIYE_AY} ay hedef)")
    s = cek_ve_yaz(bas, bit, etiket=f"geçmiş {etiket}")
    if not s.get("ok") or s.get("hatalar"):
        # Ay tamamlanmış SAYILMAZ; sonraki turda baştan denenir. Yarım ayı
        # tam saymak, o aydan sonsuza kadar eksik veriyle yaşamak demekti.
        print(f"[tefas] {etiket} tamamlanamadı, sonraki turda denenecek")
        durum_yaz({"son_hata": s, "son_hata_ts": simdi()})
        return
    tamam.add(etiket)
    durum_yaz({"geriye_donuk": {"bitti": len(tamam) >= GERIYE_AY,
                                "tamamlanan_ay": sorted(tamam)}})
    if len(tamam) >= GERIYE_AY:
        print("[tefas] geriye dönük doldurma tamamlandı")


def gunluk_cekim() -> dict:
    bit = _bugun()
    bas = bit - datetime.timedelta(days=PENCERE_GUN)
    s = cek_ve_yaz(bas, bit, etiket="günlük")
    durum_yaz({"son_cekim": s, "son_cekim_ts": simdi()})
    if s.get("ok") and s.get("cekilen", 0) > 0:
        durum_yaz({"son_basarili_gun": bit.isoformat()})
    return s


def dongu() -> None:
    """
    Arka plan işçisi. Önce geçmişi doldurur, sonra günde bir kez çeker.

    Açılışta hemen bir çekim yapılır: taze kurulmuş bir konteyner akşamı
    beklemeden elindekini alsın (gün içi sorgu boş dönerse zararı yok).
    """
    time.sleep(5)
    while True:
        try:
            kadar = soguma_kalan()
            if kadar:
                print(f"[tefas] soğuma sürüyor ({kadar}) — bu tur atlanıyor")
            else:
                # Sıra önemli: güncel gün geçmişten önce gelir. Geriye dönük
                # doldurma saatler sürüyor; bugünün verisi onu beklememeli.
                son = durum_oku().get("son_basarili_gun")
                saat = datetime.datetime.now().hour
                # İlk açılışta (son is None) saati bekleme: taze kurulmuş bir
                # konteyner elindekini hemen alsın.
                gunluk_zamani = (son != _bugun().isoformat()
                                 and (son is None or saat >= CEKIM_SAATI))
                if gunluk_zamani:
                    gunluk_cekim()
                else:
                    geriye_donuk_doldur()
        except Exception:
            traceback.print_exc()
        time.sleep(DONGU_SN)


# ── HTTP ─────────────────────────────────────────────────────────────────────

app = Flask(__name__)


@app.after_request
def _cors(resp):
    # Tek kullanıcı / lokal — market-data-service ile aynı yaklaşım.
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return resp


@app.route("/health")
def health():
    return jsonify({"ok": True, "service": "tefas"})


@app.route("/durum")
def durum():
    """
    Ne var, ne zaman geldi, ne bozuldu. Sessiz bozulmayı görünür kılmak için:
    veri gelmiyorsa buradan anlaşılmalı, aylar sonra fark edilmemeli.
    """
    d = durum_oku()
    o = DEPO.ozet()
    gd = d.get("geriye_donuk", {})
    tamamlanan = len(gd.get("tamamlanan_ay", []))
    return jsonify({
        "ok": True,
        "depo": o,
        "kategoriler": {k: tefas_api.KATEGORILER.get(k, k) for k in KATEGORILER},
        "son_cekim": d.get("son_cekim"),
        "son_basarili_gun": d.get("son_basarili_gun"),
        "ilk_kurulum": d.get("ilk_kurulum"),
        "geriye_donuk": {
            # Kaydedilmiş "bitti" bayrağına GÜVENİLMEZ: hedef ay sayısı
            # sonradan büyütülmüş olabilir ve bayrak eski hedefe göre yazılmıştır.
            # İşçi de aynı şekilde her turda hedefle karşılaştırıyor.
            "bitti": tamamlanan >= GERIYE_AY,
            "tamamlanan_ay": tamamlanan,
            "kalan_ay": max(GERIYE_AY - tamamlanan, 0),
            "hedef_ay": GERIYE_AY,
        },
        "cekim_saati": CEKIM_SAATI,
        "pencere_gun": PENCERE_GUN,
        # Hız sınırına toslanıyorsa buradan görünsün. Sessiz yavaşlama, bu
        # projede en geç fark edilen arıza türü.
        "hiz_siniri": dict(tefas_api.OLAY),
        "soguma_kadar": soguma_kalan(),
    })


@app.route("/fonlar")
def fonlar():
    """
    Bir günün fon listesi. `gun` verilmezse depodaki en son gün.
    `as_of` verilirse o ana kadar öğrendiklerimiz (noktasal-zamanlı okuma).
    """
    gun = (request.args.get("gun") or "").strip() or DEPO.son_gun()
    if not gun:
        return jsonify({"gun": None, "fonlar": [],
                        "not": "depo boş — ilk çekim henüz yapılmadı"})
    kategori = (request.args.get("kategori") or "").strip() or None
    as_of = (request.args.get("as_of") or "").strip() or None
    satirlar = DEPO.oku(bas=gun, bit=gun, kategori_kod=kategori, as_of=as_of)
    return jsonify({"gun": gun, "adet": len(satirlar), "fonlar": satirlar})


@app.route("/fon/<kod>")
def fon(kod: str):
    """Tek fonun seri geçmişi. Grafik ve getiri hesapları buradan beslenir."""
    kod = kod.upper().strip()
    try:
        gun_sayisi = min(max(int(request.args.get("gun", "400")), 1), 2000)
    except ValueError:
        gun_sayisi = 400
    bit = _bugun()
    bas = bit - datetime.timedelta(days=gun_sayisi)
    as_of = (request.args.get("as_of") or "").strip() or None
    satirlar = DEPO.oku(bas=bas.isoformat(), bit=bit.isoformat(),
                        kod=kod, as_of=as_of)
    if not satirlar:
        return jsonify({"kod": kod, "nokta": [], "bulunamadi": True}), 404
    son = satirlar[-1]
    return jsonify({
        "kod": kod,
        "unvan": son.get("unvan", ""),
        "kategori": son.get("kategori", ""),
        "kategori_kod": son.get("kategori_kod", ""),
        "nokta": [{"t": s["event_ts"], "f": s["fiyat"],
                   "buyukluk": s.get("buyukluk"),
                   "kisi": s.get("kisi_sayisi")} for s in satirlar],
    })


@app.route("/kategoriler")
def kategoriler():
    gun = DEPO.son_gun()
    sayim: dict[str, int] = {}
    if gun:
        for s in DEPO.oku(bas=gun, bit=gun):
            kk = s.get("kategori_kod", "")
            sayim[kk] = sayim.get(kk, 0) + 1
    return jsonify({"gun": gun, "kategoriler": [
        {"kod": k, "ad": tefas_api.KATEGORILER.get(k, k), "fon": sayim.get(k, 0)}
        for k in KATEGORILER
    ]})


def main() -> None:
    print(f"SerInvest TEFAS servisi başlatılıyor — kategoriler: {KATEGORILER}")
    print(f"  veri: {VERI_DIZINI} · port: {HTTP_PORT} · çekim saati: {CEKIM_SAATI}")
    threading.Thread(target=dongu, daemon=True, name="tefas-cekim").start()
    app.run(host="0.0.0.0", port=HTTP_PORT, debug=False,
            use_reloader=False, threaded=True)


if __name__ == "__main__":
    main()
