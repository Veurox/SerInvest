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
            finally:
                _set_status(False, None)

        threading.Thread(target=_run, daemon=True).start()
        return jsonify({"ok": True, "message": "Korumalı şampiyon-rakip değerlendirmesi başlatıldı"})

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
            finally:
                _set_status(False, None)

        threading.Thread(target=_run, daemon=True).start()
        return jsonify({"ok": True, "message": "Veri yeniden kuruluyor + champion eğitiliyor (~4-6dk)"})

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

            summary = {
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
        from ml.config import CALIBRATOR_META_FILE, DRIFT_REPORT_FILE, PROMOTION_LOG

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
            ("analyze",  "Piyasa taraması", "her 30 dakika",
             last_analyze, 4, True,
             "Tüm sembolleri tarar, tahmin üretir"),
            ("evaluate", "Günlük değerlendirme", "her gün 19:00",
             stats.get("last_eval"), 36, True,
             "Olgunlaşan tahminlerin sonucunu hesaplar (10 işlem günü sonra)"),
            ("health",   "Sağlık kontrolü", "her gün 19:20",
             drift.get("computed_at"), 36, True,
             "Veri kayması (PSI) + kalibrasyon sapması ölçümü"),
            ("promote",  "Haftalık eğitim (terfi)", "her Pazar 20:00",
             last_promote, 8 * 24, True,
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
        try:
            return jsonify(paper_trading.get_summary())
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
