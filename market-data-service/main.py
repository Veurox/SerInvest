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

import yfinance as yf
import pandas as pd
import ta

# ── İzleme Listesi ────────────────────────────────────────────────────────────
BIST_WATCHLIST = {
    "THYAO": "THYAO.IS",
    "GARAN": "GARAN.IS",
    "AKBNK": "AKBNK.IS",
    "EREGL": "EREGL.IS",
    "SISE":  "SISE.IS",
    "KCHOL": "KCHOL.IS",
    "ARCLK": "ARCLK.IS",
    "BIMAS": "BIMAS.IS",
    "ASELS": "ASELS.IS",
    "FROTO": "FROTO.IS",
    "TUPRS": "TUPRS.IS",
    "SASA":  "SASA.IS",
    "SAHOL": "SAHOL.IS",
    "TTKOM": "TTKOM.IS",
    "TCELL": "TCELL.IS",
    "PGSUS": "PGSUS.IS",
    "MGROS": "MGROS.IS",
    "HALKB": "HALKB.IS",
    "VAKBN": "VAKBN.IS",
    "YKBNK": "YKBNK.IS",
    "PETKM": "PETKM.IS",
    "EKGYO": "EKGYO.IS",
    "ISCTR": "ISCTR.IS",
    "TOASO": "TOASO.IS",
    "VESTL": "VESTL.IS",
}

COMMODITIES = {
    "XAUUSD":   "GC=F",
    "XAGUSD":   "SI=F",
    "BRENTOIL": "BZ=F",
}

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


def fetch_ohlcv(yf_symbol: str, period: str = "3mo") -> pd.DataFrame | None:
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
        return "NEUTRAL", 0.5

    normalized = score / weight  # -1 ile +1 arası
    strength = round((abs(normalized) * 0.5) + 0.5, 2)  # 0.5 → 1.0 arası

    if normalized > 0.25:
        signal = "BUY"
    elif normalized < -0.25:
        signal = "SELL"
    else:
        signal = "NEUTRAL"

    return signal, strength


def build_message(symbol: str, asset_type: str, df: pd.DataFrame, ind: dict) -> dict:
    row = df.iloc[-1]
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


def publish(channel, data: dict) -> None:
    channel.basic_publish(
        exchange="",
        routing_key="market.data",
        body=json.dumps(data, ensure_ascii=False),
        properties=pika.BasicProperties(delivery_mode=2, content_type="application/json"),
    )


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
    for attempt in range(15):
        try:
            conn = pika.BlockingConnection(
                pika.ConnectionParameters(host=host, heartbeat=600, blocked_connection_timeout=300)
            )
            print(f"RabbitMQ bağlantısı kuruldu: {host}")
            return conn
        except pika.exceptions.AMQPConnectionError:
            print(f"RabbitMQ hazır değil, yeniden deneniyor ({attempt + 1}/15)...")
            time.sleep(5)
    raise RuntimeError("RabbitMQ'ya bağlanılamadı")


def main():
    print("SerInvest Piyasa Veri Servisi başlatılıyor...")
    conn = connect_rabbitmq()
    channel = conn.channel()
    channel.queue_declare(queue="market.data", durable=True)

    try:
        while True:
            run_cycle(channel)
            print("\nSonraki döngü 5 dakika sonra...")
            time.sleep(300)
    except KeyboardInterrupt:
        print("Durduruluyor...")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
