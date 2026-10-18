"""
SerInvest — Öz Denetim (Değişmezler)
=====================================
docs/SAGLAMLIK_PLANI.md Katman 1.

NEDEN: 08/2026 denetiminde 23 kusurun 9'u "sessiz başarısızlık"tı — sistem hata
vermiyor, sessizce yanlış davranıyordu (terfi terazisi bozuk olduğu için model
bir ay donuk kaldı ve tek uyarı çıkmadı). Bu dosya, sistemde DOĞRU OLMASI
GEREKEN ifadeleri çalıştırılabilir hale getirir.

Her değişmez şunu döndürür:
    {"id", "title", "status": PASS|WARN|FAIL|SKIP, "detail"}

SKIP = henüz veri yok (hata değil). WARN = incelenmeli. FAIL = bozuk.

Çalıştırma:
    docker compose exec ai-oracle-service python -m selftest
    GET /admin/selftest        (arayüzde görünür)
    main.py boot'ta otomatik
"""
import csv
import datetime
import json
import re
from collections import Counter

import numpy as np

from ml.config import (
    CALIB_REPORT_FILE,
    CALIBRATOR_META_FILE,
    DRIFT_REPORT_FILE,
    JOB_OVERDUE_HOURS,
    META_FILE,
    ML_DIR,
    PREDICTION_LOG,
    PROMOTION_LOG,
    FEATURE_LOG_FILE,
    SELFTEST_FILE,
    SELFTEST_SKEW_TOL,
    STRONG_BUY_P,
)

TRADES_FILE = ML_DIR.parent / "paper_trades.csv"


# ── Yardımcılar ──────────────────────────────────────────────────────────────
def _ok(i, t, d=""):   return {"id": i, "title": t, "status": "PASS", "detail": d}
def _warn(i, t, d):    return {"id": i, "title": t, "status": "WARN", "detail": d}
def _fail(i, t, d):    return {"id": i, "title": t, "status": "FAIL", "detail": d}
def _skip(i, t, d):    return {"id": i, "title": t, "status": "SKIP", "detail": d}


