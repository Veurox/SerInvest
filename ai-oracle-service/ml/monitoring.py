"""
SerInvest ML v4 — Drift Monitörü + Kalibrasyon Takibi (Faz 4)
==============================================================
İki günlük sağlık kontrolü:

1. VERİ KAYMASI (PSI): Eğitim tabanının HAM özellik dağılımı vs son 30 günün
   canlı dağılımı. xsec-rank özellikler tanım gereği uniform olduğundan PSI
   HAM değerlerde ölçülür. Drift otomatik retrain TETİKLEMEZ (körü körüne
   retrain yok ilkesi) — syslog uyarısı + admin raporu üretir; karar insanın
   (veya Pazar korumalı promosyonun).

2. KALİBRASYON TAKİBİ: Canlı tahminlerde (predictions.csv, değerlendirilmiş)
   "model %X dedi → gerçekte %kaç çıktı" güvenilirlik tablosu + Brier/ECE.
   Kalibratör eskidiyse (canlı eğri WF eğrisinden saptıysa) burada görünür.

Her ikisi de veri yokken zarifçe "yetersiz veri" der — asla hata fırlatmaz.
"""
import csv
import datetime

import numpy as np
import pandas as pd

import ml.atomic as atomic
from ml.config import (
    CALIB_REPORT_FILE,
    DRIFT_REPORT_FILE,
    DRIFT_WINDOW_DAYS,
    FEATURE_LOG_FILE,
    FEATURE_LOG_MAX_DAYS,
    FEATURE_NAMES,
    ML_DIR,
    PREDICTION_LOG,
    PSI_ALERT,
    PSI_WATCH,
    TRAIN_CACHE,
)

MIN_LIVE_ROWS  = 200    # PSI için asgari canlı satır

# Kalibrasyon (ECE) için asgari değerlendirilmiş tahmin.
# 07/2026 bulgusu: eşik 30'du ve n=38'de "KALİBRASYON SAPMIŞ (ECE 0.151)" alarmı
# verdi. Oysa 5 bin'e bölününce bin başına ~7 örnek düşüyordu; n=8'de oranın
# standart hatası ~0.17 — gözlenen ±0.16-0.22 sapmalar tamamen yazı-tura gürültüsü.
# Anlamlı ECE için bin başına ~30 örnek gerekir → 5 bin × 30 = 150.
MIN_EVAL_ROWS  = 150

# 07/2026 bulgusu — SATIR SAYISI YANILTICI: aynı günün 50 sembolü bağımsız gözlem
# değildir. Piyasa-geneli özellikler (usdtry_ret5 gibi) tüm sembollerde AYNI değeri
# taşır → 400 satır ama yalnızca 8 bağımsız gözlem. 8 günlük canlı pencereyi 747
# günlük (3 yıl, tüm rejimler) eğitim tabanıyla kıyaslamak yapısal olarak devasa PSI
# üretir (usdtry_ret5 PSI 4.93 = yanlış alarm). Anlamlı birim GÜN'dür.
MIN_LIVE_DAYS  = 20     # ≈1 işlem ayı — altındaysa DRIFT kararı verilmez (COLLECTING)


# ═════════════════════════════════════════════════════════════════════════════
#  HAM ÖZELLİK LOGU (her analiz döngüsünde çağrılır)
# ═════════════════════════════════════════════════════════════════════════════

