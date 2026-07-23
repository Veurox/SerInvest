"""
SerInvest Piyasa Verisi Servisi (Faz 1)
-----------------------------------------
- BIST30 hisseleri, Altın, Gümüş, Petrol, USD/TRY için OHLCV verisi çeker (yfinance)
- RSI, MACD, Bollinger Bantları ve EMA teknik indikatörlerini hesaplar
- Her 5 dakikada bir RabbitMQ 'market.data' kuyruğuna yapılandırılmış veri gönderir
- yfinance 15 dk gecikmeli veri sağlar (kişisel kullanım için yeterli)
"""

import pika
import json
import time
import datetime
import os
import math
import socket
from pathlib import Path

import yfinance as yf
import pandas as pd
import ta

# yfinance internally uses requests; bir HTTP çağrısı askıya alınırsa cycle saatlerce
# bloke olur ve heartbeat ölmüş olur. Global socket timeout 30 saniyeye çekildi —
# Yahoo'nun normalde 1-3sn yanıt verdiği düşünülürse fazlasıyla yeterli.
socket.setdefaulttimeout(30)

# ── İzleme Listesi ────────────────────────────────────────────────────────────
# NOT: ai-oracle-service/main.py içindeki BIST_MAP ile aynı tutulmalı.
# Eklenen sembol burada yoksa Oracle yarı kör çalışır (fiyat sinyali gelmez).
def _load_symbols() -> tuple[dict, dict]:
    """Paylaşılan symbols.json'dan BIST + Commodity haritalarını yükle."""
    candidates = [
        Path("/shared/symbols.json"),
        Path(__file__).parent.parent / "shared" / "symbols.json",
    ]
    for p in candidates:
        if p.exists():
            try:
                data = json.loads(p.read_text(encoding="utf-8"))
                return data.get("bist", {}), data.get("commodity", {})
            except Exception as e:
                print(f"[symbols] {p} okunamadı: {e}")
    print("[symbols] UYARI: symbols.json bulunamadı!")
    return {}, {}

BIST_WATCHLIST, _COMMODITIES_FROM_JSON = _load_symbols()

COMMODITIES = _COMMODITIES_FROM_JSON or {
    "XAUUSD":   "GC=F",
    "XAGUSD":   "SI=F",
    "BRENTOIL": "BZ=F",
    "NATGAS":   "NG=F",
    "COPPER":   "HG=F",
}

# Forex için ayrı dict (symbols.json'da forex bölümü var ama market-data
# kendi listesini tutmaya devam ediyor — fundamental ve oracle forex işlemiyor).
FOREX = {
    "USDTRY": "USDTRY=X",
    "EURTRY": "EURTRY=X",
}

# Küresel Endeksler — Makro bağlam için kritik (Faz 2+)
# BİST, küresel risk iştahına ve dolar endeksine yüksek korelasyon gösterir
GLOBAL_INDICES = {
    "SP500":   "^GSPC",      # S&P 500 — küresel risk iştahı barometresi
    "NASDAQ":  "^IXIC",      # Nasdaq — teknoloji/büyüme sektörü
    "DAX":     "^GDAXI",     # DAX — Avrupa / Türkiye'nin en büyük ticaret ortağı
    "VIX":     "^VIX",       # Korku endeksi — 20 üstü risk-off, 30 üstü panik
    "DXY":     "DX-Y.NYB",   # Dolar endeksi — güçlü dolar EM'lere baskı yapar
    "MSCI_EM": "EEM",        # MSCI Gelişmekte Olan Piyasalar ETF — BİST ile korelasyon yüksek
}


def safe_float(val) -> float | None:
    try:
        f = float(val)
        return None if (math.isnan(f) or math.isinf(f)) else round(f, 4)
    except Exception:
        return None


