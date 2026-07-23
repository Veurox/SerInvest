"""
SerInvest ML v3 — Saf Teknik Özellikler (~21)
==============================================
Tek-sembol teknik göstergeler + 3 fiyat-türevi piyasa bağlamı (XU100 göreli güç,
USDTRY getirisi). Haber/temel/makro YOK. 2 haftalık ufukta gürültü olan intraday
mikro-yapı (wick/gap) bilinçli dışarıda.

ÖNEMLİ — sızıntı (look-ahead) güvenliği:
  Tüm göstergeler yalnızca GEÇMİŞ veriyle hesaplanır (rolling/ewm, ileriye bakış yok).
  Bağlam serileri reindex + ffill ile hizalanır (gelecekten değer sızmaz).
"""
import time

import numpy as np
import pandas as pd
import ta
import yfinance as yf

from ml.config import FEATURE_NAMES


def fetch_context(period: str = "3y") -> pd.DataFrame:
    """
    Fiyat-türevi piyasa bağlamı: XU100 (5g/20g getiri) + USDTRY (5g getiri).
    Tek seferde indirilir, sembol döngüsünde reindex+ffill ile hizalanır.
    """
    out = {}
    feeds = {"XU100": "XU100.IS", "USDTRY": "USDTRY=X"}
    series = {}
    for name, yf_sym in feeds.items():
        try:
            df = yf.download(yf_sym, period=period, interval="1d",
                             auto_adjust=True, progress=False, threads=False)
            if df is not None and not df.empty:
                if isinstance(df.columns, pd.MultiIndex):
                    df.columns = df.columns.droplevel(1)
                series[name] = df["Close"].squeeze().ffill()
            time.sleep(0.3)
        except Exception as e:
            print(f"[ml.features] bağlam {name}: {e}")

    if not series:
        return pd.DataFrame()

    idx = None
    for s in series.values():
        idx = s.index if idx is None else idx.union(s.index)
    panel = pd.DataFrame(index=idx).sort_index()

    if "XU100" in series:
        xu = series["XU100"].reindex(panel.index).ffill()
        out["xu100_ret5"]  = xu.pct_change(5)
        out["xu100_ret20"] = xu.pct_change(20)
    if "USDTRY" in series:
        ut = series["USDTRY"].reindex(panel.index).ffill()
        out["usdtry_ret5"] = ut.pct_change(5)

    panel = pd.DataFrame(out, index=panel.index).ffill().fillna(0.0)
    return panel