def log_features(raw_feats: dict) -> None:
    """
    Günün ham özellik fotoğrafını loglar. Gün+sembol başına TEK satır
    (aynı gün tekrar döngüde üzerine yazılır); FEATURE_LOG_MAX_DAYS kayan pencere.
    raw_feats: {sym: feat_dict} — fetch_snapshot'ın HAM çıktısı (rank ÖNCESİ).
    """
    today = datetime.date.today().isoformat()
    fields = ["date", "symbol"] + FEATURE_NAMES

    rows = []
    if FEATURE_LOG_FILE.exists():
        cutoff = (datetime.date.today()
                  - datetime.timedelta(days=FEATURE_LOG_MAX_DAYS)).isoformat()
        with open(FEATURE_LOG_FILE, "r", encoding="utf-8") as f:
            rows = [r for r in csv.DictReader(f)
                    if r.get("date", "") >= cutoff and r.get("date") != today]

    for sym, feat in raw_feats.items():
        row = {"date": today, "symbol": sym}
        for k in FEATURE_NAMES:
            try:
                v = feat.get(k)
                row[k] = round(float(v), 6) if v is not None and np.isfinite(float(v)) else ""
            except Exception:
                row[k] = ""
        rows.append(row)

    ML_DIR.mkdir(parents=True, exist_ok=True)
    atomic.write_csv(FEATURE_LOG_FILE, fields, rows)   # yarım yazım = bozuk log


# ═════════════════════════════════════════════════════════════════════════════
#  PSI DRIFT RAPORU
# ═════════════════════════════════════════════════════════════════════════════

def _psi(baseline: np.ndarray, live: np.ndarray, n_bins: int = 10) -> float | None:
    """Population Stability Index — baseline kantil bin'leriyle."""
    baseline = baseline[np.isfinite(baseline)]
    live = live[np.isfinite(live)]
    if len(baseline) < 100 or len(live) < 30:
        return None
    edges = np.quantile(baseline, np.linspace(0, 1, n_bins + 1))
    edges[0], edges[-1] = -np.inf, np.inf
    b_pct = np.histogram(baseline, bins=edges)[0] / len(baseline)
    l_pct = np.histogram(live, bins=edges)[0] / len(live)
    # Sıfır oranlar log'u patlatmasın
    b_pct = np.clip(b_pct, 1e-4, None)
    l_pct = np.clip(l_pct, 1e-4, None)
    return float(np.sum((l_pct - b_pct) * np.log(l_pct / b_pct)))