def fetch_ohlcv(yf_symbol: str, period: str = "2y") -> pd.DataFrame | None:
    # 2 yıl: EMA200 hesaplaması için minimum 200 günlük tarihsel veri gerekli.
    # 3mo (~63 gün) sadece kısa vadeli göstergeler (EMA9/20/50, RSI) için yeterli;
    # uzun vadeli trend EMA'sı için yetersiz kaldığı tespit edildi (denetim 04/2026).
    try:
        df = yf.download(
            yf_symbol,
            period=period,
            interval="1d",
            auto_adjust=True,
            progress=False,
            threads=False,
        )
        if df.empty:
            return None
        # yfinance bazen MultiIndex döndürür
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.droplevel(1)
        df.columns = [c.strip() for c in df.columns]
        return df
    except Exception as e:
        print(f"  yfinance hatası [{yf_symbol}]: {e}")
        return None


def calculate_indicators(df: pd.DataFrame) -> dict:
    if df is None or len(df) < 20:
        return {}

    close = df["Close"].dropna().squeeze()

    result: dict = {}

    # RSI(14)
    try:
        result["rsi"] = safe_float(
            ta.momentum.RSIIndicator(close=close, window=14).rsi().iloc[-1]
        )
    except Exception:
        result["rsi"] = None

    # MACD(12,26,9)
    try:
        macd_obj = ta.trend.MACD(close=close, window_slow=26, window_fast=12, window_sign=9)
        result["macd_line"]      = safe_float(macd_obj.macd().iloc[-1])
        result["macd_signal"]    = safe_float(macd_obj.macd_signal().iloc[-1])
        result["macd_histogram"] = safe_float(macd_obj.macd_diff().iloc[-1])
    except Exception:
        result["macd_line"] = result["macd_signal"] = result["macd_histogram"] = None

    # Bollinger Bantları(20, 2σ)
    try:
        bb = ta.volatility.BollingerBands(close=close, window=20, window_dev=2)
        result["bb_upper"]  = safe_float(bb.bollinger_hband().iloc[-1])
        result["bb_middle"] = safe_float(bb.bollinger_mavg().iloc[-1])
        result["bb_lower"]  = safe_float(bb.bollinger_lband().iloc[-1])
    except Exception:
        result["bb_upper"] = result["bb_middle"] = result["bb_lower"] = None

    # EMA'lar
    for window in [9, 20, 50, 200]:
        key = f"ema{window}"
        if len(close) >= window:
            try:
                result[key] = safe_float(
                    ta.trend.EMAIndicator(close=close, window=window).ema_indicator().iloc[-1]
                )
            except Exception:
                result[key] = None
        else:
            result[key] = None

    return result


def calculate_signal(close_price: float | None, ind: dict) -> tuple[str, float]:
    """Teknik indikatör uyumuna göre sinyal ve kuvvet hesaplar (-1 to 1 arası skoru normalleştirir)."""
    if not close_price:
        return "NEUTRAL", 0.5

    score = 0.0
    weight = 0.0

    rsi = ind.get("rsi")
    if rsi is not None:
        w = 1.5
        weight += w
        if rsi < 30:
            score += w          # Aşırı satış
        elif rsi < 45:
            score += w * 0.4
        elif rsi > 70:
            score -= w          # Aşırı alış
        elif rsi > 55:
            score -= w * 0.4

    ml = ind.get("macd_line")
    ms = ind.get("macd_signal")
    if ml is not None and ms is not None:
        w = 1.5
        weight += w
        score += w if ml > ms else -w

    mh = ind.get("macd_histogram")
    if mh is not None:
        w = 0.8
        weight += w
        score += w if mh > 0 else -w

    ema20 = ind.get("ema20")
    ema50 = ind.get("ema50")
    if ema20 is not None and ema50 is not None:
        w = 1.2
        weight += w
        score += w if ema20 > ema50 else -w  # Golden/Death cross

    ema50 = ind.get("ema50")
    if ema50 is not None:
        w = 1.0
        weight += w
        score += w if close_price > ema50 else -w  # Fiyat EMA50 üzerinde mi?

    bb_lower = ind.get("bb_lower")
    bb_upper = ind.get("bb_upper")
    if bb_lower is not None and bb_upper is not None:
        w = 1.0
        weight += w
        if close_price < bb_lower:
            score += w      # Alt bant altı → potansiyel toparlanma
        elif close_price > bb_upper:
            score -= w      # Üst bant üstü → potansiyel düzeltme

    if weight == 0:
        return "NEUTRAL", 0.0

    normalized = score / weight  # -1 ile +1 arası
    # Strength gerçek 0-1 bandında — zayıf sinyal %0'a, güçlü sinyal %100'e yaklaşsın.
    # Eski formül (0.5 + abs/2) zayıf sinyalleri %50 olarak gösteriyordu, yanıltıcıydı.
    strength = round(abs(normalized), 3)

    if normalized > 0.25:
        signal = "BUY"
    elif normalized < -0.25:
        signal = "SELL"
    else:
        signal = "NEUTRAL"

    return signal, strength