def compute_features(df: pd.DataFrame, ctx: pd.DataFrame | None = None) -> pd.DataFrame:
    """
    OHLCV → 21 saf teknik özellik (FEATURE_NAMES sırasında).
    ctx verilmezse bağlam özellikleri 0 (nötr) olur.
    """
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.droplevel(1)

    close  = df["Close"].squeeze().ffill()
    high   = df["High"].squeeze().ffill()   if "High"   in df.columns else close
    low    = df["Low"].squeeze().ffill()    if "Low"    in df.columns else close
    volume = df["Volume"].squeeze().fillna(0) if "Volume" in df.columns else pd.Series(0.0, index=df.index)

    f = pd.DataFrame(index=df.index)

    # ── Momentum ──────────────────────────────────────────────────────────
    rsi = ta.momentum.RSIIndicator(close, 14).rsi()
    f["rsi"]       = rsi
    f["rsi_slope"] = rsi.diff(3)

    mhist = ta.trend.MACD(close).macd_diff()
    f["macd_hist"]       = mhist
    f["macd_hist_slope"] = mhist.diff(2)

    # ── Bollinger ─────────────────────────────────────────────────────────
    bb  = ta.volatility.BollingerBands(close)
    bbu, bbl, bbm = bb.bollinger_hband(), bb.bollinger_lband(), bb.bollinger_mavg()
    bbr = (bbu - bbl).replace(0, np.nan)
    f["bb_pct"]   = (close - bbl) / bbr
    f["bb_width"] = bbr / bbm.replace(0, np.nan)

    # ── Trend (EMA) ───────────────────────────────────────────────────────
    ema9   = ta.trend.EMAIndicator(close, 9).ema_indicator()
    ema20  = ta.trend.EMAIndicator(close, 20).ema_indicator()
    ema50  = ta.trend.EMAIndicator(close, 50).ema_indicator()
    ema200 = ta.trend.EMAIndicator(close, 200).ema_indicator()
    f["ema9_diff"]    = (ema9 - ema20) / ema20.replace(0, np.nan)
    f["ema20_diff"]   = (ema20 - ema50) / ema50.replace(0, np.nan)
    bull = ((ema9 > ema20) & (ema20 > ema50)).astype(float)
    bear = ((ema9 < ema20) & (ema20 < ema50)).astype(float)
    f["ema_alignment"] = bull - bear
    f["above_ema200"]  = (close > ema200).astype(float)
    f["ema200_trend"]  = ema200.pct_change(20)
    dist = close - ema50
    f["dist_ema50_z"] = (dist / dist.rolling(20).std().replace(0, np.nan)).clip(-5, 5)

    # ── Getiri ────────────────────────────────────────────────────────────
    f["ret_5d"]  = close.pct_change(5)
    f["ret_20d"] = close.pct_change(20)
    f["ret_consistency"] = np.sign(close.pct_change(1)).rolling(10).mean()

    # ── Hacim & Volatilite ──────────────────────────────────────────────────
    vol_ma = volume.rolling(20).mean().replace(0, np.nan)
    f["vol_ratio"] = volume / vol_ma
    atr = ta.volatility.AverageTrueRange(high, low, close, 14).average_true_range()
    f["atr_pct"] = atr / close.replace(0, np.nan)

    # ── 52 Hafta Pozisyon ───────────────────────────────────────────────────
    roll_max = close.rolling(252, min_periods=60).max()
    f["price_vs_52w_high"] = (close - roll_max) / roll_max.replace(0, np.nan)

    # ── Fiyat-türevi piyasa bağlamı (saf teknik) ─────────────────────────────
    if ctx is not None and not ctx.empty:
        c = ctx.reindex(f.index, method="ffill")
        xu5  = c["xu100_ret5"]  if "xu100_ret5"  in c.columns else 0.0
        xu20 = c["xu100_ret20"] if "xu100_ret20" in c.columns else 0.0
        f["usdtry_ret5"] = (c["usdtry_ret5"] if "usdtry_ret5" in c.columns else 0.0)
    else:
        xu5 = xu20 = 0.0
        f["usdtry_ret5"] = 0.0
    f["rel_strength_5d"]  = f["ret_5d"]  - xu5
    f["rel_strength_20d"] = f["ret_20d"] - xu20

    # ── Temizlik: inf/nan → 0 (model NaN sevmez) ──────────────────────────────
    f = f.replace([np.inf, -np.inf], np.nan).fillna(0.0)
    return f[FEATURE_NAMES]


# ═════════════════════════════════════════════════════════════════════════════
#  KESİTSEL RANK DÖNÜŞÜMÜ (XSEC_RANK — 06/2026 deney kanıtlı)
#  Mutlak değer yerine "bu hisse bugün evrenin yüzde kaçında?" — model piyasa
#  zamanlamasından arınıp hisse SEÇİCİ olur. Eğitim ve canlı AYNI dönüşümü kullanır.
# ═════════════════════════════════════════════════════════════════════════════

def xsec_rank_frame(data: pd.DataFrame, cols: list[str] | None = None) -> pd.DataFrame:
    """
    EĞİTİM yolu: (date, symbol, features) uzun formatında her TARİH grubunda
    her özelliği percentile rank'e (0..1) çevirir. Yalnız gün-içi bilgi kullanır
    → sızıntı yok. Deney: ml/experiment_xsec.py.
    """
    cols = cols or list(FEATURE_NAMES)
    out = data.copy()
    ranked = out.groupby("date")[cols].rank(pct=True)
    for c in cols:
        out[c] = ranked[c].fillna(0.5)
    return out


def xsec_rank_latest(feat_by_symbol: dict[str, dict], cols: list[str] | None = None) -> dict[str, dict]:
    """
    CANLI yol: {sembol: {feature: değer}} bugünün kesiti → aynı percentile rank.
    Eğitimdeki groupby("date").rank(pct=True) ile birebir aynı matematik.
    """
    cols = cols or list(FEATURE_NAMES)
    if not feat_by_symbol:
        return {}
    frame = pd.DataFrame.from_dict(feat_by_symbol, orient="index")
    for c in cols:
        if c not in frame.columns:
            frame[c] = np.nan
    ranked = frame[cols].rank(pct=True).fillna(0.5)
    return {sym: ranked.loc[sym].to_dict() for sym in ranked.index}
