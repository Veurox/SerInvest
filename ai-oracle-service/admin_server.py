"""
SerInvest Oracle — Admin HTTP Server (Flask, port 5001)
========================================================
Frontend butonlarından tetiklenen yönetim API'si — ml v3 (saf teknik champion)
sistemine bağlı. Flask arka plan thread'inde çalışır.

Endpoint'ler:
  GET  /admin/status              - Champion durumu + son walk-forward + canlı doğruluk
  GET  /admin/drift               - (ml v3'te otomatik retrain yok) bilgilendirme
  GET  /admin/feature-importance  - Champion (21 saf teknik) feature önemleri
  GET  /admin/symbols             - BIST/Commodity/Forex sembol listesi
  GET  /admin/prediction-log      - 10g tahmin geçmişi + AL precision özeti
  GET  /admin/training-info       - Eğitim verisi + walk-forward + canlı doğruluk
  POST /admin/walkforward         - Dürüst purged walk-forward (ml v3) başlat
  POST /admin/retrain             - KORUMALI şampiyon-rakip promosyonu dener
  POST /admin/reset-model         - Veri setini yeniden kur + champion'ı yeniden eğit
  POST /admin/analyze-now         - Anlık ml v3 analiz turu tetikle
  GET  /admin/paper-portfolio     - Otonom model portföyü durumu
  POST /admin/paper-universe      - İşlem evrenini ayarla
  POST /admin/paper-reset         - Portföyü 100.000 ₺'ye sıfırla
  POST /admin/rebuild-stats       - Canlı AL precision'ı log'dan yeniden hesapla
"""
import datetime
import json
import threading
import time

import pandas as pd

from infra import (
    ALL_SYMBOLS,
    BIST_MAP,
    COMMODITY_MAP,
    FOREX_MAP,
    send_syslog,
)
import ml_live
import ml.progress as progress
import paper_trading
from ml.config import (
    CHAMPION_FILE,
    FEATURE_NAMES,
    ML_DIR,
    PREDICTION_LOG,
    TRAIN_CACHE,
)

VALIDATION_SUMMARY = ML_DIR / "validation_summary.json"

# Modülün global state'i (main() set eder) — champion model holder.
_ADMIN_MODEL_HOLDER: list = [None]
_TRAINING_STATUS: dict = {"running": False, "task": None, "started_at": None}

# 21 saf teknik özellik için grup eşlemesi (şeffaflık paneli)
_GROUP_MAP = {
    "rsi": "Momentum", "macd": "Momentum",
    "bb_": "Bollinger", "ema": "Trend", "above_": "Trend", "dist_ema": "Trend",
    "ret_": "Getiri", "rel_strength": "Göreli Güç",
    "vol_": "Hacim/Vol", "atr": "Hacim/Vol",
    "price_vs": "52H-Pozisyon", "usdtry": "Bağlam",
}


def _grp(name: str) -> str:
    for k, v in _GROUP_MAP.items():
        if k in name:
            return v
    return "Diğer"


def _load_json(path) -> dict:
    try:
        if path.exists():
            return json.loads(path.read_text())
    except Exception:
        pass
    return {}


def _set_status(running: bool, task: str | None):
    _TRAINING_STATUS["running"] = running
    _TRAINING_STATUS["task"] = task
    _TRAINING_STATUS["started_at"] = datetime.datetime.utcnow().isoformat() if running else None