def build_message(symbol: str, asset_type: str, df: pd.DataFrame, ind: dict) -> dict:
    # Borsa kapalıyken son satır NaN olabilir; Close dolu olan son satırı al
    valid_rows = df[df["Close"].notna()]
    row = valid_rows.iloc[-1] if len(valid_rows) > 0 else df.iloc[-1]
    close = safe_float(row.get("Close"))
    signal, strength = calculate_signal(close, ind)

    return {
        "symbol":          symbol,
        "asset_type":      asset_type,
        "timestamp":       datetime.datetime.utcnow().isoformat(),
        "close":           close,
        "open":            safe_float(row.get("Open")),
        "high":            safe_float(row.get("High")),
        "low":             safe_float(row.get("Low")),
        "volume":          safe_float(row.get("Volume")),
        "rsi":             ind.get("rsi"),
        "macd_line":       ind.get("macd_line"),
        "macd_signal":     ind.get("macd_signal"),
        "macd_histogram":  ind.get("macd_histogram"),
        "bb_upper":        ind.get("bb_upper"),
        "bb_middle":       ind.get("bb_middle"),
        "bb_lower":        ind.get("bb_lower"),
        "ema9":            ind.get("ema9"),
        "ema20":           ind.get("ema20"),
        "ema50":           ind.get("ema50"),
        "ema200":          ind.get("ema200"),
        "signal":          signal,
        "signal_strength": strength,
    }


# Global tutucular — uzun döngülerde reconnect için
_CONN: pika.BlockingConnection | None = None
_CHANNEL = None


def _ensure_connection() -> bool:
    """RabbitMQ bağlantısı kapanmışsa yeniden kurar."""
    global _CONN, _CHANNEL
    try:
        if _CONN is not None and _CONN.is_open and _CHANNEL is not None and _CHANNEL.is_open:
            return True
    except Exception:
        pass

    print("[RabbitMQ] Bağlantı kapalı, yeniden kuruluyor...")
    try:
        if _CONN is not None:
            try:
                _CONN.close()
            except Exception:
                pass
        _CONN = connect_rabbitmq()
        _CHANNEL = _CONN.channel()
        _CHANNEL.queue_declare(queue="market.data", durable=True)
        print("[RabbitMQ] ✓ Yeniden bağlanıldı.")
        return True
    except Exception as e:
        print(f"[RabbitMQ] Yeniden bağlanma başarısız: {e}")
        _CHANNEL = None
        return False


def publish(channel, data: dict) -> bool:
    """Mesajı yayımlar; bağlantı koptuysa yeniden kurar. Başarılıysa True döner."""
    if not _ensure_connection():
        return False
    _CHANNEL.basic_publish(
        exchange="",
        routing_key="market.data",
        body=json.dumps(data, ensure_ascii=False),
        properties=pika.BasicProperties(delivery_mode=2, content_type="application/json"),
    )
    return True


