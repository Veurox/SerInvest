"""
SerInvest Oracle — Çalışma Zamanı Sabitleri (ml v3)
====================================================
Yalnızca CANLI sistemin (main + infra) ihtiyaç duyduğu ortam/yol sabitleri.

Not: Eski füzyon ML sistemine ait sabitler (FEATURE_NAMES, triple-barrier
çarpanları, eşikler, model dosya yolları, retrain/WF parametreleri) Faz 6
geçişinde kaldırıldı. ML'e dair tüm sabitler artık `ml/config.py` içindedir;
paper_trading da oradan okur.
"""
import os
from pathlib import Path

# ── Ortam Değişkenleri ───────────────────────────────────────────────────────
CORE_API   = os.environ.get("CORE_API_URL", "http://core-api:8080")
RMQ_HOST   = os.environ.get("RABBITMQ_HOST", "localhost")
CYCLE_MIN  = int(os.environ.get("ORACLE_CYCLE_MINUTES", "60"))

# ── Kalıcı Veri Dizini (oracle_models volume) ────────────────────────────────
MODELS_DIR = Path("/app/models")