def compute_drift() -> dict:
    """
    Eğitim tabanı (TRAIN_CACHE, ham) vs son DRIFT_WINDOW_DAYS canlı özellik.
    Rapor DRIFT_REPORT_FILE'a yazılır ve döndürülür.
    """
    report = {
        "computed_at": datetime.datetime.utcnow().isoformat(),
        "status": "NO_DATA", "features": [], "top_drifted": [],
        "n_live": 0, "window_days": DRIFT_WINDOW_DAYS,
        "thresholds": {"watch": PSI_WATCH, "alert": PSI_ALERT},
        # UI eşikleri SABİT YAZMASIN diye gönderiliyor (07/2026: arayüzde "600/200"
        # yazıyordu ama asıl engel gün şartıydı → tamamlanmış gibi görünüyordu).
        "min_rows": MIN_LIVE_ROWS, "min_days": MIN_LIVE_DAYS,
    }
    try:
        if not TRAIN_CACHE.exists() or not FEATURE_LOG_FILE.exists():
            report["message"] = "eğitim önbelleği veya özellik logu yok"
            atomic.write_json(DRIFT_REPORT_FILE, report)
            return report

        base = pd.read_csv(TRAIN_CACHE, usecols=lambda c: c in FEATURE_NAMES or c == "date")
        cutoff = (datetime.date.today()
                  - datetime.timedelta(days=DRIFT_WINDOW_DAYS)).isoformat()
        live = pd.read_csv(FEATURE_LOG_FILE)
        live = live[live["date"] >= cutoff]
        report["n_live"] = int(len(live))
        n_days = int(live["date"].nunique()) if len(live) else 0
        report["n_live_days"] = n_days

        # İKİ kapı: yeterli satır VE yeterli BAĞIMSIZ GÜN (bkz. MIN_LIVE_DAYS notu)
        if len(live) < MIN_LIVE_ROWS or n_days < MIN_LIVE_DAYS:
            report["status"] = "COLLECTING"
            report["message"] = (f"canlı örnek birikiyor ({len(live)}/{MIN_LIVE_ROWS} satır, "
                                 f"{n_days}/{MIN_LIVE_DAYS} gün)")
            atomic.write_json(DRIFT_REPORT_FILE, report)
            return report

        # Piyasa-geneli özellikler (gün içinde tüm sembollerde aynı) — bunlarda
        # bağımsız gözlem = GÜN sayısı; günlük tek değere indirgeyip öyle kıyasla.
        market_wide = set()
        try:
            for name in FEATURE_NAMES:
                if name in live.columns and live.groupby("date")[name].nunique().max() == 1:
                    market_wide.add(name)
        except Exception:
            pass
        report["market_wide_features"] = sorted(market_wide)

        feats = []
        for name in FEATURE_NAMES:
            if name not in base.columns or name not in live.columns:
                continue
            if name in market_wide and "date" in base.columns:
                # günlük seriye indirge (her iki tarafta da) → elma-elma karşılaştırma
                b = pd.to_numeric(base.groupby("date")[name].first(), errors="coerce").to_numpy(dtype=float)
                l = pd.to_numeric(live.groupby("date")[name].first(), errors="coerce").to_numpy(dtype=float)
            else:
                b = base[name].to_numpy(dtype=float)
                l = pd.to_numeric(live[name], errors="coerce").to_numpy(dtype=float)
            psi = _psi(b, l)
            if psi is None:
                continue
            status = "DRIFT" if psi > PSI_ALERT else "WATCH" if psi > PSI_WATCH else "OK"
            feats.append({"feature": name, "psi": round(psi, 4), "status": status})

        feats.sort(key=lambda x: -x["psi"])
        report["features"] = feats
        report["top_drifted"] = [f for f in feats if f["status"] != "OK"][:5]
        n_drift = sum(1 for f in feats if f["status"] == "DRIFT")
        n_watch = sum(1 for f in feats if f["status"] == "WATCH")
        report["status"] = "DRIFT" if n_drift > 0 else "WATCH" if n_watch > 0 else "OK"
        report["message"] = f"{n_drift} DRIFT, {n_watch} İZLE / {len(feats)} özellik"
    except Exception as e:
        report["status"] = "ERROR"
        report["message"] = str(e)
    atomic.write_json(DRIFT_REPORT_FILE, report)
    return report


# ═════════════════════════════════════════════════════════════════════════════
#  KALİBRASYON TAKİBİ (canlı güvenilirlik)
# ═════════════════════════════════════════════════════════════════════════════