def run_cycle(channel) -> None:
    ts = datetime.datetime.now().strftime("%H:%M:%S")
    print(f"\n{'─'*55}")
    print(f"  Piyasa Veri Döngüsü — {ts}")
    print(f"{'─'*55}")

    success = 0

    # BIST Hisseleri
    for symbol, yf_sym in BIST_WATCHLIST.items():
        df = fetch_ohlcv(yf_sym)
        if df is not None:
            ind = calculate_indicators(df)
            msg = build_message(symbol, "BIST", df, ind)
            publish(channel, msg)
            rsi_str = f"RSI={msg['rsi']:.1f}" if msg["rsi"] else "RSI=—"
            print(f"  {symbol:<8} {msg['close'] or '—':>8} TL  |  {msg['signal']:<7}  {rsi_str}")
            success += 1
        time.sleep(0.8)

    # Emtialar
    for symbol, yf_sym in COMMODITIES.items():
        df = fetch_ohlcv(yf_sym)
        if df is not None:
            ind = calculate_indicators(df)
            msg = build_message(symbol, "COMMODITY", df, ind)
            publish(channel, msg)
            print(f"  {symbol:<10} {msg['close'] or '—':>10}  |  {msg['signal']}")
            success += 1
        time.sleep(0.5)

    # Döviz
    for symbol, yf_sym in FOREX.items():
        df = fetch_ohlcv(yf_sym)
        if df is not None:
            ind = calculate_indicators(df)
            msg = build_message(symbol, "FOREX", df, ind)
            publish(channel, msg)
            print(f"  {symbol:<10} {msg['close'] or '—':>10}")
            success += 1
        time.sleep(0.5)

    # Küresel Endeksler (Makro Bağlam)
    print(f"\n  ── Küresel Endeksler ──")
    for symbol, yf_sym in GLOBAL_INDICES.items():
        df = fetch_ohlcv(yf_sym)
        if df is not None:
            ind = calculate_indicators(df)
            msg = build_message(symbol, "GLOBAL", df, ind)
            publish(channel, msg)
            sig_str = f"[{msg['signal']}]" if symbol != "VIX" else f"[Korku={msg['close']:.0f}]" if msg['close'] else ""
            print(f"  {symbol:<10} {msg['close'] or '—':>10}  {sig_str}")
            success += 1
        time.sleep(0.5)

    print(f"\n  Toplam {success} varlık gönderildi.")


def connect_rabbitmq() -> pika.BlockingConnection:
    host = os.environ.get("RABBITMQ_HOST", "localhost")
    for attempt in range(30):
        try:
            # heartbeat=0: yfinance hangi bir sembol için askıya alabilir;
            # _ensure_connection() her publish'ten önce kontrol ediyor.
            conn = pika.BlockingConnection(
                pika.ConnectionParameters(host=host, heartbeat=0, blocked_connection_timeout=300)
            )
            print(f"RabbitMQ bağlantısı kuruldu: {host}")
            return conn
        except Exception as e:
            # socket.gaierror (DNS), AMQPConnectionError ve diğer geçici hatalar
            print(f"RabbitMQ bekleniyor ({attempt + 1}/30): {e}")
            time.sleep(5)
    raise RuntimeError("RabbitMQ'ya bağlanılamadı")


# ── Chart HTTP API (UI tıklayınca 1H/1D/1W/1M/3M/1Y/5Y grafiği) ──────────────
# Flask uygulaması — main thread RabbitMQ döngüsü çalışırken paralel olarak
# HTTP isteklerine yanıt verir. Cache ile yfinance üzerinde gereksiz yük yaratmaz.
import threading
from flask import Flask, jsonify, request

CHART_TF_MAP = {
    "1H": ("1d",  "1m"),    # son 60 nokta
    "1D": ("1d",  "5m"),
    "1W": ("5d",  "30m"),
    "1M": ("1mo", "1h"),
    "3M": ("3mo", "1d"),
    "1Y": ("1y",  "1d"),
    "5Y": ("5y",  "1wk"),
}
CHART_TTL_SEC = {
    "1H": 60, "1D": 60, "1W": 300, "1M": 900,
    "3M": 3600, "1Y": 3600, "5Y": 3600,
}
_CHART_CACHE: dict[tuple[str, str], tuple[float, dict]] = {}
_CHART_LOCK = threading.Lock()

# Tüm desteklenen semboller (BIST + emtia + döviz + endeksler)
def _all_chart_symbols() -> dict:
    return {**BIST_WATCHLIST, **COMMODITIES, **FOREX, **GLOBAL_INDICES}

chart_app = Flask(__name__)

@chart_app.after_request
def _cors(resp):
    # Tek kullanıcı / lokal — geniş CORS yeterli
    resp.headers["Access-Control-Allow-Origin"]  = "*"
    resp.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return resp

@chart_app.route("/health")
def _health():
    return jsonify({"ok": True, "service": "market-data-chart"})

