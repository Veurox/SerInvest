"""
SerInvest ML v3 — Havuzlanmış Eğitim Seti Kurucu
=================================================
BIST-50 evrenindeki her sembol için: indir → kalite kontrol → özellik + etiket →
tek bir cross-sectional matriste birleştir. Model TÜM hisselerden ortak desen
öğrenir (per-sembol değil) — bu daha sağlam ve veri-verimli.

Her satır 'date' ve 'symbol' ile etiketlenir → walk-forward'da zaman-bazlı
bölme ve purge için gerekli. NÖTR (-1) etiketler eğitimden çıkarılır.
"""
import time

import numpy as np
import pandas as pd
import yfinance as yf

from ml.config import FEATURE_NAMES, HISTORY_PERIOD, HORIZON
from ml.features import compute_features, fetch_context
from ml.labels import compute_labels
from ml.universe import is_quality_data, load_universe


def build_dataset(period: str = HISTORY_PERIOD, verbose: bool = True) -> pd.DataFrame:
    """
    Tüm evren için özellik+etiket matrisi üretir.

    Döndürür: DataFrame[date, symbol, <21 feature>, label]
      • label ∈ {0,1} (NÖTR satırlar çıkarılmış)
      • date artan, symbol ile birlikte → walk-forward bölme için hazır
    """
    universe = load_universe()
    if verbose:
        print(f"[dataset] Evren: {len(universe)} sembol | bağlam indiriliyor...")
    ctx = fetch_context(period=period)

    frames = []
    skipped = []
    for i, (sym, yf_sym) in enumerate(universe.items(), 1):
        try:
            df = yf.download(yf_sym, period=period, interval="1d",
                             auto_adjust=True, progress=False, threads=False)
            if df is not None and isinstance(df.columns, pd.MultiIndex):
                df.columns = df.columns.droplevel(1)

            ok, reason = is_quality_data(df)
            if not ok:
                skipped.append((sym, reason))
                if verbose:
                    print(f"  [{i}/{len(universe)}] {sym}: ATLANDI ({reason})")
                time.sleep(0.4)
                continue

            feat = compute_features(df, ctx=ctx)
            lab  = compute_labels(df, feat["atr_pct"], horizon=HORIZON)

            part = feat.copy()
            part["label"]  = lab.values
            part["date"]   = df.index
            part["symbol"] = sym
            # Son HORIZON satır etiketlenemez (gelecek yok) + NÖTR çıkar
            part = part[part["label"] >= 0]
            frames.append(part)

            if verbose:
                print(f"  [{i}/{len(universe)}] {sym}: {len(part)} satır "
                      f"(UP %{100*(part['label']==1).mean():.0f})")
            time.sleep(0.5)
        except Exception as e:
            skipped.append((sym, str(e)))
            if verbose:
                print(f"  [{i}/{len(universe)}] {sym}: HATA {e}")
            time.sleep(0.5)

    if not frames:
        raise RuntimeError("Hiç sembol için veri toplanamadı!")

    data = pd.concat(frames, ignore_index=True)
    data["date"] = pd.to_datetime(data["date"])
    data = data.sort_values("date").reset_index(drop=True)

    if verbose:
        up = 100 * (data["label"] == 1).mean()
        print(f"[dataset] TOPLAM: {len(data)} satır | {len(frames)} sembol "
              f"| atlanan {len(skipped)} | UP %{up:.1f} "
              f"| tarih {data['date'].min().date()} → {data['date'].max().date()}")
    return data


def split_X_y(data: pd.DataFrame):
    """DataFrame → (X[features], y[label]). Eğitim/tahmin için ortak."""
    return data[FEATURE_NAMES], data["label"].astype(int)
