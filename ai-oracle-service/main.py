"""
SerInvest Yerel AI Oracle — Entry Point
========================================
Tamamen yerel çalışır, hiçbir harici AI API'si kullanmaz.

Sistem mimarisi (05/2026 modüler bölünme):
  config.py        — Sabitler (FEATURE_NAMES, paths, eşikler)
  infra.py         — RabbitMQ + symbols + core-api client
  features.py      — compute_feature_df, fetch_cross_asset_panel, compute_labels, _direction
  model.py         — LGBM pipeline, calibration, predict_one, SHAP, MetaLearner
  training.py      — bootstrap, walkforward, retrain, backtest_shadow, drift
  decision.py      — late_fusion, regime, news_lag, targets, text_gen
  evaluation.py    — log_prediction, evaluate_predictions, get_model_accuracy
  analysis.py      — run_analysis_cycle (ana döngü)
  admin_server.py  — Flask admin API (port 5001)
  main.py          — Entry point + schedule (BU DOSYA)

Çalışma akışı:
  1. RabbitMQ bağlan + symbols yükle
  2. Model yükle (yoksa walk-forward + bootstrap)
  3. Admin server'ı arka plan thread'inde başlat
  4. İlk analiz turunu hemen çalıştır + catch-up evaluation
  5. Schedule: her CYCLE_MIN dk analiz + 19:00 evaluation
"""
import datetime
import json
import socket
import threading
import time

import schedule

# yfinance HTTP'si askıya alınırsa analiz döngüsü saatlerce bloke olabilir.
socket.setdefaulttimeout(30)

import infra
from config import CYCLE_MIN, MODELS_DIR
from infra import _ensure_channel, send_syslog, wait_for_api
import ml_live
from admin_server import _start_admin_server


def main():
    print("SerInvest Yerel AI Oracle başlatılıyor (API'siz)...")
    MODELS_DIR.mkdir(parents=True, exist_ok=True)

    # Diğer servislerin hazır olmasını bekle
    time.sleep(10)
    wait_for_api()

    # ÖNCE RabbitMQ bağlan
    if not _ensure_channel():
        print("[FATAL] RabbitMQ'ya bağlanılamadı — çıkılıyor.")
        return

    send_syslog("Sistem başlatılıyor... RabbitMQ'ya bağlanıldı.", "INFO")

    # ── ml v3: Champion modeli yükle veya eğit (saf teknik, 10g triple-barrier) ──
    # model_holder[0] — korumalı promosyonla değişebilsin diye liste.
    model_holder = [ml_live.load_or_train_champion()]

    # Admin HTTP server'ı arka planda başlat (frontend butonları buraya bağlanır)
    threading.Thread(target=_start_admin_server, args=(model_holder,), daemon=True).start()
    print("[Admin] HTTP server başlatıldı → port 5001")

    if model_holder[0] is None:
        send_syslog("[UYARI] Champion eğitilemedi. Bir sonraki döngüde tekrar denenecek.", "ERROR")

    # 1. İlk tarama (boot)
    send_syslog("İlk ml v3 analiz turu başlatılıyor (Boot Analysis)...", "INFO")
    ml_live.run_ml_cycle(model_holder)

    # 1b. Bekleyen 10g değerlendirmeleri (catch-up) — evaluate_ml kendisi yaş kontrolü yapar.
    try:
        ml_live.evaluate_ml()
    except Exception as e:
        print(f"[boot eval] {e}")

    # 1c. Faz 4 sağlık kontrolü — BOOT CATCH-UP (07/2026 bulgusu).
    #     schedule 19:20'de tetikler ama bilgisayar o saatte kapalıysa veya konteyner
    #     sonra başlarsa o gün HİÇ çalışmıyordu → drift_report 15 gün bayat kalmıştı.
    #     Boot'ta bir kez çalıştırmak raporları her açılışta tazeler.
    import ml.monitoring as monitoring
    try:
        monitoring.run_daily_checks(send_syslog=send_syslog)
    except Exception as e:
        print(f"[boot monitor] {e}")

    # 2. Periyodik analiz döngüsü — her CYCLE_MIN dakikada bir
    schedule.every(CYCLE_MIN).minutes.do(ml_live.run_ml_cycle, model_holder=model_holder)

    # 3. Günlük kapanış analizi — BIST kapanışına (18:10) ek tarama
    schedule.every().day.at("18:10").do(ml_live.run_ml_cycle, model_holder=model_holder)

    # 4. Günlük değerlendirme — kapanış sonrası 19:00 (10g triple-barrier)
    schedule.every().day.at("19:00").do(ml_live.evaluate_ml)

    # 4b. Faz 4: günlük sağlık kontrolü — drift (PSI) + kalibrasyon takibi.
    #     Değerlendirmeden SONRA (19:20) — taze eval verisiyle çalışsın.
    #     (Boot'ta da bir kez çalışır — yukarıda 1c; kaçan günler bayat kalmasın.)
    schedule.every().day.at("19:20").do(monitoring.run_daily_checks, send_syslog=send_syslog)

    # 5. KORUMALI öğrenme — haftada bir şampiyon-rakip. Körü körüne retrain YOK:
    #    rakip yalnız bağımsız pencerede şampiyonu net geçerse terfi eder.
    schedule.every().sunday.at("20:00").do(ml_live.promote_if_better)

    send_syslog(
        f"Sistem ml v3 moduna geçti (saf teknik, 10g ufuk). "
        f"Analiz: her {CYCLE_MIN} dk | Kapanış: 18:10 | "
        f"Değerlendirme: 19:00 | Korumalı promosyon: Pazar 20:00", "INFO"
    )
    try:
        while True:
            schedule.run_pending()
            time.sleep(60)
    except KeyboardInterrupt:
        print("Durduruluyor...")
    finally:
        try:
            if infra.GLOBAL_CONN is not None:
                infra.GLOBAL_CONN.close()
        except Exception:
            pass


if __name__ == "__main__":
    main()
