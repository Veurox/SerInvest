"""
SerInvest Oracle — Altyapı Katmanı
==================================

Buradakiler:
  - RabbitMQ bağlantı yönetimi + syslog yayını
  - Symbols JSON yükleyici (BIST/Commodity/Forex haritaları)
  - Core-API HTTP client (api_get, news sentiments, fundamentals)
  - Health-check yardımcıları (wait_for_api)

Bu modül diğer modüllere bağımlı değildir (sadece config + stdlib).
"""
import datetime
import json
import time
from pathlib import Path

import pika
import requests

from config import (
    CORE_API,
    RMQ_HOST,
)
from ml.config import ML_DIR

# ml v3 canlı doğruluk özeti (AL precision) — syslog Accuracy alanı için.
ML_LIVE_STATS = ML_DIR / "live_accuracy.json"

# ── Global RabbitMQ State ────────────────────────────────────────────────────
# Ana thread'in kullandığı channel. Birden fazla thread çağırmamalı.
GLOBAL_CHANNEL = None
GLOBAL_CONN    = None


def connect_rmq() -> pika.BlockingConnection:
    """
    RabbitMQ'ya 15 deneme ile bağlanır. Başarısızsa RuntimeError fırlatır.
    heartbeat=0 → uzun süreli analiz döngülerinde frame timeout yok.
    """
    for attempt in range(15):
        try:
            return pika.BlockingConnection(
                pika.ConnectionParameters(
                    host=RMQ_HOST, heartbeat=0, blocked_connection_timeout=300
                )
            )
        except Exception as e:
            print(f"RabbitMQ bekleniyor ({attempt+1}/15): {e}")
            time.sleep(5)
    raise RuntimeError("RabbitMQ'ya bağlanılamadı")


def _ensure_channel() -> bool:
    """
    Channel kapalıysa veya bağlantı kopmuşsa yeniden bağlanır.
    Thread'den çağrılmamalı — sadece ana thread kullanır.
    Döndürür: True = channel kullanılabilir, False = başarısız.
    """
    global GLOBAL_CHANNEL, GLOBAL_CONN
    try:
        if GLOBAL_CHANNEL is not None and GLOBAL_CHANNEL.is_open:
            return True
    except Exception:
        pass  # Kapalı kanal — yeniden bağlan

    print("[RabbitMQ] Channel kapalı, yeniden bağlanılıyor...")
    try:
        if GLOBAL_CONN is not None:
            try:
                GLOBAL_CONN.close()
            except Exception:
                pass
        GLOBAL_CONN    = connect_rmq()
        GLOBAL_CHANNEL = GLOBAL_CONN.channel()
        GLOBAL_CHANNEL.queue_declare(queue="oracle.analysis", durable=True)
        GLOBAL_CHANNEL.queue_declare(queue="oracle.status",   durable=True)
        print("[RabbitMQ] ✓ Yeniden bağlandı.")
        return True
    except Exception as e:
        print(f"[RabbitMQ] Yeniden bağlanamadı: {e}")
        GLOBAL_CHANNEL = None
        return False


def send_syslog(msg: str, level: str = "INFO"):
    """
    Konsola yazar + oracle.status kuyruğuna JSON event publish eder.
    Her syslog'da güncel canlı doğruluk oranı da gönderilir (UI sayacı için).
    """
    print(msg)
    if not _ensure_channel():
        return

    # ml v3 canlı AL precision (10g) — yoksa 0. Eski accuracy_stats_v2 artık okunmuyor.
    acc = 0.0
    try:
        if ML_LIVE_STATS.exists():
            stats = json.loads(ML_LIVE_STATS.read_text())
            acc = float(stats.get("al_precision") or 0.0)
    except Exception:
        pass

    try:
        payload = {
            "Level":     level,
            "Message":   msg.strip(),
            "Timestamp": datetime.datetime.utcnow().isoformat() + "Z",
            "Accuracy":  round(acc, 4),
        }
        GLOBAL_CHANNEL.basic_publish(
            exchange="",
            routing_key="oracle.status",
            body=json.dumps(payload, ensure_ascii=False),
            properties=pika.BasicProperties(delivery_mode=2, content_type="application/json"),
        )
    except Exception as e:
        print(f"Syslog gönderme hatası: {e}")


def get_channel():
    """Ana publish noktaları için channel'a erişim."""
    return GLOBAL_CHANNEL


# ── Symbols (BIST/Commodity/Forex) ───────────────────────────────────────────

def _load_symbols() -> tuple[dict, dict, dict]:
    """
    Paylaşılan symbols.json'dan BIST/Commodity/Forex haritalarını yükler.
    docker-compose: ./shared:/shared:ro mount edilmiş olmalı.
    Dosya yoksa hata fırlatmadan boş dict döner.
    """
    candidates = [
        Path("/shared/symbols.json"),                                # Container mount
        Path(__file__).parent.parent / "shared" / "symbols.json",   # Yerel dev
    ]
    for p in candidates:
        if p.exists():
            try:
                data = json.loads(p.read_text(encoding="utf-8"))
                return data.get("bist", {}), data.get("commodity", {}), data.get("forex", {})
            except Exception as e:
                print(f"[symbols] {p} okunamadı: {e}")
    print("[symbols] UYARI: symbols.json bulunamadı, sembol listesi boş!")
    return {}, {}, {}


BIST_MAP, COMMODITY_MAP, FOREX_MAP = _load_symbols()
ALL_SYMBOLS = {**BIST_MAP, **COMMODITY_MAP, **FOREX_MAP}


# ── Core-API HTTP Client ─────────────────────────────────────────────────────

def api_get(path: str) -> list | dict | None:
    """Core-API'ye GET; hata → None."""
    try:
        r = requests.get(f"{CORE_API}{path}", timeout=8)
        r.raise_for_status()
        return r.json()
    except Exception:
        return None


def wait_for_api():
    """Core-API hazır olana kadar 24 deneme × 5 saniye bekler."""
    print("core-api bekleniyor...")
    for _ in range(24):
        try:
            r = requests.get(f"{CORE_API}/api/market/assets", timeout=4)
            if r.status_code < 500:
                print("core-api hazır.")
                return
        except Exception:
            pass
        time.sleep(5)
    print("core-api zaman aşımı — devam ediliyor.")