@chart_app.route("/chart/<symbol>", methods=["GET", "OPTIONS"])
def chart(symbol: str):
    if request.method == "OPTIONS":
        return ("", 204)

    symbol = symbol.upper().strip()
    tf = request.args.get("tf", "1D").upper()

    if tf not in CHART_TF_MAP:
        return jsonify({"error": f"desteklenmeyen tf: {tf}",
                        "supported": list(CHART_TF_MAP.keys())}), 400

    yf_sym = _all_chart_symbols().get(symbol)
    if not yf_sym:
        return jsonify({"error": f"bilinmeyen sembol: {symbol}"}), 404

    cache_key = (symbol, tf)
    ttl = CHART_TTL_SEC[tf]
    now = time.time()

    with _CHART_LOCK:
        cached = _CHART_CACHE.get(cache_key)
        if cached and (now - cached[0]) < ttl:
            return jsonify(cached[1])

    period, interval = CHART_TF_MAP[tf]
    try:
        df = yf.download(
            yf_sym,
            period=period,
            interval=interval,
            auto_adjust=True,
            progress=False,
            threads=False,
        )
        if df is None or df.empty:
            payload = {"symbol": symbol, "tf": tf, "yf": yf_sym, "points": []}
            with _CHART_LOCK:
                _CHART_CACHE[cache_key] = (now, payload)
            return jsonify(payload)

        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.droplevel(1)
        df.columns = [str(c).strip() for c in df.columns]

        points = []
        for ts, row in df.iterrows():
            c = safe_float(row.get("Close"))
            if c is None:
                continue
            try:
                t_ms = int(pd.Timestamp(ts).timestamp() * 1000)
            except Exception:
                continue
            points.append({
                "t": t_ms,
                "o": safe_float(row.get("Open")),
                "h": safe_float(row.get("High")),
                "l": safe_float(row.get("Low")),
                "c": c,
                "v": safe_float(row.get("Volume")),
            })

        # 1H: yfinance 1m verisi 1 günlük döner — son 60 noktayı al
        if tf == "1H" and len(points) > 60:
            points = points[-60:]

        first_c = points[0]["c"] if points else None
        last_c  = points[-1]["c"] if points else None
        change_pct = ((last_c - first_c) / first_c * 100.0) if (first_c and last_c) else None

        payload = {
            "symbol": symbol,
            "tf": tf,
            "yf": yf_sym,
            "interval": interval,
            "period": period,
            "points": points,
            "first": first_c,
            "last":  last_c,
            "change_pct": round(change_pct, 4) if change_pct is not None else None,
            "fetched_at": int(now * 1000),
        }
        with _CHART_LOCK:
            _CHART_CACHE[cache_key] = (now, payload)
        return jsonify(payload)

    except Exception as e:
        print(f"[chart] {symbol} {tf} hata: {e}")
        return jsonify({"error": str(e)}), 500


def start_chart_server():
    port = int(os.environ.get("CHART_HTTP_PORT", "5002"))
    print(f"[Chart HTTP] başlatılıyor: 0.0.0.0:{port}")
    chart_app.run(host="0.0.0.0", port=port, debug=False,
                  use_reloader=False, threaded=True)


def main():
    print("SerInvest Piyasa Veri Servisi başlatılıyor...")
    # Chart HTTP API'sini arka planda başlat (RabbitMQ döngüsü ile paralel)
    threading.Thread(target=start_chart_server, daemon=True, name="chart-http").start()

    # Docker ağ DNS'inin tamamen hazırlanması için kısa bekleme
    time.sleep(8)
    if not _ensure_connection():
        raise RuntimeError("İlk RabbitMQ bağlantısı kurulamadı")

    try:
        while True:
            # Channel global olarak yönetiliyor; run_cycle publish() üzerinden geçer
            run_cycle(_CHANNEL)
            print("\nSonraki döngü 5 dakika sonra...")
            time.sleep(300)
    except KeyboardInterrupt:
        print("Durduruluyor...")
    finally:
        try:
            if _CONN is not None:
                _CONN.close()
        except Exception:
            pass


if __name__ == "__main__":
    main()
