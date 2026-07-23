"""
SerInvest ML v3 — Likit BIST-50 Evren + Veri Kalite Filtresi
=============================================================
Az işlemli/gappy hisseler tutarsızlığın ana kaynağıydı. Burada iki katman var:
  1. Kürasyon: BIST'in likit çekirdeği (~50 sembol).
  2. Veri kalite kapısı: yeterli geçmiş + az boşluk + makul hareket olmayanı ELE.

yfinance ticker eşlemesi /shared/symbols.json'dan okunur (tek kaynak — kopyalama yok).
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd

# Likit BIST çekirdek evreni (~50). symbols.json'daki likidite tier'larından
# kürasyon. Kesin "resmi BIST-50" değildir; asıl güvence aşağıdaki veri kalite
# filtresidir — likidite/veri sorunu olanlar otomatik elenir.
BIST50_TICKERS = [
    # Çekirdek (en likit ~25)
    "AKBNK", "ARCLK", "ASELS", "BIMAS", "EKGYO", "EREGL", "FROTO", "GARAN",
    "HALKB", "ISCTR", "KCHOL", "MGROS", "PETKM", "PGSUS", "SAHOL", "SASA",
    "SISE", "TCELL", "THYAO", "TOASO", "TTKOM", "TUPRS", "VAKBN", "VESTL", "YKBNK",
    # İkinci likit tier (~22)
    "AEFES", "AKCNS", "AKSEN", "ALARK", "BRISA", "CCOLA", "CIMSA", "DOAS",
    "DOHOL", "ENJSA", "ENKAI", "GUBRF", "KRDMD", "MPARK", "OYAKC", "SOKM",
    "TAVHL", "TKFEN", "TSKB", "TTRAK", "ULKER", "ZOREN",
    # Likit eklemeler
    "ASTOR", "BRSAN", "HEKTS",
]

_SYMBOLS_CANDIDATES = [
    Path("/shared/symbols.json"),
    Path(__file__).resolve().parent.parent.parent / "shared" / "symbols.json",
]


def _load_symbol_map() -> dict:
    """symbols.json'dan {TICKER: yf_sym} BIST haritasını okur."""
    for p in _SYMBOLS_CANDIDATES:
        if p.exists():
            try:
                data = json.loads(p.read_text(encoding="utf-8"))
                return data.get("bist", {})
            except Exception as e:
                print(f"[ml.universe] {p} okunamadı: {e}")
    print("[ml.universe] UYARI: symbols.json bulunamadı.")
    return {}


def load_universe() -> dict:
    """
    BIST-50 evrenini {TICKER: yf_sym} olarak döndürür.
    Yalnızca symbols.json'da TANIMLI olan tickerlar dahil edilir.
    """
    bist_map = _load_symbol_map()
    uni = {t: bist_map[t] for t in BIST50_TICKERS if t in bist_map}
    missing = [t for t in BIST50_TICKERS if t not in bist_map]
    if missing:
        print(f"[ml.universe] symbols.json'da bulunamayan ({len(missing)}): {missing}")
    return uni


def is_quality_data(df: pd.DataFrame, min_rows: int = 250,
                    max_flat_ratio: float = 0.20) -> tuple[bool, str]:
    """
    Sembolün OHLCV verisi eğitime uygun mu? (gappy/az işlemli hisseleri eler.)

    Kriterler:
      • min_rows: en az bu kadar işlem günü (default ~1 yıl).
      • max_flat_ratio: kapanışı bir önceki günle AYNI olan ('hareketsiz/işlemsiz')
        günlerin oranı bunu aşarsa ELE — düşük likidite işareti.
      • Hacim sütunu varsa, sıfır-hacimli gün oranı da kontrol edilir.

    Döndürür: (uygun_mu, sebep).
    """
    if df is None or len(df) < min_rows:
        return False, f"yetersiz geçmiş ({0 if df is None else len(df)} < {min_rows})"

    close = df["Close"].squeeze() if "Close" in df.columns else None
    if close is None:
        return False, "Close sütunu yok"
    close = close.dropna()
    if len(close) < min_rows:
        return False, f"yetersiz Close ({len(close)} < {min_rows})"

    # Hareketsiz günler (kapanış değişmemiş) — düşük likidite belirtisi
    flat = (close.diff().abs() < 1e-9).mean()
    if flat > max_flat_ratio:
        return False, f"çok hareketsiz gün (%{flat*100:.0f} > %{max_flat_ratio*100:.0f})"

    # Sıfır hacimli günler
    if "Volume" in df.columns:
        vol = df["Volume"].squeeze().fillna(0)
        zero_vol = (vol <= 0).mean()
        if zero_vol > max_flat_ratio:
            return False, f"çok sıfır-hacim günü (%{zero_vol*100:.0f})"

    return True, "ok"
