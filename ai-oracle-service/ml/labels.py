"""
SerInvest ML v3 — 10 Günlük Triple-Barrier Etiketleme
======================================================
López de Prado triple-barrier. ufuk=10 işlem günü. Eğitim ve canlı değerlendirme
AYNI fonksiyonu kullanır → etiket tutarlılığı garanti (eski sistemdeki en kritik
hatayı baştan engeller).

Etiket:
  1 = UP   (önce TP'ye değdi VEYA zaman sonu net yukarı)
  0 = DOWN (önce SL'ye değdi VEYA zaman sonu net aşağı)
 -1 = NÖTR (yatay; eğitimden ve isabet metriğinden ÇIKAR)
"""
import numpy as np
import pandas as pd

from ml.config import (
    ATR_CAP,
    ATR_FLOOR,
    HORIZON,
    SL_ATR_MULT,
    TIME_BARRIER_MIN_MOVE,
    TP_ATR_MULT,
)


def clamp_atr_pct(ap) -> float:
    """Günlük ATR%'yi bariyer bandına sınırla; geçersizse taban değer."""
    try:
        ap = float(ap)
    except Exception:
        ap = ATR_FLOOR
    if not np.isfinite(ap) or ap <= 0:
        ap = ATR_FLOOR
    return min(max(ap, ATR_FLOOR), ATR_CAP)


def triple_barrier_label(entry, future_highs, future_lows,
                         final_close, atr_pct) -> int:
    """
    Tek bir giriş noktası için triple-barrier etiketi.

    Bariyerler (entry'ye göre):
      TP = entry × (1 + TP_ATR_MULT × atr_pct)
      SL = entry × (1 - SL_ATR_MULT × atr_pct)
      Zaman = HORIZON gün sonu

    t+1..t+HORIZON arası her gün kontrol; hangi bariyere ÖNCE değerse o yön.
    Aynı gün ikisi de → muhafazakâr DOWN (gün-içi sıra bilinmez, kötü senaryo).
    """
    if entry is None or not np.isfinite(entry) or entry <= 0:
        return -1
    ap = clamp_atr_pct(atr_pct)
    tp = entry * (1 + TP_ATR_MULT * ap)
    sl = entry * (1 - SL_ATR_MULT * ap)

    n = min(len(future_highs), len(future_lows))
    for j in range(n):
        hi, lo = future_highs[j], future_lows[j]
        if not (np.isfinite(hi) and np.isfinite(lo)):
            continue
        hit_tp = hi >= tp
        hit_sl = lo <= sl
        if hit_tp and hit_sl:
            return 0          # muhafazakâr: aynı gün ikisi de → stop önce
        if hit_tp:
            return 1
        if hit_sl:
            return 0

    # Zaman bariyeri — kapanış hareketine bak
    if final_close is None or not np.isfinite(final_close):
        return -1
    final_ret = (final_close - entry) / entry
    if final_ret >  TIME_BARRIER_MIN_MOVE:
        return 1
    if final_ret < -TIME_BARRIER_MIN_MOVE:
        return 0
    return -1   # yatay → nötr


def compute_labels(df: pd.DataFrame, atr_pct_series: pd.Series,
                   horizon: int = HORIZON) -> pd.Series:
    """
    Tüm seri için triple-barrier etiketleri (index hizalı).

    df              : OHLC (High/Low/Close gerekli)
    atr_pct_series  : compute_feature_df'in ürettiği 'atr_pct' (günlük), index hizalı.
    """
    close = df["Close"].squeeze().astype(float)
    high  = df["High"].squeeze().astype(float)
    low   = df["Low"].squeeze().astype(float)

    close_arr = close.values
    high_arr  = high.values
    low_arr   = low.values
    atr_arr   = atr_pct_series.reindex(close.index).values

    n = len(close_arr)
    labels = np.full(n, -1, dtype=int)
    for i in range(n - horizon):
        labels[i] = triple_barrier_label(
            entry        = close_arr[i],
            future_highs = high_arr[i + 1 : i + 1 + horizon],
            future_lows  = low_arr[i + 1 : i + 1 + horizon],
            final_close  = close_arr[i + horizon],
            atr_pct      = atr_arr[i],
        )
    return pd.Series(labels, index=close.index, dtype=int)