def calibration_report(n_bins: int = 5) -> dict:
    """
    predictions.csv'nin DEĞERLENDİRİLMİŞ satırlarından canlı güvenilirlik eğrisi:
    ham p bin'i → (öngörülen kalibre p, gözlenen UP oranı) + Brier + ECE.
    NEUTRAL sonuçlar (bariyer belirsiz) dışlanır — eğitim tanımıyla tutarlı.
    """
    report = {
        "computed_at": datetime.datetime.utcnow().isoformat(),
        "status": "NO_DATA", "n_evaluated": 0, "bins": [],
        "brier": None, "ece": None,
        "min_required": MIN_EVAL_ROWS,   # UI sabit yazmasın (bkz. compute_drift notu)
    }
    try:
        if not PREDICTION_LOG.exists():
            atomic.write_json(CALIB_REPORT_FILE, report)
            return report
        p_raw, p_cal, y = [], [], []
        with open(PREDICTION_LOG, "r", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                ev = (r.get("eval") or "").split("|")[0].strip()
                if ev not in ("UP", "DOWN"):
                    continue
                try:
                    p_raw.append(float(r["p_up"]))
                    pc = r.get("p_cal")
                    p_cal.append(float(pc) if pc not in (None, "") else float(r["p_up"]))
                    y.append(1 if ev == "UP" else 0)
                except Exception:
                    continue

        n = len(y)
        report["n_evaluated"] = n
        if n < MIN_EVAL_ROWS:
            report["status"] = "COLLECTING"
            report["message"] = f"değerlendirilmiş tahmin birikiyor ({n}/{MIN_EVAL_ROWS})"
            atomic.write_json(CALIB_REPORT_FILE, report)
            return report

        P_raw, P_cal, Y = np.array(p_raw), np.array(p_cal), np.array(y)
        report["brier"] = round(float(np.mean((P_cal - Y) ** 2)), 4)

        edges = np.quantile(P_raw, np.linspace(0, 1, n_bins + 1))
        ece, bins = 0.0, []
        for i in range(n_bins):
            lo, hi = float(edges[i]), float(edges[i + 1])
            m = (P_raw >= lo) & (P_raw <= hi if i == n_bins - 1 else P_raw < hi)
            if m.sum() == 0:
                continue
            pred, obs = float(P_cal[m].mean()), float(Y[m].mean())
            ece += (m.sum() / n) * abs(pred - obs)
            bins.append({
                "raw_p_range": [round(lo, 3), round(hi, 3)], "n": int(m.sum()),
                "predicted_cal_p": round(pred, 4), "observed_up": round(obs, 4),
                "gap": round(obs - pred, 4),
            })
        report["bins"] = bins
        report["ece"] = round(float(ece), 4)
        # ECE > 0.10 → kalibratör canlı dağılımdan sapmış; WF yeniden çalıştırılmalı
        report["status"] = "MISCALIBRATED" if ece > 0.10 else "OK"
        report["message"] = f"ECE {ece:.3f} (n={n}) — {'kalibratörü tazele (walk-forward)' if ece > 0.10 else 'kalibrasyon sağlıklı'}"
    except Exception as e:
        report["status"] = "ERROR"
        report["message"] = str(e)
    atomic.write_json(CALIB_REPORT_FILE, report)
    return report


# ═════════════════════════════════════════════════════════════════════════════
#  GÜNLÜK KOŞUCU (main.py schedule 19:20)
# ═════════════════════════════════════════════════════════════════════════════

def run_daily_checks(send_syslog=None) -> dict:
    """
    Drift + kalibrasyon raporlarını üretir; sonucu syslog'a düşürür.

    HER durumda log basar (07/2026 bulgusu: COLLECTING durumunda sessiz kalıyordu →
    "monitör çalıştı mı, çöktü mü?" ayırt edilemiyordu). Sessizlik ≠ sağlıklı.
    """
    drift = compute_drift()
    calib = calibration_report()
    if send_syslog is not None:
        try:
            ds, cs = drift.get("status"), calib.get("status")
            if ds == "DRIFT":
                tops = ", ".join(f"{f['feature']}={f['psi']}" for f in drift["top_drifted"][:3])
                send_syslog(f"[monitör] ⚠ VERİ KAYMASI: {drift['message']} — {tops}. "
                            f"Retrain kararı korumalı promosyonda.", "WARN")
            if cs == "MISCALIBRATED":
                send_syslog(f"[monitör] ⚠ KALİBRASYON SAPMIŞ: {calib['message']}", "WARN")
            if ds in ("ERROR",) or cs in ("ERROR",):
                send_syslog(f"[monitör] ✗ HATA — drift: {drift.get('message')} | "
                            f"kalibrasyon: {calib.get('message')}", "ERROR")
            elif ds == "OK" and cs == "OK":
                send_syslog("[monitör] Günlük sağlık: drift OK, kalibrasyon OK.", "INFO")
            elif ds not in ("DRIFT",) and cs not in ("MISCALIBRATED",):
                # COLLECTING / NO_DATA — henüz karar verilemiyor ama ÇALIŞTIĞI görünsün
                send_syslog(f"[monitör] Sağlık kontrolü çalıştı — drift: {ds} "
                            f"({drift.get('message')}) | kalibrasyon: {cs} "
                            f"({calib.get('message')})", "INFO")
        except Exception:
            pass
    return {"drift": drift, "calibration": calib}