def _read_csv(path) -> list[dict]:
    if not path.exists():
        return []
    with open(path, "r", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def _json(path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    except Exception:
        return {}


def _age_h(iso: str | None, now: datetime.datetime) -> float | None:
    if not iso:
        return None
    try:
        return max(0.0, (now - datetime.datetime.fromisoformat(
            iso.replace("Z", "").strip())).total_seconds() / 3600.0)
    except Exception:
        return None


def _dur(hours: float) -> str:
    """Saati okunur süreye çevirir. Gün olarak yazmak kısa süreleri yalanlıyordu:
    4 saatlik `analyze` sınırı "0 gün sınırı", 36 saatlik `health` sınırı
    "2 gün sınırı" görünüyordu (08/2026 denetim bulgusu)."""
    if hours < 48:
        return f"{hours:.0f} saat"
    return f"{hours / 24:.1f} gün"


# ═════════════════════════════════════════════════════════════════════════════
#  DEĞİŞMEZLER
# ═════════════════════════════════════════════════════════════════════════════

def i1_date_basis(now) -> dict:
    """Loglar UTC gün bazında olmalı. Yerel (TZ+03) kullanılırsa gece yarısı
    sonrası tarih UTC bugünü aşar → iki log farklı güne yazar (08/2026 hatası)."""
    t = "I1 · Log tarih bazı (UTC)"
    today = now.date().isoformat()
    bad = []
    for name, rows, key in (("predictions", _read_csv(PREDICTION_LOG), "timestamp"),
                            ("feature_log", _read_csv(FEATURE_LOG_FILE), "date")):
        if not rows:
            continue
        mx = max((r.get(key) or "")[:10] for r in rows)
        if mx > today:
            bad.append(f"{name} en yeni gün {mx} > UTC bugün {today}")
    if not bad:
        return _ok(t.split(" · ")[0], t, f"her iki log UTC bazında (bugün {today})")
    return _fail("I1", t, "; ".join(bad))


def i2_train_serve_skew(now) -> dict:
    """Loglanan ham özelliklerden yeniden hesaplanan p, kayıtlı p_up ile
    eşleşmeli. Eşleşmezse canlı çıkarım yolu eğitim yolundan sapmış demektir."""
    t = "I2 · Eğitim/canlı tutarlılığı (train-serve skew)"
    fl = _read_csv(FEATURE_LOG_FILE)
    pr = _read_csv(PREDICTION_LOG)
    if not fl or not pr:
        return _skip("I2", t, "log henüz yok")
    try:
        import pandas as pd
        import ml_live
        from ml.features import xsec_rank_latest
        from ml.config import FEATURE_NAMES, XSEC_RANK

        model = ml_live.load_champion()
        if model is None:
            return _skip("I2", t, "champion yüklü değil")

        day = max(r["date"] for r in fl)
        today_fl = [r for r in fl if r["date"] == day]
        feats = {r["symbol"]: {k: (float(r[k]) if r.get(k) not in (None, "") else np.nan)
                               for k in FEATURE_NAMES}
                 for r in today_fl}
        live = {r["symbol"]: float(r["p_up"]) for r in pr
                if (r.get("timestamp") or "")[:10] == day and r.get("p_up")}
        common = sorted(set(feats) & set(live))

        # AYNI DÖNGÜ eşleştirmesi (08/2026 bulgusu). Günde birden çok döngü
        # çalışıyor; bir döngünün özelliklerini başka bir döngünün tahminiyle
        # kıyaslamak sahte sapma üretir. `ts` varsa yalnız özellik fotoğrafına
        # YAKIN zamanlı tahminler karşılaştırılır.
        snap_ts = {r["symbol"]: (r.get("ts") or "") for r in today_fl}
        pred_ts = {}
        for r in pr:
            if (r.get("timestamp") or "")[:10] == day and r.get("p_up"):
                pred_ts[r["symbol"]] = r.get("timestamp") or ""
        if any(snap_ts.values()):
            def _sec(s):
                try:
                    return datetime.datetime.fromisoformat(s[:19]).timestamp()
                except Exception:
                    return None
            paired = []
            for s in common:
                a, b = _sec(snap_ts.get(s, "")), _sec(pred_ts.get(s, ""))
                # SIRA ÖNEMLİ (26.08.2026 bulgusu): bir döngüde önce özellik
                # fotoğrafı yazılır, SONRA tahminler. Bu yüzden eşleşen tahmin
                # fotoğraftan SONRA olmalı. Eski koşul mutlak farka bakıyordu
                # (|a-b| ≤ 600) ve tahminleri BİR SONRAKİ döngünün fotoğrafıyla
                # eşleştirebiliyordu: 13:48'in tahminleri 13:53'ün özellikleriyle
                # kıyaslanınca "39/50 sembolde sapma" gibi sahte bir İHLAL doğdu.
                # Kesitsel rank kullanıldığı için 5 dakikalık fiyat hareketi bile
                # sıraları oynatır ve p'yi belirgin değiştirir.
                if a is not None and b is not None and 0 <= (b - a) <= 600:
                    paired.append(s)
            if len(paired) >= 5:
                common = paired
            else:
                return _skip("I2", t,
                             f"{day}: aynı döngüye ait eşleşme yetersiz ({len(paired)}) — "
                             f"gün içinde birden çok döngü var")

        if len(common) < 5:
            return _skip("I2", t, f"{day} için ortak sembol yetersiz ({len(common)})")

        # Kesitsel rank TÜM günün evreni üzerinde hesaplanmalı, ortak alt küme
        # üzerinde DEĞİL. 08/2026 bulgusu: canlı döngü 50 sembolü sıralamıştı,
        # bu kontrol 47 ortak sembolü sıralıyordu; yüzdelik sıralar kayınca p
        # farklı çıkıyor ve "47/47 sembolde sapma" gibi sahte bir İHLAL doğuyordu.
        # Sıralama tam evrende yapılır, karşılaştırma ortak sembollerde.
        ranked_all = xsec_rank_latest(feats) if XSEC_RANK else feats
        use = {s: ranked_all[s] for s in common if s in ranked_all}
        common = [s for s in common if s in use]
        if len(common) < 5:
            return _skip("I2", t, f"{day}: rank sonrası ortak sembol yetersiz ({len(common)})")
        X = pd.DataFrame([[use[s].get(c, 0.0) for c in FEATURE_NAMES] for s in common],
                         columns=FEATURE_NAMES)
        recomputed = model.predict_proba(X)[:, 1]
        diffs = [abs(float(rp) - live[s]) for s, rp in zip(common, recomputed)]
        worst = max(diffs)
        if worst <= SELFTEST_SKEW_TOL:
            return _ok("I2", t, f"{day}: {len(common)} sembol, maks fark {worst:.4f}")
        n_bad = sum(1 for d in diffs if d > SELFTEST_SKEW_TOL)
        return _fail("I2", t,
                     f"{day}: {n_bad}/{len(common)} sembolde sapma, maks {worst:.4f} "
                     f"(tolerans {SELFTEST_SKEW_TOL})")
    except Exception as e:
        return _warn("I2", t, f"kontrol edilemedi: {e}")


def i3_tier_matches_confidence(now) -> dict:
    """"GÜÇLÜ" etiketi kalibre güvenle çelişemez. 08/2026'da arayüzde
    "GÜÇLÜ ALIM %53" ile "NÖTR %53" yan yana çıkıyordu."""
    t = "I3 · Kademe ↔ güven tutarlılığı"
    rows = _read_csv(PREDICTION_LOG)
    if not rows:
        return _skip("I3", t, "tahmin logu yok")
    today = now.date().isoformat()
    todays = [r for r in rows if (r.get("timestamp") or "")[:10] == today]
    if not todays:
        return _skip("I3", t, "bugüne ait tahmin yok")
    bad = []
    for r in todays:
        if "GÜÇLÜ" in (r.get("rec") or ""):
            try:
                pc = float(r.get("p_cal") or 0)
            except Exception:
                continue
            if pc < STRONG_BUY_P:
                bad.append(f"{r.get('symbol')}({pc:.3f})")
    if not bad:
        return _ok("I3", t, f"{len(todays)} tahmin tutarlı (eşik {STRONG_BUY_P})")
    return _fail("I3", t, f"{len(bad)} çelişki: {', '.join(bad[:5])}")


def i4_thresholds_from_config(now) -> dict:
    """Arayüzün gösterdiği eşikler raporda BULUNMALI — yoksa arayüz elle
    yazmak zorunda kalır (08/2026: "77/30", "600/200" hataları)."""
    t = "I4 · Eşikler config'ten yayınlanıyor"
    d, c = _json(DRIFT_REPORT_FILE), _json(CALIB_REPORT_FILE)
    missing = []
    if d and ("min_rows" not in d or "min_days" not in d):
        missing.append("drift_report.min_rows/min_days")
    if c and "min_required" not in c:
        missing.append("calibration_report.min_required")
    if not d and not c:
        return _skip("I4", t, "rapor henüz üretilmedi")
    if not missing:
        return _ok("I4", t, "drift ve kalibrasyon raporları eşiklerini yayınlıyor")
    return _fail("I4", t, "eksik alan: " + ", ".join(missing))


def i5_coverage_envelope(now) -> dict:
    """Canlı AL kapsamı, walk-forward'da GÖRÜLMÜŞ aralıkta olmalı. Dışındaysa
    model hiç doğrulanmadığı bir rejimde çalışıyor demektir."""
    t = "I5 · AL kapsamı doğrulanmış zarfta"
    rows = _read_csv(PREDICTION_LOG)
    wf = _json(ML_DIR / "validation_summary.json")
    steps = wf.get("steps") or []
    if not rows or not steps:
        return _skip("I5", t, "tahmin veya doğrulama verisi yok")
    day = max((r.get("timestamp") or "")[:10] for r in rows)
    todays = [r for r in rows if (r.get("timestamp") or "")[:10] == day]
    if not todays:
        return _skip("I5", t, "gün seçilemedi")
    cov = sum(1 for r in todays if r.get("rec_dir") == "BUY") / len(todays)
    covs = [s["buy_signals"] / s["n_test"] for s in steps
            if s.get("n_test") and s.get("buy_signals") is not None]
    if not covs:
        return _skip("I5", t, "fold kapsamı hesaplanamadı")
    lo, hi = min(covs), max(covs)
    if lo <= cov <= hi:
        return _ok("I5", t, f"{day}: kapsam %{cov*100:.0f} (zarf %{lo*100:.0f}-%{hi*100:.0f})")
    return _warn("I5", t,
                 f"{day}: kapsam %{cov*100:.0f}, doğrulanmış zarf %{lo*100:.0f}-%{hi*100:.0f} "
                 f"DIŞINDA — model hiç sınanmadığı bir rejimde")


def i11_coverage_target(now) -> dict:
    """
    Risk filtresi açıkken AL kapsamı ÖNCEDEN yazılmış hedef bantta olmalı.

    Fark I5'ten şu: I5 "model doğrulandığı rejimde mi" diye sorar (geçmiş
    fold'lardan gelen zarf). I11 ise "filtre söz verdiği işi yapıyor mu" diye
    sorar (docs/PLAN_2026-08.md §A0'da çivilenmiş %20-40 hedefi). Filtre
    bozulur veya sessizce devre dışı kalırsa I5 hâlâ geçebilir; I11 geçmez.

    Başarısızlık ölçütü de orada yazılı: 10 ardışık iş günü bant dışı kalırsa
    filtre KALDIRILIR.
    """
    t = "I11 · Risk filtresi kapsam hedefinde"
    from ml.config import COVERAGE_TARGET, RISK_FILTER_ON, RISK_FILTER_SINCE
    if not RISK_FILTER_ON:
        return _skip("I11", t, "risk filtresi kapalı")

    rows = _read_csv(PREDICTION_LOG)
    if not rows:
        return _skip("I11", t, "tahmin logu yok")

    lo, hi = COVERAGE_TARGET
    # YALNIZ filtre devredeyken üretilmiş günler. Öncesi filtresiz üretildi;
    # o veriyi filtreye göre yargılamak yanlış suçlama olur.
    days = sorted({(r.get("timestamp") or "")[:10] for r in rows
                   if (r.get("timestamp") or "")[:10] >= RISK_FILTER_SINCE})[-10:]
    if not days:
        return _skip("I11", t, f"{RISK_FILTER_SINCE} sonrası tahmin yok — filtre henüz ölçülmedi")

    # ÖLÇÜM DÜZELTMESİ (26.08.2026): kapsam düşüklüğü filtreye ancak filtre
    # SEBEP olduysa yazılır. O gün kapsam %0'a düştü ama sebep filtre değildi:
    # ham p'nin tamamı BUY_THRESHOLD'un altındaydı, filtre hiç devreye girmedi.
    # Filtreyi kaldırmak o günü düzeltmezdi. Ölçütün AMACI "filtre kapsamı
    # bantta tutuyor mu" — ölçüm de tam onu ölçmeli.
    #
    # `rec_dir_nofilter` filtre ÖNCESİ yönü taşır. Yoksa (eski satırlar) o gün
    # atfedilemez sayılır ve suçlanmaz.
    # İki ayrı "bant dışı ama filtre değil" hâli var ve KARIŞTIRILMAMALI:
    #   no_data  — filtre öncesi yön kolonu yok → ATFEDİLEMEDİ (bilmiyoruz)
    #   not_filter — kolon var, ölçüldü, sebep filtre DEĞİL (biliyoruz)
    # İkisine aynı cümleyi kurmak, bilmediğimizi biliyormuş gibi sunmak olurdu.
    outside, no_data, not_filter = [], 0, 0
    son = None
    for d in days:
        todays = [r for r in rows if (r.get("timestamp") or "")[:10] == d]
        if not todays:
            continue
        cov = sum(1 for r in todays if r.get("rec_dir") == "BUY") / len(todays)
        son = (d, cov)
        if lo <= cov <= hi:
            continue
        pre = [r.get("rec_dir_nofilter") for r in todays]
        if not any(pre):                      # kolon yok → atfedilemez
            no_data += 1
            continue
        cov_pre = sum(1 for v in pre if v == "BUY") / len(todays)
        # Filtre yalnız ELEDİĞİ için suçlanır: kapsam bandın ALTINDA ve filtre
        # ÖNCESİ kapsam bandın altında DEĞİLSE → sebep filtredir.
        if cov < lo and cov_pre >= lo:
            outside.append((d, cov, cov_pre))
        else:
            not_filter += 1

    if son is None:
        return _skip("I11", t, "kapsam hesaplanamadı")

    d, cov = son
    hedef = f"hedef %{lo*100:.0f}-%{hi*100:.0f}"
    parts = []
    if not_filter:
        parts.append(f"{not_filter} gün bant dışıydı, ölçüldü: sebebi filtre değil")
    if no_data:
        parts.append(f"{no_data} gün bant dışıydı, filtre öncesi kayıt yok — "
                     f"atfedilemedi (yeni kolon dolmaya başladı)")
    ek = (" · " + "; ".join(parts)) if parts else ""
    # Ardışık 10 gün FİLTRE YÜZÜNDEN bant dışı = plandaki başarısızlık ölçütü.
    if len(outside) >= 10:
        return _fail("I11", t,
                     f"{len(outside)} gün FİLTRE nedeniyle bant dışı ({hedef}) — plandaki "
                     f"başarısızlık ölçütü: filtre kaldırılmalı")
    if outside:
        return _warn("I11", t,
                     f"son {len(days)} günün {len(outside)}'inde filtre kapsamı "
                     f"bandın altına indirdi; {d}: %{cov*100:.0f} ({hedef}){ek}")
    return _ok("I11", t, f"{d}: kapsam %{cov*100:.0f} ({hedef}){ek}")


def i6_calibrator_sane(now) -> dict:
    """Kalibratör monoton ve [0,1] sınırlı olmalı."""
    t = "I6 · Kalibratör tutarlı (monoton, sınırlı)"
    try:
        from ml.calibration import calibrate, load_calibrator
        cal = load_calibrator()
        if cal is None:
            return _skip("I6", t, "kalibratör yok (kimlik fallback)")
        grid = [i / 20 for i in range(21)]
        vals = [calibrate(p, cal) for p in grid]
        if any(v < 0 or v > 1 for v in vals):
            return _fail("I6", t, "değerler [0,1] dışında")
        drops = [(grid[i], vals[i - 1], vals[i]) for i in range(1, len(vals))
                 if vals[i] < vals[i - 1] - 1e-9]
        if drops:
            return _fail("I6", t, f"monoton değil ({len(drops)} düşüş)")
        return _ok("I6", t, f"monoton, aralık {min(vals):.3f}-{max(vals):.3f}")
    except Exception as e:
        return _warn("I6", t, f"kontrol edilemedi: {e}")


def i7_prediction_schema(now) -> dict:
    """predictions.csv şeması geçerli olmalı. 08/2026'da atomik olmayan yazım
    yüzünden bir satırın timestamp'i "-07-08T19:..." şeklinde bozulmuştu."""
    t = "I7 · Tahmin logu şeması"
    rows = _read_csv(PREDICTION_LOG)
    if not rows:
        return _skip("I7", t, "log yok")
    need = {"timestamp", "symbol", "p_up", "rec", "rec_dir", "close"}
    missing = need - set(rows[0].keys())
    if missing:
        return _fail("I7", t, f"eksik kolon: {sorted(missing)}")
    bad_ts = [r.get("symbol") for r in rows
              if not re.match(r"^20\d\d-\d\d-\d\d", (r.get("timestamp") or ""))]
    if bad_ts:
        return _fail("I7", t, f"{len(bad_ts)} bozuk timestamp (ör. {bad_ts[:3]})")
    return _ok("I7", t, f"{len(rows)} satır, kolonlar ve zaman damgaları geçerli")


def i8_no_duplicates(now) -> dict:
    """Gün başına sembol tekil; kapanan işlem tekil olmalı."""
    t = "I8 · Mükerrer kayıt yok"
    issues = []
    pr = _read_csv(PREDICTION_LOG)
    if pr:
        c = Counter((r.get("symbol"), (r.get("timestamp") or "")[:10]) for r in pr)
        d = [k for k, v in c.items() if v > 1]
        if d:
            issues.append(f"predictions: {len(d)} mükerrer (sembol,gün)")
    fl = _read_csv(FEATURE_LOG_FILE)
    if fl:
        c = Counter((r.get("symbol"), r.get("date")) for r in fl)
        d = [k for k, v in c.items() if v > 1]
        if d:
            issues.append(f"feature_log: {len(d)} mükerrer (sembol,gün)")
    tr = _read_csv(TRADES_FILE)
    if tr:
        c = Counter((r.get("entry_date", "")[:19], r.get("symbol"), r.get("exit_date", "")[:19])
                    for r in tr)
        d = [k for k, v in c.items() if v > 1]
        if d:
            issues.append(f"paper_trades: {len(d)} mükerrer işlem")
    if not issues:
        return _ok("I8", t, "predictions, feature_log ve paper_trades temiz")
    return _fail("I8", t, "; ".join(issues))


def i9_promotion_balance(now) -> dict:
    """Terfi karşılaştırması şampiyonun GÖRMEDİĞİ tarihlerde yapılmalı.
    08/2026'da pencereler eğitim aralığının içindeydi → rakip yapısal olarak
    kazanamıyor, öğrenme döngüsü kapalı kalıyordu."""
    t = "I9 · Terfi terazisi dürüst (out-of-sample)"
    if not PROMOTION_LOG.exists():
        return _skip("I9", t, "terfi günlüğü yok")
    last = None
    for line in PROMOTION_LOG.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            try:
                last = json.loads(line)
            except Exception:
                pass
    if not last:
        return _skip("I9", t, "kayıt okunamadı")
    if last.get("balance") != "honest_oos":
        return _fail("I9", t, "son terfi kontrolü ESKİ (in-sample) teraziyle yapılmış")

    # KAYIT KENDİ DÖNEMİNE GÖRE YARGILANIR (04.09.2026 düzeltmesi).
    # Eskiden pencereler BUGÜNKÜ şampiyonun kesimiyle kıyaslanıyordu. Şampiyon
    # yeniden eğitilince kesim ileri kayıyor ve GEÇMİŞTE dürüst yapılmış bir
    # terfi kontrolü sahte İHLAL veriyordu: "pencere 2026-06-24, kesim
    # 2026-08-21 ÖNCESİNDE". Oysa o kontrol yapıldığında şampiyonun kesimi
    # 2026-06-24'tü ve pencere ondan SONRAYDI — yani dürüsttü.
    # Terfi kaydı o anki kesimi `champion_cutoff` olarak zaten saklıyor;
    # doğru referans odur. Bu, I11'in RISK_FILTER_SINCE ve kalibrasyon
    # raporunun `fitted_at` kapsam kurallarıyla aynı ilke: bir bileşen ancak
    # KENDİ döneminin verisiyle yargılanır.
    cutoff = last.get("champion_cutoff") or (_json(META_FILE) or {}).get("date_max")
    kayit_eski = bool(last.get("champion_cutoff"))
    for w in (last.get("windows") or []):
        start = (w.get("window") or "").split("→")[0]
        if cutoff and start and start < cutoff:
            return _fail("I9", t, f"pencere {start}, o günkü şampiyon kesimi {cutoff} ÖNCESİNDE")

    simdiki = (_json(META_FILE) or {}).get("date_max")
    ek = ""
    if kayit_eski and simdiki and cutoff != simdiki:
        ek = (f" · şampiyon o kayıttan sonra yeniden eğitildi (kesim şimdi {simdiki}); "
              f"sonraki terfi kontrolü yeni kesime göre ölçecek")
    return _ok("I9", t, f"dürüst terazi (kaydın kesimi {cutoff}, "
                        f"taze veri {last.get('fresh_days','?')} gün){ek}")


def i10_jobs_not_overdue(now) -> dict:
    """Zamanlanmış işler gecikmemeli. schedule kaçan işi telafi etmez —
    bilgisayar kapalıysa iş sessizce atlanır."""
    t = "I10 · Zamanlanmış işler güncel"
    stats = _json(ML_DIR / "live_accuracy.json")
    drift = _json(DRIFT_REPORT_FILE)
    last_promote = None
    if PROMOTION_LOG.exists():
        for line in PROMOTION_LOG.read_text(encoding="utf-8").splitlines():
            if line.strip():
                try:
                    last_promote = json.loads(line).get("checked_at") or last_promote
                except Exception:
                    pass
    pr = _read_csv(PREDICTION_LOG)
    late = []

    # ANALİZ saatle değil KAPANMIŞ İŞLEM GÜNÜYLE ölçülür (25.09.2026).
    # Bar kapısı seans içinde tahmini doğru şekilde reddediyor; saatle
    # ölçülünce makine yalnız gün içinde açıkken iş koşuyor ama "3 gün
    # gecikmiş" görünüyordu. Soru şu: tahmini OLMAYAN kapanmış gün var mı?
    import takvim
    if not pr:
        late.append("analyze: hiç çalışmamış")
    else:
        son_bar = max(((r.get("bar_gunu") or "").strip() or (r.get("timestamp") or "")[:10]
                       for r in pr), default=None)
        kacan = takvim.kacan_gunler(son_bar)
        if kacan:
            gun = ", ".join(g[8:10] + "." + g[5:7] for g in kacan[:5])
            late.append(f"analyze: {len(kacan)} kapanmış işlem gününün tahmini yok "
                        f"({gun}) — makine o akşamlar kapalıydı")

    for key, iso in (("evaluate", stats.get("last_eval")),
                     ("health", drift.get("computed_at")), ("promote", last_promote)):
        age = _age_h(iso, now)
        lim = JOB_OVERDUE_HOURS[key]
        if age is None:
            late.append(f"{key}: hiç çalışmamış")
        elif age > lim:
            late.append(f"{key}: {_dur(age)} gecikmiş ({_dur(lim)} sınırı)")
    # Takvim gelecek yılı kapsıyor mu? (18.10.2026) Liste elle güncellenir;
    # Kasım'dan itibaren yeni yılın tatilleri yoksa 1 Ocak'ta bayram günleri
    # işlem günü sanılır — emirler düşer, kaçan gün alarmı yanlış çalar.
    eksik = takvim.eksik_yil()
    if eksik:
        late.append(f"takvim: {eksik} tatil listesi yok (takvim.py)")

    if not late:
        return _ok("I10", t, "dört işin dördü de güncel")
    return _warn("I10", t, "; ".join(late))


def i12_calibrator_matches_reality(now) -> dict:
    """
    Kalibratör, GERÇEKLEŞEN sonuçlarla ölçülmüş olarak sapmışken pozisyon
    boyutlandırmasını beslemeye devam etmemeli.

    08/2026 denetim boşluğu: I6 kalibratörün YAPISINI sınıyor (monoton mu, aralık
    makul mu) ama çıktısını gerçekleşmeyle KARŞILAŞTIRMIYORDU. Sonuç: sağlık
    kontrolü "KALİBRASYON SAPMIŞ" derken öz denetim 11/11 PASS veriyordu ve
    Kelly, ölçümün yanlışladığı bir olasılıkla pozisyon açıyordu.

    Neden bu önemli: Kelly boyutu p_cal'e doğrusal DEĞİL — başabaş olasılığın
    (0.42) altına inince boyut sıfırlanır. Yani sapma yalnızca boyutu şişirmez,
    kararın İŞARETİNİ çevirir: "aç" ile "hiç açma" arasındaki fark.
    """
    t = "I12 · Kalibratör ↔ gerçekleşme"
    rep = _json(CALIB_REPORT_FILE)
    if not rep:
        return _skip("I12", t, "kalibrasyon raporu yok — sağlık kontrolü çalışmamış")
    st = rep.get("status")
    if st in ("NO_DATA", "COLLECTING"):
        return _skip("I12", t, rep.get("message") or f"durum {st}")
    if st == "ERROR":
        return _warn("I12", t, f"rapor hatası: {rep.get('message')}")

    dl = rep.get("day_level") or {}
    obs, pred = dl.get("observed_up"), dl.get("predicted_cal_p")
    tstat, nd = dl.get("t"), rep.get("n_days")
    if obs is None or pred is None:
        return _warn("I12", t, "gün düzeyi istatistik yok — sağlık kontrolü eski sürüm")

    # Kalibratör canlıda gerçekten boyutlandırmayı besliyor mu?
    rows = _read_csv(PREDICTION_LOG)
    uses_cal = any((r.get("p_cal") or "").strip() for r in rows[-200:])

    if st == "OK":
        return _ok("I12", t, f"gün düzeyi uyumlu (gözlenen %{obs*100:.1f} · "
                             f"kalibratör %{pred*100:.1f}, t={tstat:+.2f}, {nd} gün)")
    if not uses_cal:
        return _warn("I12", t, f"kalibratör sapmış (t={tstat:+.2f}) ama canlıda "
                               f"kullanılmıyor — boyutlandırma etkilenmiyor")
    return _fail("I12", t,
                 f"kalibratör %{pred*100:.1f} diyor, {nd} günde gözlenen %{obs*100:.1f} "
                 f"(t={tstat:+.2f}) — Kelly bu sapmış olasılıkla boyutlandırıyor. "
                 f"Çözüm: Doğrulama Çalıştır (walk-forward) ile kalibratörü tazele.")


def i14_predictions_from_closed_bars(now) -> dict:
    """
    Her tahmin TAMAMLANMIŞ bir bardan üretilmiş olmalı.

    16.09.2026'da ölçüldü: seans sürerken koşan döngü, o günün YARIM barını
    kapanış sanıyordu. 8 Eylül'de THYAO 297,75 diye loglandı, gerçek kapanış
    305,00'ti (%2,38). Hedef/stop o fiyattan ATR katı hesaplandığı için
    bariyerler kabaca bir ATR kayıyordu — ve o tahmin 10 gün sonra isabet
    oranına yazılıyordu.

    Ölçüt basit ve kaçamaksız: `bar_gunu` kolonu, kaydın YAZILDIĞI günden
    büyük olamaz ve kayıt saatiyle çelişemez. Kolon 16.09'da eklendi; öncesi
    ÖLÇÜLEMEZ, o yüzden suçlanmaz — bilmediğimizi biliyormuş gibi sunmayız.
    """
    t = "I14 · Tahminler tamamlanmış bardan"
    rows = _read_csv(PREDICTION_LOG)
    if not rows:
        return _skip("I14", t, "tahmin logu yok")

    olcülebilir = [r for r in rows if (r.get("bar_gunu") or "").strip()]
    if not olcülebilir:
        return _skip("I14", t,
                     "bar_gunu kolonu henüz dolmadı (16.09.2026'da eklendi) — "
                     "yeni tahminler biriktikçe ölçülecek")

    bozuk = []
    for r in olcülebilir:
        bg = (r.get("bar_gunu") or "").strip()
        kg = (r.get("timestamp") or "")[:10]
        if bg and kg and bg > kg:
            bozuk.append(f"{r.get('symbol')} {kg}→bar {bg}")

    n = len(olcülebilir)
    eski = len(rows) - n
    ek = f" · {eski} eski satır ölçülemiyor (kolon yoktu)" if eski else ""
    if bozuk:
        return _fail("I14", t,
                     f"{len(bozuk)} tahmin kayıt gününden SONRAKİ bir bardan "
                     f"üretilmiş görünüyor: {', '.join(bozuk[:3])}{ek}")
    return _ok("I14", t, f"{n} tahminin hepsi kendi gününde ya da öncesinde "
                         f"kapanmış bardan{ek}")


def i13_no_within_day_constant_feature(now) -> dict:
    """
    Kesitsel rank'e giren hiçbir özellik GÜN İÇİ SABİT olmamalı.

    09/2026 kod incelemesi bulgusu. `usdtry_ret5` piyasa geneli bir seri —
    aynı gün tüm sembollerde AYNI değer. XSEC_RANK bunu gün içi percentile'a
    çevirince hepsi berabere kalıyor ve pandas `rank(pct=True)` ortalama sırayı
    veriyor: (n+1)/(2n). Yani özellik, USD/TRY hakkında SIFIR bilgi taşıyor;
    taşıdığı tek şey O GÜN KAÇ SEMBOL OLDUĞU.

    Ölçüldü: 27 farklı değer, 0.510–1.000 aralığında, sembol sayısıyla
    korelasyon −0.45, ve gözlenen değerler (n+1)/(2n) formülüyle BİREBİR uyuşuyor
    (n=9 → 0.5556, n=25 → 0.5200, n=1 → 1.0000).

    İki sonucu var:
      1. Model bu özelliğe ağırlık veriyor (şampiyon künyesinde %7.3, 3. sırada)
         ama karşılığında bilgi almıyor — kapasite israfı.
      2. Gün kimliğini sızdırıyor. Saf kesitsel olması gereken modele "bugün
         hangi gün" bilgisi giriyor. Gün-içi karıştırma testinde AUC'nin
         0.50'ye düşmemesinin (0.5506 ölçüldü) sebebi budur.

    Bu bir GELECEĞE BAKMA sızıntısı DEĞİL — evren büyüklüğü o gün bilinir.
    Ama havuzlanmış AUC'yi "hisse seçme becerisi" diye okumayı geçersiz kılar.

    Çözüm iki seçenekten biri: özelliği FEATURE_NAMES'ten çıkarmak (önerilen —
    ml/experiment_xsec.py mutlak hâlinin ZARARLI olduğunu zaten ölçmüştü:
    AUC 0.46, lift −4.2p) veya rank dönüşümünden muaf tutmak. İkisi de
    şampiyonun yeniden eğitilmesini gerektirir, o yüzden karar kullanıcınındır.
    """
    t = "I13 · Kesitsel özellik dejenerasyonu"
    from ml.config import TRAIN_CACHE, XSEC_RANK, FEATURE_NAMES
    if not XSEC_RANK:
        return _skip("I13", t, "XSEC_RANK kapalı — kesitsel rank uygulanmıyor")
    if not TRAIN_CACHE.exists():
        return _skip("I13", t, "eğitim önbelleği yok")
    try:
        import pandas as pd
        d = pd.read_csv(TRAIN_CACHE, usecols=["date"] + list(FEATURE_NAMES))
        if d.empty:
            return _skip("I13", t, "eğitim önbelleği boş")
        bozuk = []
        for c in FEATURE_NAMES:
            nu = d.groupby("date")[c].nunique()
            if len(nu) and (nu <= 1).mean() > 0.9:
                bozuk.append(c)
        if not bozuk:
            return _ok("I13", t, f"{len(FEATURE_NAMES)} özelliğin hepsi gün içinde değişiyor")
        return _fail("I13", t,
                     f"{', '.join(bozuk)} gün içinde SABİT → kesitsel rank sonrası "
                     f"yalnızca evren büyüklüğünü ((n+1)/(2n)) kodluyor, bilgi taşımıyor. "
                     f"Çıkarılmalı veya rank'ten muaf tutulmalı (şampiyon yeniden eğitilir).")
    except Exception as e:
        return _warn("I13", t, f"kontrol edilemedi: {e}")


def i15_recipe_matches(now) -> dict:
    """
    Kalibratör ve şampiyon, koddaki TARİFLE kurulmuş mu? (18.10.2026)

    Kalibratör belirli bir modelin değil, tarifin walk-forward tahminleriyle
    kurulur; aynı tarifle yeniden eğitilen şampiyon için geçerli kalır. Tarif
    değişirse (özellik, LightGBM ayarı, etiket) eski kalibratör yeni modelin
    olasılıklarını yanlış çevirir — EV filtresi ve pozisyon büyüklüğü de onunla.
    Üç iz kıyaslanır: kod (ml.config.tarif_parmak_izi), şampiyon künyesi,
    kalibratör künyesi.
    """
    t = "I15 · Kalibratör ve şampiyon aynı tarifle"
    from ml.config import tarif_parmak_izi
    kod = tarif_parmak_izi()
    kal = _json(CALIBRATOR_META_FILE) or {}
    sam = _json(META_FILE) or {}
    if not kal or not sam:
        return _skip("I15", t, "kalibratör ya da şampiyon künyesi yok")
    kt, st = kal.get("tarif"), sam.get("tarif")
    if not kt or not st:
        return _skip("I15", t, "künyede tarif izi yok (18.10.2026 öncesi kayıt)")
    if kt != kod:
        return _fail("I15", t, f"kalibratör başka bir tarifin sınavından kurulmuş "
                               f"(kalibratör {kt}, kod {kod}) — canlı olasılıklar yanlış çevriliyor")
    if st != kod:
        return _warn("I15", t, f"şampiyon eski tarifle eğitilmiş (şampiyon {st}, kod {kod})")
    return _ok("I15", t, f"kod, şampiyon ve kalibratör aynı tarif ({kod})")


CHECKS = [i1_date_basis, i2_train_serve_skew, i3_tier_matches_confidence,
          i4_thresholds_from_config, i5_coverage_envelope, i6_calibrator_sane,
          i7_prediction_schema, i8_no_duplicates, i9_promotion_balance,
          i10_jobs_not_overdue, i11_coverage_target,
          i12_calibrator_matches_reality,
          i13_no_within_day_constant_feature,
          i14_predictions_from_closed_bars,
          i15_recipe_matches]



# ═════════════════════════════════════════════════════════════════════════════
#  NE YAPMALI — kullanıcıya yönelik eylem cümleleri
# ═════════════════════════════════════════════════════════════════════════════
# 09/2026 kullanıcı geri bildirimi: "kullanıcı bakınca anlamayacak bu görüntüden".
# Panel NE OLDUĞUNU söylüyordu ama NE YAPILACAĞINI söylemiyordu; teknik olmayan
# biri "I11 uyarı" görüp ne yapacağını bilemez.
#
# İki ilke:
#   1. PASS için eylem YOK. "Her şey yolunda" satırına aksiyon yazmak gürültüdür
#      ve gerçek uyarıların dikkat çekmesini zorlaştırır.
#   2. "Yapılacak bir şey yok" da geçerli bir cevaptır ve AÇIKÇA söylenir —
#      kullanıcı bir uyarı görüp boşuna endişelenmesin (özellikle SKIP'lerde).
#
# Metin, düğme adlarını Model sayfasındaki hâliyle anar ("Doğrulama Çalıştır"),
# ki kullanıcı ekranda arayacağı şeyi bilsin.
ACTIONS: dict[tuple[str, str], str] = {
    ("I1", "FAIL"): "Kayıtlar farklı tarih sistemleri kullanıyor — bu bir yazılım "
                    "hatasıdır, kendiliğinden düzelmez. Geliştiriciye bildirin.",

    ("I2", "FAIL"): "Modelin canlı çalışması eğitimdekinden farklı sonuç veriyor; "
                    "tahminlere GÜVENMEYİN. 'Veriyi yenile + eğit' ile modeli "
                    "yeniden kurun, düzelmezse bildirin.",
    ("I2", "SKIP"): "Yapılacak bir şey yok — bir sonraki analiz turunda ölçülecek.",

    ("I3", "FAIL"): "Arayüzdeki 'GÜÇLÜ ALIM' etiketi güven yüzdesiyle çelişiyor. "
                    "Bu etikete bakmayın; 'Doğrulama Çalıştır' ile kalibratörü tazeleyin.",

    ("I4", "FAIL"): "Eşikler koda gömülmüş — arayüzdeki sayılar gerçek ayarı "
                    "yansıtmayabilir. Geliştiriciye bildirin.",

    # 25.09.2026: bu metin eskiden yalnız "Doğrulama Çalıştır ile sınayın"
    # diyordu. O düğme kalibratörü de yeniler ve I12'nin ölçümünü SIFIRLAR —
    # yani bir öz denetim, diğerinin sayacını silen bir işlemi öneriyordu.
    # Ayrıca kapsamın sıfıra düşmesinin en sık sebebi rejim kapısı: o durumda
    # yapılacak bir şey yok, düğmeye basmak yalnız bedel öder.
    ("I5", "WARN"): "Model bugün alışılmadık sayıda sinyal üretti (ya da hiç üretmedi). "
                    "BIST-100 200 günlük ortalamasının altındaysa rejim kapısı yeni "
                    "alımları bilerek askıya alır — o durumda yapılacak bir şey yok. "
                    "Rejim kapısı kapalıyken birkaç gün sürerse 'Doğrulama Çalıştır' "
                    "ile sınayabilirsiniz; ancak bu kalibratörü yeniler ve kalibrasyon "
                    "ölçümünü (I12) sıfırlar — ilk dürüst okuma ~3 hafta ertelenir.",

    ("I6", "FAIL"): "Kalibratör bozuk; güven yüzdeleri anlamsız. 'Doğrulama Çalıştır' "
                    "düğmesiyle yeniden kurun.",

    ("I7", "FAIL"): "Tahmin kaydı bozulmuş. Programı kapatıp açın; düzelmezse "
                    "yedekten geri yükleme gerekir — geliştiriciye bildirin.",

    ("I8", "FAIL"): "Aynı kayıt iki kez yazılmış; isabet oranları OLDUĞUNDAN İYİ "
                    "görünebilir. Sistem kendini onarır — bir sonraki turda "
                    "düzelmezse bildirin.",

    ("I9", "FAIL"): "Terfi karşılaştırması adil değil; 'Terfi kontrolü' sonucuna "
                    "güvenmeyin. Geliştiriciye bildirin.",

    # 25.09.2026: I10 artık "tahmini olmayan KAPANMIŞ işlem günü var mı" diye
    # ölçüyor. Kaçan gün geri getirilemez (model yalnız en son bardan tahmin
    # üretir) ve seans içinde "Şimdi analiz et" bar kapısına takılır — eski
    # tavsiye ikisini de vaat ediyordu.
    ("I10", "WARN"): "Bilgisayar kapalıyken kaçan işler var. Kaçan günlerin tahmini "
                     "sonradan üretilemez. Günün analizi seans kapandıktan sonra "
                     "yapılır: programı her işlem günü akşam 18:30 ile ertesi sabah "
                     "10:00 arasında birkaç dakika açık tutun.",

    ("I11", "WARN"): "Risk filtresi bugün beklenenden fazla hisse eledi. TEK GÜNLÜK "
                     "sapma normaldir, şimdilik yapılacak bir şey yok. 10 İŞ GÜNÜ "
                     "sürerse plandaki kurala göre filtre kaldırılacak.",
    ("I11", "FAIL"): "Kapsam 10 iş günüdür hedefin dışında — plandaki başarısızlık "
                     "ölçütü doldu. Karar: risk filtresi kaldırılmalı (docs/PLAN_2026-08.md §A0).",

    ("I12", "FAIL"): "Kalibratör gerçekleşen sonuçlarla uyuşmuyor; güven yüzdeleri ve "
                     "pozisyon boyutları ŞİŞMİŞ olabilir. 'Doğrulama Çalıştır' ile "
                     "kalibratörü tazeleyin.",
    ("I12", "SKIP"): "Yapılacak bir şey yok — yeni kalibratörün sonuçları birikiyor. "
                     "Bir tahmin ancak ~20 gün sonra yargılanabildiği için ilk dürüst "
                     "okuma birkaç hafta sürer. Bu sürede 'Doğrulama Çalıştır'a "
                     "basmak kalibratörü yeniler ve sayacı SIFIRDAN başlatır.",

    ("I15", "FAIL"): "Model sayfasında 'Doğrulama Çalıştır': kalibratör yeni tarifin sınavından "
                     "yeniden kurulur. Kalibrasyon ölçümünü (I12) sıfırlar, ama yanlış "
                     "çevrilen olasılıklarla devam etmekten iyidir.",
    ("I15", "WARN"): "Kod yeni tarifte, şampiyon eskisinde. Pazar terfi sınavı yeni tarifle rakip "
                     "eğitir; geçerse şampiyon değişir. Acil değil.",

    ("I13", "FAIL"): "Bir özellik modele bilgi taşımıyor ama gün kimliği sızdırıyor; "
                     "başarı ölçümleri OLDUĞUNDAN İYİ görünebilir. Geliştiriciye "
                     "bildirin — özellik çıkarılıp model yeniden eğitilmeli.",
}

# Tabloda karşılığı olmayan (id, durum) için tür bazlı yedek cümle.
FALLBACK_ACTIONS = {
    "FAIL": "Bu kontrol bozuk bir durum bildiriyor — geliştiriciye bildirin.",
    "WARN": "İzlenmesi gereken bir durum. Tek seferlikse çoğunlukla kendiliğinden geçer.",
    "SKIP": "Yapılacak bir şey yok — henüz ölçmeye yetecek veri birikmedi.",
}


def _action_for(check: dict) -> str:
    """PASS için boş; diğerlerinde ne yapılacağını anlatan cümle."""
    if check.get("status") == "PASS":
        return ""
    key = (check.get("id", ""), check.get("status", ""))
    return ACTIONS.get(key) or FALLBACK_ACTIONS.get(check.get("status", ""), "")


def run(send_syslog=None) -> dict:
    """Tüm değişmezleri çalıştırır, sonucu diske yazar ve döndürür."""
    now = datetime.datetime.utcnow()
    results = []
    for fn in CHECKS:
        try:
            results.append(fn(now))
        except Exception as e:      # bir kontrol patlarsa diğerleri sürsün
            results.append(_warn(fn.__name__, fn.__name__, f"kontrol hatası: {e}"))

    # "Ne yapmalı" cümlesi sonuca burada eklenir: kontrolün NEDEN var olduğunu
    # bilen dosya, ne yapılacağını da bilmeli. Arayüz yalnızca gösterir.
    for r in results:
        r["action"] = _action_for(r)

    counts = Counter(r["status"] for r in results)
    overall = "FAIL" if counts["FAIL"] else "WARN" if counts["WARN"] else "PASS"
    out = {
        "computed_at": now.isoformat(),
        "overall": overall,
        "counts": dict(counts),
        "checks": results,
    }
    try:
        import ml.atomic as atomic
        atomic.write_json(SELFTEST_FILE, out)
    except Exception:
        pass

    if send_syslog:
        try:
            if overall == "FAIL":
                bad = [r["id"] for r in results if r["status"] == "FAIL"]
                send_syslog(f"[öz denetim] ✗ {len(bad)} DEĞİŞMEZ İHLALİ: {', '.join(bad)}", "ERROR")
            elif overall == "WARN":
                w = [r["id"] for r in results if r["status"] == "WARN"]
                send_syslog(f"[öz denetim] ⚠ {len(w)} uyarı: {', '.join(w)}", "WARN")
            else:
                send_syslog(f"[öz denetim] ✓ {counts['PASS']} değişmez geçti.", "SUCCESS")
        except Exception:
            pass
    return out


if __name__ == "__main__":
    r = run()
    icon = {"PASS": "✓", "WARN": "⚠", "FAIL": "✗", "SKIP": "–"}
    print("=" * 72)
    print(f"ÖZ DENETİM — genel: {r['overall']}   {r['counts']}")
    print("=" * 72)
    for c in r["checks"]:
        print(f"  {icon.get(c['status'],'?')} {c['title']}")
        print(f"      {c['detail']}")
    raise SystemExit(1 if r["overall"] == "FAIL" else 0)