def _admin_make_app():
    from flask import Flask, jsonify, request
    app = Flask("oracle-admin")

    import logging
    logging.getLogger("werkzeug").setLevel(logging.ERROR)

    # ── GET /admin/status ─────────────────────────────────────────────────────
    # Rejim kapısı durumu — arayüz "AL neden gelmiyor" sorusunu cevaplasın.
    # market_regime() yfinance'ten 2 yıllık XU100 indiriyor; her istekte
    # çağırmak hem yavaş hem kaynağa yük. 15 dakikalık önbellek: kapı zaten
    # günlük kapanışa bakıyor, gün içinde değişmesi anlamlı bir şey söylemez.
    _REJIM_ONBELLEK = {"t": 0.0, "v": None}

    def _rejim():
        if time.time() - _REJIM_ONBELLEK["t"] > 900 or _REJIM_ONBELLEK["v"] is None:
            try:
                _REJIM_ONBELLEK["v"] = ml_live.market_regime()
            except Exception as e:
                _REJIM_ONBELLEK["v"] = {"regime": "UNKNOWN", "detail": str(e)}
            _REJIM_ONBELLEK["t"] = time.time()
        return _REJIM_ONBELLEK["v"]

    @app.get("/admin/status")
    def admin_status():
        model = _ADMIN_MODEL_HOLDER[0]
        meta  = ml_live.champion_meta()
        model_age = None
        if CHAMPION_FILE.exists():
            model_age = int((time.time() - CHAMPION_FILE.stat().st_mtime) // 3600)
        wf = _load_json(VALIDATION_SUMMARY)
        return jsonify({
            "model_loaded":     model is not None,
            "n_features":       len(FEATURE_NAMES),
            "n_symbols":        len(ml_live.load_universe()),
            "bist_count":       len(BIST_MAP),
            "model_age_hours":  model_age,
            "training":         _TRAINING_STATUS.copy(),
            # Walk-forward (ml v3): yön doğruluğu + AL precision
            "wf_accuracy":      wf.get("overall_accuracy"),
            "wf_buy_accuracy":  wf.get("buy_precision"),
            "wf_sell_accuracy": None,   # long-only — SELL yok
            "wf_n_predictions": wf.get("n_oos"),
            "wf_completed_at":  wf.get("computed_at"),
            "champion":         meta,
            "regime":           _rejim(),
        })

    # ── GET /admin/drift ──────────────────────────────────────────────────────
    @app.get("/admin/drift")
    def admin_drift():
        """
        Faz 4: gerçek PSI drift raporu + kalibrasyon takibi. Rapor dosyaları
        günlük 19:20 kontrolünde üretilir; ?refresh=1 ile anında yeniden hesap.
        Drift retrain TETİKLEMEZ — öğrenme korumalı promosyonla (Pazar 20:00).
        """
        from ml.config import CALIB_REPORT_FILE, DRIFT_REPORT_FILE
        import ml.monitoring as monitoring
        if request.args.get("refresh") == "1":
            drift, calib = monitoring.compute_drift(), monitoring.calibration_report()
        else:
            drift = _load_json(DRIFT_REPORT_FILE) or {"status": "NO_DATA", "message": "henüz hesaplanmadı (günlük 19:20 veya ?refresh=1)"}
            calib = _load_json(CALIB_REPORT_FILE) or {"status": "NO_DATA"}

        # İlk dürüst kalibrasyon okumasının TAHMİNİ tarihi — rapor her okunuşta
        # yeniden hesaplanır ki "bugün" ve toplanan günler güncel olsun.
        # Kural projenin kendisinden: olgunlaşma = EVAL_MIN_AGE_DAYS takvim günü
        # (ml_live.maturity ile AYNI), gereken gün = raporun min_days'i.
        try:
            calib = dict(calib)
            fitted = (calib.get("calibrator_fitted_at") or "")[:19]
            if calib.get("status") in ("COLLECTING", "NO_DATA") and fitted:
                import csv, datetime
                import bar_durumu
                from ml.config import EVAL_MIN_AGE_DAYS, PREDICTION_LOG
                from paper_trading import BIST_HOLIDAYS
                gunler, bugun = set(), datetime.date.today().isoformat()
                if PREDICTION_LOG.exists():
                    with open(PREDICTION_LOG, "r", encoding="utf-8") as f:
                        for r in csv.DictReader(f):
                            ts = r.get("timestamp") or ""
                            if ts[:19] >= fitted and (r.get("p_cal") or "").strip():
                                gunler.add(ts[:10])
                calib["ilk_okuma_tahmini"] = bar_durumu.ilk_okuma_tarihi(
                    gunler, datetime.date.today(), bugun in gunler,
                    int(calib.get("min_days") or 10), EVAL_MIN_AGE_DAYS, BIST_HOLIDAYS)
                calib["ilk_okuma_toplanan_gun"] = len(gunler)
        except Exception as e:
            print(f"[admin] ilk okuma tarihi hesaplanamadı: {e}")

        return jsonify({
            "status": drift.get("status"),
            "message": drift.get("message"),
            "drift": drift,
            "calibration": calib,
            "note": "Drift otomatik retrain tetiklemez; karar korumalı promosyonda (Pazar 20:00).",
            "computed_at": drift.get("computed_at"),
        })

    # ── GET /admin/commentary ─────────────────────────────────────────────────
    @app.get("/admin/commentary")
    def admin_commentary():
        """
        Kural-bazlı piyasa yorumu (commentary.py): rejim + genişlik/hacim +
        haber olayları + AI sinyal özeti → gerekçeli Türkçe değerlendirme.
        15 dk cache; ?refresh=1 anında yeniden üretir (yfinance çağrısı içerir).
        """
        try:
            import commentary
            return jsonify(commentary.build_commentary(force=request.args.get("refresh") == "1"))
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    # ── GET /admin/feature-importance ─────────────────────────────────────────
    @app.get("/admin/feature-importance")
    def admin_feature_importance():
        model = _ADMIN_MODEL_HOLDER[0]
        if model is None:
            return jsonify({"error": "Champion yüklenmedi"}), 503
        try:
            pairs = ml_live.feature_importance(model)   # [(name, pct)] azalan
            features = [
                {"name": n, "importance": round(p, 2), "pct": round(p, 2), "group": _grp(n)}
                for n, p in pairs
            ]
            groups: dict[str, float] = {}
            for f in features:
                groups[f["group"]] = round(groups.get(f["group"], 0) + f["pct"], 2)
            return jsonify({"features": features, "groups": groups})
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    # ── GET /admin/symbols ────────────────────────────────────────────────────
    @app.get("/admin/symbols")
    def admin_symbols():
        return jsonify({
            "bist":      [{"ticker": k, "yf": v} for k, v in BIST_MAP.items()],
            "commodity": [{"ticker": k, "yf": v} for k, v in COMMODITY_MAP.items()],
            "forex":     [{"ticker": k, "yf": v} for k, v in FOREX_MAP.items()],
            "total":     len(ALL_SYMBOLS),
        })

    # ── POST /admin/walkforward ───────────────────────────────────────────────
    @app.post("/admin/walkforward")
    def admin_walkforward():
        if _TRAINING_STATUS["running"]:
            return jsonify({"error": "Başka bir işlem zaten çalışıyor"}), 409

        def _run():
            _set_status(True, "walk-forward")
            try:
                from ml.validation import purged_walk_forward
                # Canlı sistemle AYNI dönüşüm (XSEC_RANK) — prepare_training uygular
                data = ml_live.prepare_training(ml_live._load_training_data(rebuild=False))
                result = purged_walk_forward(data, verbose=True)
                VALIDATION_SUMMARY.write_text(json.dumps(result, ensure_ascii=False, indent=2))
                send_syslog(
                    f"[ml v3] Walk-forward bitti — yön doğruluğu "
                    f"{(result.get('overall_accuracy') or 0):.1%}, AL precision "
                    f"{(result.get('buy_precision') or 0):.1%}", "SUCCESS")
            except Exception as e:
                print(f"[AdminWF] Hata: {e}")
                progress.fail_running("dogrulama", str(e))
            finally:
                _set_status(False, None)

        threading.Thread(target=_run, daemon=True).start()
        return jsonify({"ok": True, "message": "Dürüst walk-forward başlatıldı (ml v3, ~2-5dk)"})

    # ── POST /admin/retrain → KORUMALI promosyon ──────────────────────────────
    @app.post("/admin/retrain")
    def admin_retrain():
        if _TRAINING_STATUS["running"]:
            return jsonify({"error": "Başka bir işlem zaten çalışıyor"}), 409

        def _run():
            _set_status(True, "korumalı-promosyon")
            try:
                res = ml_live.promote_if_better()
                if res.get("decision") == "promoted":
                    new_champ = ml_live.load_champion()
                    if new_champ is not None:
                        _ADMIN_MODEL_HOLDER[0] = new_champ
            except Exception as e:
                print(f"[AdminRetrain] Hata: {e}")
                progress.fail_running("terfi", str(e))
            finally:
                _set_status(False, None)

        threading.Thread(target=_run, daemon=True).start()
        return jsonify({"ok": True, "message": "Korumalı şampiyon-rakip değerlendirmesi başlatıldı"})

    # ── GET /admin/data-depth ─────────────────────────────────────────────────
    @app.get("/admin/data-depth")
    def admin_data_depth():
        """
        Alternatif verinin GERÇEK derinliği (Faz B).

        08/2026 ölçümü: haber ~37 gün, temel 17 gün. Bu derinlikte geriye dönük
        doğrulama YAPILAMAZ — bu yüzden haber/temel özellikler modele hâlâ
        girmiyor ve meta-labeling kapalı (Faz G).

        Kayıt SAYISI yanıltıcıdır: 10.448 haber kaydı vardı ama 73 güne
        yayılmıştı ve çoğu son bir aydaydı. Ölçüt GÜN sayısı.
        """
        import csv as _csv
        from ml.config import FEATURE_LOG_FILE, META_LOG_FILE, PREDICTION_LOG
        TARGET_DAYS = 180   # anlamlı bir walk-forward için asgari

        out = {"target_days": TARGET_DAYS, "sources": []}

        def _days(path, *cols) -> tuple[int, int]:
            """
            Dosyadaki benzersiz gün sayısı ve satır sayısı.

            Tarih kolonu adı dosyadan dosyaya değişiyor (feature_log 'date',
            meta_log ve predictions 'timestamp'). İlk yazımda tek ad varsayıp
            meta_log için "894 kayıt ama 0 gün" gibi tutarsız bir sonuç
            ürettim; artık verilen adlar sırayla denenir.
            """
            if not path.exists():
                return 0, 0
            try:
                with open(path, "r", encoding="utf-8") as f:
                    rows = list(_csv.DictReader(f))
            except Exception:
                return 0, 0
            if not rows:
                return 0, 0
            col = next((c for c in cols if c in rows[0]), None)
            if col is None:
                return 0, len(rows)
            return len({(r.get(col) or "")[:10] for r in rows if r.get(col)}), len(rows)

        def add(name, days, rows, note):
            out["sources"].append({
                "name": name, "days": days, "rows": rows,
                "target": TARGET_DAYS, "ready": days >= TARGET_DAYS,
                "pct": round(min(1.0, days / TARGET_DAYS), 3), "note": note,
            })

        # Yalnız ORACLE'IN KENDİ yazdığı dosyalar ölçülüyor. Veritabanındaki ham
        # haber/temel kayıt sayısı YANILTICI: 08/2026'da 10.448 haber kaydı vardı
        # ama 73 güne yayılmıştı ve çoğu son bir aydaydı. Asıl soru "kaç gün
        # boyunca NOKTASAL-ZAMANLI özellik ürettik" — cevabı bu loglarda.
        d, n = _days(META_LOG_FILE, "timestamp", "date")
        add("Haber özellikleri", d, n,
            "meta katmanın eğitim verisi — 180 güne ulaşınca META_ENABLED açılabilir")
        d, n = _days(FEATURE_LOG_FILE, "date", "ts")
        add("Teknik özellikler", d, n, "PSI drift tabanı")
        d, n = _days(PREDICTION_LOG, "timestamp")
        add("Tahmin kaydı", d, n, "canlı isabet ve kapsam ölçümünün tabanı")

        return jsonify(out)

    # ── GET /admin/model-evidence ─────────────────────────────────────────────
    @app.get("/admin/model-evidence")
    def admin_model_evidence():
        """
        Modelin ÖLÇÜLMÜŞ tahmin gücü — docs/MODEL_KANIT.md'nin makine hâli.

        Neden var: arayüz 50 hissenin 49'una "GÜÇLÜ ALIM · %53 güven" yazıyordu.
        Ölçüm bu iddiayı desteklemiyor (gün-içi Spearman t = -0.78, 485 OOS günü).
        Bu uç nokta, gösterilen her sinyalin yanında "bunun kanıtı ne?" sorusunun
        cevabını verir. Kanıt yoksa arayüz sinyali kenar gibi sunmamalıdır.

        Deneyler çevrimdışıdır ve dosya yoksa uç nokta sessizce "ölçülmedi" der.
        """
        from ml.config import ML_DIR

        def _read(name):
            f = ML_DIR / name
            if not f.exists():
                return None
            try:
                return json.loads(f.read_text(encoding="utf-8"))
            except Exception:
                return None

        rank = _read("experiment_ranking.json")
        lowvol = _read("experiment_lowvol.json")

        out = {"measured": False}

        if rank:
            sel = (rank.get("selectivity_within_day") or {}).get("spearman_by_day") or {}
            t = sel.get("t")
            out.update({
                "measured": True,
                "n_oos": rank.get("n_oos"),
                "n_days": rank.get("n_days"),
                "date_range": rank.get("date_range"),
                "ranking": {
                    "spearman": sel.get("mean"),
                    "t": t,
                    # Kanıt eşiği t=2. Altındaysa sıralama "gösterilebilir ama
                    # güvenilmez" olarak işaretlenir — arayüz buna göre yazar.
                    "proven": bool(t is not None and abs(t) >= 2.0),
                },
                "strategies": rank.get("strategies"),
            })

        if lowvol and lowvol.get("results"):
            res = {r["strategy"]: r for r in lowvol["results"] if "sharpe" in r}
            base = next((v for k, v in res.items() if k.startswith("eşit")), None)
            best = next((v for k, v in res.items() if "en düşük oynaklık %20" in k), None)
            if base and best:
                n = base.get("n_periods") or 0
                se = (2 / n) ** 0.5 if n else None
                out["risk_filter"] = {
                    "baseline_sharpe": base.get("sharpe"),
                    "lowvol_sharpe": best.get("sharpe"),
                    "n_periods": n,
                    "sharpe_se": round(se, 2) if se else None,
                    "proven": bool(se and best.get("sharpe") and base.get("sharpe")
                                   and (best["sharpe"] - base["sharpe"]) >= 2 * se),
                }

        return jsonify(out)

    # ── GET /admin/model-versions ─────────────────────────────────────────────
    @app.get("/admin/model-versions")
    def admin_model_versions():
        """
        Arşivlenmiş şampiyon sürümleri (D1). Her terfi/yeniden eğitim öncesi
        eskisi arşivlenir; buradan hangi modele dönülebileceği görülür.
        """
        import ml.registry as registry
        versions = registry.list_versions(limit=20)
        current_hash = None
        try:
            if registry.CHAMPION_FILE.exists():
                current_hash = registry._file_hash(registry.CHAMPION_FILE)
        except Exception:
            pass
        return jsonify({
            "versions": versions,
            "current_hash": current_hash,
            "keep": registry.KEEP_VERSIONS,
        })

    # ── POST /admin/model-rollback ────────────────────────────────────────────
    @app.post("/admin/model-rollback")
    def admin_model_rollback():
        """
        Arşivdeki bir sürümü canlıya alır.

        Geri dönülemez bir işlem DEĞİLDİR: mevcut şampiyon önce arşivlenir.
        Yine de canlı modeli değiştirdiği için `confirm=true` şarttır —
        yanlışlıkla atılan bir istekle model değişmesin.
        """
        if _TRAINING_STATUS["running"]:
            return jsonify({"error": "İşlem devam ediyor — bekleyin"}), 409

        body = request.get_json(silent=True) or {}
        version_id = (body.get("version_id") or request.args.get("version_id") or "").strip()
        confirm    = body.get("confirm") is True or request.args.get("confirm") == "true"

        if not version_id:
            return jsonify({"error": "version_id gerekli"}), 400
        if not confirm:
            return jsonify({"error": "Onay gerekli — confirm=true gönderin"}), 400

        import ml.registry as registry
        res = registry.rollback(version_id)
        if not res.get("ok"):
            return jsonify({"error": res.get("error", "geri alınamadı")}), 400

        _ADMIN_MODEL_HOLDER[0] = res["model"]
        send_syslog(f"[Admin] ⏪ Model geri alındı → {version_id} (eski şampiyon arşivlendi).", "WARN")
        return jsonify({"ok": True, "restored": version_id,
                        "message": f"{version_id} sürümü canlıya alındı"})

    # ── POST /admin/reset-model ───────────────────────────────────────────────
    @app.post("/admin/reset-model")
    def admin_reset_model():
        if _TRAINING_STATUS["running"]:
            return jsonify({"error": "İşlem devam ediyor — bekleyin"}), 409

        def _run():
            _set_status(True, "veri-yeniden-kur + champion-eğit")
            try:
                send_syslog("[Admin] ml v3 veri seti yeniden kuruluyor + champion eğitiliyor...", "WARN")
                m = ml_live.train_champion(rebuild_data=True)
                if m is not None:
                    _ADMIN_MODEL_HOLDER[0] = m
            except Exception as e:
                print(f"[AdminReset] Hata: {e}")
                progress.fail_running("veri-egitim", str(e))
            finally:
                _set_status(False, None)

        threading.Thread(target=_run, daemon=True).start()
        return jsonify({"ok": True, "message": "Veri yeniden kuruluyor + champion eğitiliyor (~4-6dk)"})

    # ── GET /admin/job-progress ───────────────────────────────────────────────
    @app.get("/admin/job-progress")
    def admin_job_progress():
        """
        Koşan işin CANLI ilerlemesi + son biten işin karnesi (ml/progress.py).

        Neden var (17.08.2026 kullanıcı isteği): eylem düğmeleri işi arka plan
        thread'ine atıp anında dönüyordu; kullanıcı işin bitip bitmediğini,
        başarılı olup olmadığını, ne kadar kaldığını GÖREMİYORDU. done/total
        GERÇEK iş birimidir (sembol/adım/pencere) — zamana göre dolan sahte
        çubuk değil. total=None ise birim sayılamıyor demektir; arayüz yüzde
        uydurmak yerine aşama metni gösterir.
        """
        return jsonify(progress.snapshot())

    # ── POST /admin/analyze-now ───────────────────────────────────────────────
    @app.post("/admin/analyze-now")
    def admin_analyze_now():
        if _ADMIN_MODEL_HOLDER[0] is None:
            return jsonify({"error": "Champion hazır değil"}), 503

        def _run():
            try:
                ml_live.run_ml_cycle(_ADMIN_MODEL_HOLDER)
            except Exception as e:
                print(f"[AdminAnalyze] Hata: {e}")

        threading.Thread(target=_run, daemon=True).start()
        return jsonify({"ok": True, "message": "Anlık ml v3 analiz döngüsü başlatıldı"})

    # ── GET /admin/prediction-log ─────────────────────────────────────────────
    @app.get("/admin/prediction-log")
    def admin_prediction_log():
        """10g tahmin geçmişi. Long-only: predicted ∈ {BUY, NEUTRAL}, actual UP→BUY/DOWN→SELL."""
        import csv as csv_mod
        if not PREDICTION_LOG.exists():
            return jsonify({"rows": [], "summary": {}})
        symbol_filter = (request.args.get("symbol") or "").upper().strip()
        try:
            limit = max(50, min(2000, int(request.args.get("limit", 200))))
        except Exception:
            limit = 200

        _ACT = {"UP": "BUY", "DOWN": "SELL", "NEUTRAL": "NEUTRAL"}
        try:
            rows = []
            with open(PREDICTION_LOG, "r", encoding="utf-8") as f:
                for r in csv_mod.DictReader(f):
                    if symbol_filter and r.get("symbol", "").upper() != symbol_filter:
                        continue
                    ev = r.get("eval", "")
                    parts = ev.split("|") if ev else []
                    actual = _ACT.get(parts[0].strip(), "") if parts else ""
                    ret_str = parts[1] if len(parts) > 1 else ""
                    predicted = (r.get("rec_dir") or "").strip()
                    evaluated = bool(ev)
                    directional = predicted == "BUY" and actual in ("BUY", "SELL")
                    correct = (predicted == actual) if (evaluated and directional) else None
                    # "10 gün sonra ne oldu?" — giriş, bariyerler ve çıkış fiyatı
                    entry = round(float(r.get("close", 0) or 0), 2)
                    try:
                        ret_f = float(ret_str) if ret_str else None
                    except Exception:
                        ret_f = None
                    exit_px = round(entry * (1 + ret_f), 2) if (ret_f is not None and entry) else None
                    rows.append({
                        "timestamp":  r.get("timestamp", "")[:10],
                        "symbol":     r.get("symbol", ""),
                        "predicted":  predicted,
                        "confidence": round(float(r.get("p_up", 0) or 0), 3),
                        "close":      entry,
                        "evaluated":  evaluated,
                        "actual":     actual,
                        "return":     ret_str,
                        "correct":    correct,
                        # Faz UI (07/2026): sonuç tablosu için
                        "target":     round(float(r.get("target", 0) or 0), 2) or None,
                        "stop":       round(float(r.get("stop", 0) or 0), 2) or None,
                        "exit_price": exit_px,          # 10 işlem günü sonundaki fiyat
                        "outcome":    (parts[0].strip() if parts else ""),   # UP / DOWN / NEUTRAL
                    })

            evaluated_rows = [r for r in rows if r["evaluated"]]
            directional    = [r for r in rows if r["correct"] is not None]
            correct_rows   = [r for r in directional if r["correct"]]
            buy_rows       = [r for r in directional if r["predicted"] == "BUY"]
            buy_correct    = [r for r in buy_rows if r["correct"]]
            neutral_outcomes = sum(
                1 for r in evaluated_rows
                if r["predicted"] == "BUY" and r["actual"] == "NEUTRAL"
            )
            sym_stats: dict[str, dict] = {}
            for r in directional:
                s = sym_stats.setdefault(r["symbol"], {"correct": 0, "total": 0})
                s["total"] += 1
                if r["correct"]:
                    s["correct"] += 1
            sym_acc = sorted(
                [{"symbol": k, "accuracy": round(v["correct"]/v["total"], 3), "n": v["total"]}
                 for k, v in sym_stats.items() if v["total"] >= 3],
                key=lambda x: -x["accuracy"])

            # ── AL dediği hisseler, demediklerinden iyi mi gitti? (25.09.2026)
            # Ekran "AL isabeti %54 · başabaş %40" diyordu. İki kusuru vardı:
            # isabet yalnız hedefe YA DA stopa değenlerden hesaplanıyor
            # (hiçbirine değmeyen ~%24 dışarıda), başabaş ise 3:2 kazanç/kayıp
            # oranını varsayıyor — oysa işlemlerin çoğu süre dolunca kapanıyor.
            # Kullanıcının asıl sorusu şu: AL çağrısına uysam, uymadığım
            # hisselerden daha iyi mi ederdim? Cevap bu iki grubun gerçekleşen
            # getirisi. İkisi de AYNI üçlü bariyerle ölçülüyor, yani kıyaslanabilir.
            def _getiriler(yon):
                out = []
                for r in evaluated_rows:
                    if r["predicted"] != yon:
                        continue
                    try:
                        out.append(float(r["return"]))
                    except (TypeError, ValueError):
                        pass
                return out

            def _ozet(xs):
                if not xs:
                    return {"n": 0, "ort": None, "medyan": None, "pozitif": None}
                xs = sorted(xs)
                m = len(xs) // 2
                med = xs[m] if len(xs) % 2 else (xs[m - 1] + xs[m]) / 2
                return {"n": len(xs),
                        "ort": round(sum(xs) / len(xs), 5),
                        "medyan": round(med, 5),
                        "pozitif": round(sum(1 for x in xs if x > 0) / len(xs), 4)}

            getiri = {"al": _ozet(_getiriler("BUY")),
                      "diger": _ozet(_getiriler("NEUTRAL"))}

            summary = {
                "getiri":           getiri,
                "total":            len(rows),
                "evaluated":        len(evaluated_rows),
                "pending":          len(rows) - len(evaluated_rows),
                "directional":      len(directional),
                "neutral_outcomes": neutral_outcomes,
                "correct":          len(correct_rows),
                "accuracy":         round(len(correct_rows)/len(directional), 4) if directional else None,
                "buy_accuracy":     round(len(buy_correct)/len(buy_rows), 4) if buy_rows else None,
                "sell_accuracy":    None,
                "buy_n":            len(buy_rows),
                "sell_n":           0,
                "top_symbols":      sym_acc[:8],
                "worst_symbols":    sym_acc[-5:] if len(sym_acc) >= 5 else [],
            }
            return jsonify({"rows": list(reversed(rows))[:limit], "summary": summary})
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    # ── GET /admin/selftest ───────────────────────────────────────────────────
    @app.get("/admin/selftest")
    def admin_selftest():
        """
        Öz denetim — sistemdeki DEĞİŞMEZLER (docs/SAGLAMLIK_PLANI.md Katman 1).
        Önbellekten okur; ?run=1 ile yeniden çalıştırır (~1-2 sn).
        """
        from ml.config import SELFTEST_FILE
        if request.args.get("run") == "1":
            import selftest
            return jsonify(selftest.run())
        cached = _load_json(SELFTEST_FILE)
        if not cached:
            import selftest
            return jsonify(selftest.run())
        return jsonify(cached)

    # ── GET /admin/config ─────────────────────────────────────────────────────
    @app.get("/admin/config")
    def admin_config():
        """
        Arayüzün ihtiyaç duyduğu eşiklerin TEK KAYNAĞI.
        Arayüzde elle yazılmış sayı YASAK (08/2026: "77/30" ve "600/200"
        hataları, backend eşiği değişince güncellenmeyen sabitlerden doğdu).
        """
        from ml.config import (
            BUY_THRESHOLD, EVAL_MIN_AGE_DAYS, HORIZON, JOB_OVERDUE_HOURS,
            KELLY_FRACTION, META_MIN_AUC, META_VETO_P, MIN_META_SAMPLES,
            PROMOTE_MIN_EDGE, PROMOTE_MIN_FRESH_DAYS, PROMOTE_MIN_PRECISION,
            PROMOTE_MIN_SAMPLES, PROMOTE_WINDOWS, PSI_ALERT, PSI_WATCH,
            COVERAGE_TARGET, RISK_FILTER_DECISION_DATE, RISK_FILTER_MIN_SYMBOLS,
            RISK_FILTER_ON, RISK_FILTER_TOP_PCT,
            SL_ATR_MULT, STRONG_BUY_P, TP_ATR_MULT, TRANSACTION_COST_PCT,
        )
        from config import CYCLE_MIN
        import ml.monitoring as monitoring
        return jsonify({
            "model": {
                "horizon_days": HORIZON, "buy_threshold": BUY_THRESHOLD,
                "strong_buy_p": STRONG_BUY_P,
                "tp_atr_mult": TP_ATR_MULT, "sl_atr_mult": SL_ATR_MULT,
                "transaction_cost_pct": TRANSACTION_COST_PCT,
                "kelly_fraction": KELLY_FRACTION,
            },
            "evaluation": {"min_age_days": EVAL_MIN_AGE_DAYS},
            # Faz A — kural docs/PLAN_2026-08.md §A0'da önceden çivilendi.
            "risk_filter": {
                "on": RISK_FILTER_ON,
                "top_pct": RISK_FILTER_TOP_PCT,
                "min_symbols": RISK_FILTER_MIN_SYMBOLS,
                "coverage_target": list(COVERAGE_TARGET),
                "criteria": ["düşük oynaklık (atr_pct)", "52h zirveye yakınlık"],
                "decision_date": RISK_FILTER_DECISION_DATE,
                "proven": False,   # Sharpe farkı 1 standart hatanın içinde
            },
            "drift":      {"min_rows": monitoring.MIN_LIVE_ROWS,
                           "min_days": monitoring.MIN_LIVE_DAYS,
                           "psi_watch": PSI_WATCH, "psi_alert": PSI_ALERT},
            "calibration": {"min_required": monitoring.MIN_EVAL_ROWS,
                            "min_days": monitoring.MIN_EVAL_DAYS},
            "meta":       {"min_samples": MIN_META_SAMPLES,
                           "min_auc": META_MIN_AUC, "veto_p": META_VETO_P},
            "promotion":  {"min_edge": PROMOTE_MIN_EDGE,
                           "min_samples": PROMOTE_MIN_SAMPLES,
                           "min_precision": PROMOTE_MIN_PRECISION,
                           "min_fresh_days": PROMOTE_MIN_FRESH_DAYS,
                           "windows": PROMOTE_WINDOWS},
            "jobs":       {"overdue_hours": JOB_OVERDUE_HOURS},
            # Arayüzdeki "Pazar 20:00", "her 30 dk" gibi ifadeler buradan gelsin —
            # main.py'deki schedule değişince metin yalan söylemesin.
            "schedule":   {"cycle_min": CYCLE_MIN, "close_scan": "18:10",
                           "evaluate": "19:00", "health": "19:20",
                           "selftest": "19:25", "promote": "Pazar 20:00"},
        })

    # ── GET /admin/jobs ───────────────────────────────────────────────────────
    @app.get("/admin/jobs")
    def admin_jobs():
        """
        Zamanlanmış işlerin durumu — "bugünkü değerlendirme yapıldı mı, Pazar
        eğitimi çalıştı mı?" sorusunun tek bakışta cevabı.

        Her iş için son çalışma zamanı, gecikme durumu ve bilgisayar kapalıyken
        kaçarsa telafi edilip edilmediği. `schedule` kaçan işi telafi etmediği
        için (08/2026 bulgusu) telafi açıkça belirtilir.
        """
        import csv as csv_mod
        import datetime as dt
        from ml.config import (CALIBRATOR_META_FILE, DRIFT_REPORT_FILE,
                               JOB_OVERDUE_HOURS, PROMOTION_LOG)

        now = dt.datetime.utcnow()

        def _age_h(iso: str | None) -> float | None:
            if not iso:
                return None
            try:
                s = iso.replace("Z", "").strip()
                return max(0.0, (now - dt.datetime.fromisoformat(s)).total_seconds() / 3600.0)
            except Exception:
                return None

        # ── Son çalışma zamanlarını kaynaklarından oku ────────────────────────
        last_analyze = None
        try:
            if PREDICTION_LOG.exists():
                with open(PREDICTION_LOG, "r", encoding="utf-8") as f:
                    for r in csv_mod.DictReader(f):
                        ts = r.get("timestamp")
                        if ts and (last_analyze is None or ts > last_analyze):
                            last_analyze = ts
        except Exception:
            pass

        stats = _load_json(ml_live.ML_STATS_FILE) or {}
        drift = _load_json(DRIFT_REPORT_FILE) or {}
        wf    = _load_json(VALIDATION_SUMMARY) or {}
        cal   = _load_json(CALIBRATOR_META_FILE) or {}

        last_promote = None
        try:
            if PROMOTION_LOG.exists():
                for line in PROMOTION_LOG.read_text(encoding="utf-8").splitlines():
                    line = line.strip()
                    if line:
                        try:
                            v = json.loads(line).get("checked_at")
                            if v:
                                last_promote = v
                        except Exception:
                            pass
        except Exception:
            pass

        # (id, ad, zamanlama, son çalışma, gecikme eşiği [saat], telafi, açıklama)
        specs = [
            # Gecikme eşikleri ml/config.JOB_OVERDUE_HOURS'tan — selftest I10 ile
            # AYNI kaynak. Elle yazılan eşik = 08/2026 "77/30" hatasının sınıfı.
            ("analyze",  "Piyasa taraması", "her 30 dakika",
             last_analyze, JOB_OVERDUE_HOURS["analyze"], True,
             "Tüm sembolleri tarar, tahmin üretir"),
            ("evaluate", "Günlük değerlendirme", "her gün 19:00",
             stats.get("last_eval"), JOB_OVERDUE_HOURS["evaluate"], True,
             "Olgunlaşan tahminlerin sonucunu hesaplar (10 işlem günü sonra)"),
            ("health",   "Sağlık kontrolü", "her gün 19:20",
             drift.get("computed_at"), JOB_OVERDUE_HOURS["health"], True,
             "Veri kayması (PSI) + kalibrasyon sapması ölçümü"),
            ("promote",  "Haftalık eğitim (terfi)", "her Pazar 20:00",
             last_promote, JOB_OVERDUE_HOURS["promote"], True,
             "Rakip model eğitilir; şampiyonu geçerse yerine geçer"),
            ("validate", "Doğrulama + kalibrasyon", "elle",
             wf.get("computed_at") or cal.get("fitted_at"), None, False,
             "Walk-forward sınavı ve kalibratör tazeleme (Doğrulama çalıştır)"),
        ]

        jobs = []
        for jid, name, sched, last, overdue_h, catchup, desc in specs:
            age = _age_h(last)
            if age is None:
                status = "never"
            elif overdue_h is None:
                status = "manual"
            elif age > overdue_h:
                status = "overdue"
            else:
                status = "ok"
            jobs.append({
                "id": jid, "name": name, "schedule": sched, "description": desc,
                "last_run": last, "age_hours": round(age, 2) if age is not None else None,
                "overdue_after_hours": overdue_h, "status": status, "catchup": catchup,
            })

        return jsonify({
            "now": now.isoformat(),
            "jobs": jobs,
            "note": ("Bilgisayar kapalıyken kaçan işler, program açıldığında "
                     "otomatik telafi edilir (piyasa taraması, değerlendirme, "
                     "sağlık kontrolü ve haftalık eğitim)."),
        })

    # ── GET /admin/model-story ────────────────────────────────────────────────
    @app.get("/admin/model-story")
    def admin_model_story():
        """
        Modelin "hayat hikâyesi" — UI'daki görsel anlatım için tek çağrı:
          • künye        : ne tür model, neyle eğitildi, hangi bariyerler
          • sınav        : walk-forward fold'ları (tutarlılık grafiği)
          • kalibrasyon  : güvenilirlik eğrisi (ham p → gerçekte ne çıktı)
          • terfi geçmişi: şampiyon-rakip denemeleri ve kararları
        """
        import json as _json
        from ml.config import (CALIBRATOR_META_FILE, LGBM_PARAMS, PROMOTION_LOG,
                               META_FILE, MIN_TRAIN_ROWS, HISTORY_PERIOD)
        out = {}
        try:
            meta = _load_json(META_FILE) or {}
            wf   = _load_json(VALIDATION_SUMMARY) or {}
            cal  = _load_json(CALIBRATOR_META_FILE) or {}

            out["identity"] = {
                "algorithm":    "LightGBM (gradient boosting)",
                "n_trees":      LGBM_PARAMS.get("n_estimators"),
                "max_depth":    LGBM_PARAMS.get("max_depth"),
                "learning_rate": LGBM_PARAMS.get("learning_rate"),
                "n_features":   len(FEATURE_NAMES),
                "feature_kind": "saf teknik (haber/temel/makro YOK)",
                "trained_at":   meta.get("trained_at"),
                "n_rows":       meta.get("n_rows"),
                "date_min":     meta.get("date_min"),
                "date_max":     meta.get("date_max"),
                "up_pct":       meta.get("up_pct"),
                "horizon":      meta.get("horizon"),
                "tp_atr_mult":  meta.get("tp_atr_mult"),
                "sl_atr_mult":  meta.get("sl_atr_mult"),
                "buy_threshold": meta.get("buy_threshold"),
                "xsec_rank":    meta.get("xsec_rank"),
                "history_period": HISTORY_PERIOD,
                "min_train_rows": MIN_TRAIN_ROWS,
            }
            out["exam"] = {
                "completed_at": wf.get("computed_at"),
                "n_folds":      wf.get("n_folds"),
                "n_oos":        wf.get("n_oos"),
                "auc":          wf.get("auc"),
                "buy_precision": wf.get("buy_precision"),
                "base_rate":    wf.get("base_rate"),
                "lift":         wf.get("lift"),
                "mean_fold_lift": wf.get("mean_fold_lift"),
                "breakeven_precision": wf.get("breakeven_precision"),
                "expected_R_per_trade": wf.get("expected_R_per_trade"),
                "profitable":   wf.get("profitable"),
                "folds":        wf.get("steps") or [],
            }
            out["calibration"] = {
                "fitted_at":   cal.get("fitted_at"),
                "n_oos":       cal.get("n_oos"),
                "method":      cal.get("method"),
                "reliability": cal.get("reliability") or [],
            }
            # Terfi geçmişi — son 10 deneme
            hist = []
            try:
                if PROMOTION_LOG.exists():
                    for line in PROMOTION_LOG.read_text(encoding="utf-8").splitlines():
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            r = _json.loads(line)
                        except Exception:
                            continue
                        hist.append({
                            "checked_at": r.get("checked_at"),
                            "decision":   r.get("decision"),
                            "reason":     r.get("reason"),
                            "windows_won": r.get("challenger_wins"),
                            "windows_total": r.get("comparable_windows"),
                            "pooled_precision": r.get("pooled_precision") or r.get("challenger_precision"),
                        })
            except Exception:
                pass
            out["promotions"] = hist[-10:]
            return jsonify(out)
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    # ── GET /admin/prediction-calendar ────────────────────────────────────────
    @app.get("/admin/prediction-calendar")
    def admin_prediction_calendar():
        """
        Tahmin yaşam döngüsü — GÜN bazında özet (UI takvimi + olgunlaşma hattı).

        Her tahmin günü bir "kohort": o gün kurulan bahisler EVAL_MIN_AGE_DAYS
        takvim günü sonra topluca yargılanır. Bu endpoint her kohort için
        olgunlaşma yüzdesini, hüküm tarihini ve (olgunsa) isabet dökümünü verir.
        """
        import csv as csv_mod
        import datetime as dt
        from ml.config import EVAL_MIN_AGE_DAYS

        if not PREDICTION_LOG.exists():
            return jsonify({"days": [], "summary": {}, "horizon_days": EVAL_MIN_AGE_DAYS})

        try:
            # UTC — predictions.csv zaman damgaları UTC (08/2026 baz birleştirme)
            today = dt.datetime.utcnow().date()
            days: dict[str, dict] = {}

            with open(PREDICTION_LOG, "r", encoding="utf-8") as f:
                for r in csv_mod.DictReader(f):
                    d = (r.get("timestamp") or "")[:10]
                    if len(d) != 10:
                        continue
                    c = days.setdefault(d, {
                        "date": d, "total": 0, "buy": 0,
                        "evaluated": 0, "up": 0, "down": 0, "neutral": 0,
                        "buy_correct": 0, "buy_decided": 0, "returns": [],
                        "_ts": None,
                    })
                    c["total"] += 1
                    # Kohortun EN GEÇ tahmini — olgunluk onunla ölçülür (muhafazakâr).
                    # evaluate_ml satır bazında tam ZAMAN farkına bakar; takvim de
                    # aynı formülü kullanmalı yoksa UI "olgun" derken motor atlar.
                    full_ts = (r.get("timestamp") or "").strip()
                    if full_ts and (c["_ts"] is None or full_ts > c["_ts"]):
                        c["_ts"] = full_ts
                    is_buy = (r.get("rec_dir") or "").strip() == "BUY"
                    if is_buy:
                        c["buy"] += 1
                    ev = (r.get("eval") or "").strip()
                    if not ev:
                        continue
                    parts = ev.split("|")
                    outcome = parts[0].strip()
                    c["evaluated"] += 1
                    if outcome == "UP":
                        c["up"] += 1
                    elif outcome == "DOWN":
                        c["down"] += 1
                    else:
                        c["neutral"] += 1
                    # AL sinyalinin kesin hükmü (NEUTRAL kararsız sayılır)
                    if is_buy and outcome in ("UP", "DOWN"):
                        c["buy_decided"] += 1
                        if outcome == "UP":
                            c["buy_correct"] += 1
                    if len(parts) > 1:
                        try:
                            c["returns"].append(float(parts[1]))
                        except Exception:
                            pass

            now = dt.datetime.utcnow()
            out = []
            for d in sorted(days):
                c = days[d]
                raw_ts = c.pop("_ts") or f"{d}T00:00:00"
                try:
                    made_dt = dt.datetime.fromisoformat(raw_ts)
                except Exception:
                    made_dt = dt.datetime.fromisoformat(f"{d}T00:00:00")
                # Olgunluk TEK KAYNAKTAN: ml_live.maturity (evaluate_ml de onu kullanır)
                m = ml_live.maturity(made_dt, now)
                rets = c.pop("returns")
                c.update({
                    "verdict_date":  m["verdict_date"].isoformat(),
                    "age_days":      m["age_days"],
                    "days_left":     m["days_left"],
                    "matured":       m["matured"],
                    "progress":      round(min(1.0, m["age_days"] / EVAL_MIN_AGE_DAYS), 3),
                    "pending":       c["total"] - c["evaluated"],
                    "hit_rate":      round(c["buy_correct"] / c["buy_decided"], 4) if c["buy_decided"] else None,
                    "avg_return":    round(sum(rets) / len(rets), 4) if rets else None,
                })
                out.append(c)

            total     = sum(c["total"] for c in out)
            evaluated = sum(c["evaluated"] for c in out)
            decided   = sum(c["buy_decided"] for c in out)
            correct   = sum(c["buy_correct"] for c in out)
            # "Fırında" = henüz olgunlaşmamış kohortlardaki tahminler
            ripening  = sum(c["total"] for c in out if not c["matured"])
            # Bir sonraki hasat: olgunlaşmamışların en yakın hüküm tarihi
            upcoming  = sorted((c for c in out if not c["matured"]), key=lambda c: c["verdict_date"])
            return jsonify({
                "horizon_days": EVAL_MIN_AGE_DAYS,
                "today":        today.isoformat(),
                "days":         out,
                "summary": {
                    "total":          total,
                    "evaluated":      evaluated,
                    "pending":        total - evaluated,
                    "ripening":       ripening,
                    "matured_total":  sum(c["total"] for c in out if c["matured"]),
                    "buy_decided":    decided,
                    "buy_correct":    correct,
                    "hit_rate":       round(correct / decided, 4) if decided else None,
                    "next_verdict":   upcoming[0]["verdict_date"] if upcoming else None,
                    "next_verdict_n": upcoming[0]["total"] if upcoming else 0,
                },
            })
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    # ── POST /admin/evaluate-now ──────────────────────────────────────────────
    @app.post("/admin/evaluate-now")
    def admin_evaluate_now():
        """
        Olgunlaşmış tahminleri 19:00 zamanlamasını beklemeden yargılar.
        evaluate_ml kendi yaş kontrolünü yapar — olgunlaşmamışa dokunmaz.
        """
        if _TRAINING_STATUS["running"]:
            return jsonify({"error": "Başka bir işlem zaten çalışıyor"}), 409

        def _run():
            _set_status(True, "değerlendirme")
            try:
                ml_live.evaluate_ml()
            except Exception as e:
                print(f"[AdminEvaluate] Hata: {e}")
                progress.fail_running("degerlendirme", str(e))
            finally:
                _set_status(False, None)

        threading.Thread(target=_run, daemon=True).start()
        return jsonify({"ok": True, "message": "Değerlendirme başlatıldı (olgun tahminler yargılanıyor)"})

    # ── GET /admin/training-info ──────────────────────────────────────────────
    @app.get("/admin/training-info")
    def admin_training_info():
        info: dict = {}
        wf = _load_json(VALIDATION_SUMMARY)
        if wf:
            info["walkforward"] = {
                "completed_at":     wf.get("computed_at"),
                "n_symbols":        len(ml_live.load_universe()),
                "n_steps":          wf.get("n_folds"),
                "n_predictions":    wf.get("n_oos"),
                "overall_accuracy": wf.get("overall_accuracy"),
                "buy_precision":    wf.get("buy_precision"),
                "breakeven_precision": wf.get("breakeven_precision"),
                # Uzman denetimi (06/2026): taban çizgisi + ayrım gücü + maliyet
                "auc":                  wf.get("auc"),
                "base_rate":            wf.get("base_rate"),
                "lift":                 wf.get("lift"),
                "mean_fold_lift":       wf.get("mean_fold_lift"),
                "buy_coverage":         wf.get("buy_coverage"),
                "expected_R_per_trade": wf.get("expected_R_per_trade"),
                "expected_R_baseline":  wf.get("expected_R_baseline"),
                "cost_sensitivity":     wf.get("cost_sensitivity"),
                "profitable":           wf.get("profitable"),
                "step_stats":       wf.get("steps", []),
                "top_symbols":      [],
            }
        if TRAIN_CACHE.exists():
            try:
                df = pd.read_csv(TRAIN_CACHE)
                lc = df["label"].value_counts().to_dict() if "label" in df.columns else {}
                info["training_csv"] = {
                    "total_rows":   len(df),
                    "n_features":   len(FEATURE_NAMES),
                    "label_counts": {str(int(k)): int(v) for k, v in lc.items()},
                    "label_balance": {
                        "up_pct":   round(lc.get(1, 0) / max(len(df), 1) * 100, 1),
                        "down_pct": round(lc.get(0, 0) / max(len(df), 1) * 100, 1),
                    },
                    "file_size_mb": round(TRAIN_CACHE.stat().st_size / 1_048_576, 2),
                    "modified_at":  datetime.datetime.fromtimestamp(TRAIN_CACHE.stat().st_mtime).isoformat()[:16],
                }
            except Exception as e:
                info["training_csv"] = {"error": str(e)}

        info["symbols"] = {
            "bist":      list(BIST_MAP.keys()),
            "commodity": list(COMMODITY_MAP.keys()),
            "forex":     list(FOREX_MAP.keys()),
            "total":     len(ALL_SYMBOLS),
        }
        stats = _load_json(ml_live.ML_STATS_FILE)
        if stats:
            info["live_accuracy"] = {
                "overall":         stats.get("al_precision"),
                "total_evaluated": stats.get("al_evaluated", 0),
                "total_correct":   stats.get("al_correct", 0),
                "last_eval":       (stats.get("last_eval") or "")[:16],
                "breakeven":       stats.get("breakeven_precision"),
                "al_signals":      stats.get("al_signals", 0),
                # Canlı taban çizgisi + lift (07/2026): model mi, piyasa mı?
                "base_rate":       stats.get("base_rate"),
                "lift":            stats.get("lift"),
                "evaluated_all":   stats.get("evaluated_all", 0),
                "champion_since":  (stats.get("champion_since") or "")[:10] or None,
                "champion":        stats.get("champion"),
            }
        info["champion"] = ml_live.champion_meta()
        return jsonify(info)

    # ── GET /admin/paper-portfolio ────────────────────────────────────────────
    @app.get("/admin/paper-portfolio")
    def admin_paper_portfolio():
        """
        ?book=main (varsayılan) veya ?book=shadow.

        shadow = risk filtresi UYGULANMAMIŞ, eşit ağırlıklı karşılaştırma tabanı
        (Faz A1). 2027-02-12'deki karar bu ikisinin karşılaştırmasına dayanacak;
        geçmiş bir Sharpe sayısıyla kıyaslamak rejim değiştiği için yanıltıcı olur.
        """
        book = request.args.get("book", "main")
        if book not in paper_trading.BOOKS:
            return jsonify({"error": f"bilinmeyen defter: {book}"}), 400
        try:
            return jsonify(paper_trading.get_summary(book=book))
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    # ── GET /admin/filter-decision ────────────────────────────────────────────
    @app.get("/admin/filter-decision")
    def admin_filter_decision():
        """
        Risk filtresi kararının ÖLÇÜTLERİ (docs/PLAN_2026-08.md §A0).

        Neden ayrı uç nokta: ölçütler önceden çivilenmişti ama hiçbir kod onları
        hesaplamıyordu (08/2026 denetim bulgusu). Karar günü elle hesaplamak,
        tam o anda "şöyle hesaplayalım" kararının sızmasına kapı açar.

        `worst_month_norm` maruziyete göre normalizedir: ana defter Kelly ile
        ~%44, gölge eşit ağırlıkla ~%75 sermaye kullanıyor; ham "en kötü ay"
        karşılaştırması bu yüzden filtrenin lehine yapısal olarak yanlı olurdu.
        """
        try:
            return jsonify(paper_trading.filter_decision())
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    # ── POST /admin/paper-universe ────────────────────────────────────────────
    @app.post("/admin/paper-universe")
    def admin_paper_universe():
        try:
            data = request.get_json(force=True, silent=True) or {}
            symbols = data.get("symbols", [])
            if not isinstance(symbols, list):
                return jsonify({"error": "symbols bir liste olmalı"}), 400
            valid = [s for s in (str(x).upper().strip() for x in symbols) if s in ALL_SYMBOLS]
            cleaned = paper_trading.set_universe(valid)
            send_syslog(f"[Paper] İşlem evreni güncellendi: {len(cleaned)} hisse", "INFO")
            return jsonify({"ok": True, "symbols": cleaned})
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    # ── POST /admin/rebuild-stats ─────────────────────────────────────────────
    @app.post("/admin/rebuild-stats")
    def admin_rebuild_stats():
        try:
            s = ml_live.rebuild_ml_stats()
            send_syslog(
                f"[Stats] AL precision yeniden hesaplandı: "
                f"{(s.get('al_precision') or 0):.1%} "
                f"({s.get('al_correct')}/{s.get('al_evaluated')})", "INFO")
            return jsonify({"ok": True, "stats": s})
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    # ── POST /admin/paper-reset ───────────────────────────────────────────────
    @app.post("/admin/paper-reset")
    def admin_paper_reset():
        try:
            paper_trading.reset()
            send_syslog("[Paper] Model portföyü sıfırlandı (100.000 ₺).", "WARN")
            return jsonify({"ok": True, "message": "Portföy sıfırlandı"})
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    return app


def _start_admin_server(model_holder: list):
    """Admin Flask server'ı arka plan thread'inde başlatır."""
    global _ADMIN_MODEL_HOLDER
    _ADMIN_MODEL_HOLDER = model_holder
    try:
        app = _admin_make_app()
        app.run(host="0.0.0.0", port=5001, debug=False, use_reloader=False)
    except Exception as e:
        print(f"[AdminServer] Başlatılamadı: {e}")
