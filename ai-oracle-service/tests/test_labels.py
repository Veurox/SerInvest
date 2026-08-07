"""
Triple-barrier etiketleme — sistemin EN KRİTİK matematiği.

Neden burası: etiket tanımı eğitim ve canlı değerlendirmede AYNI olmak
zorunda. Eski sistemde bu ikisi ayrıştığı için isabet metriği yalan
söylüyordu. Buradaki testler tanımı kilitler; biri sessizce değiştirirse
CI kırılır.
"""
import numpy as np
import pandas as pd
import pytest

from ml.config import (ATR_CAP, ATR_FLOOR, HORIZON, SL_ATR_MULT,
                       TIME_BARRIER_MIN_MOVE, TP_ATR_MULT)
from ml.labels import clamp_atr_pct, compute_labels, triple_barrier_label

ENTRY = 100.0
AP    = 0.02                      # %2 günlük ATR
TP    = ENTRY * (1 + TP_ATR_MULT * AP)
SL    = ENTRY * (1 - SL_ATR_MULT * AP)


def _flat(n, price=ENTRY):
    return [price] * n


# ── Bariyer sırası ───────────────────────────────────────────────────────────

def test_tp_once_hit_up():
    """Önce TP'ye değerse UP (1)."""
    highs = [ENTRY, TP + 0.5] + _flat(8)
    lows  = _flat(10, ENTRY - 0.5)
    assert triple_barrier_label(ENTRY, highs, lows, ENTRY, AP) == 1


def test_sl_once_hit_down():
    """Önce SL'ye değerse DOWN (0)."""
    highs = _flat(10, ENTRY + 0.5)
    lows  = [ENTRY, SL - 0.5] + _flat(8)
    assert triple_barrier_label(ENTRY, highs, lows, ENTRY, AP) == 0


def test_earlier_barrier_wins():
    """TP 4. gün, SL 2. gün → SL önce olduğu için DOWN."""
    highs = [ENTRY, ENTRY, ENTRY, TP + 1] + _flat(6)
    lows  = [ENTRY, SL - 1] + _flat(8)
    assert triple_barrier_label(ENTRY, highs, lows, ENTRY, AP) == 0


def test_same_day_both_is_conservative_down():
    """
    Aynı gün hem TP hem SL → DOWN.
    Gün içi sıra bilinmediği için muhafazakâr taraf seçilir; bu kural
    isabet oranını YUKARI değil AŞAĞI yanlar (iyimserlik riski yok).
    """
    highs = [TP + 1] + _flat(9)
    lows  = [SL - 1] + _flat(9)
    assert triple_barrier_label(ENTRY, highs, lows, ENTRY, AP) == 0


# ── Zaman bariyeri ───────────────────────────────────────────────────────────

def test_time_barrier_up():
    """Hiçbir bariyere değmeden süre dolar, kapanış net yukarı → UP."""
    final = ENTRY * (1 + TIME_BARRIER_MIN_MOVE * 2)
    assert triple_barrier_label(ENTRY, _flat(10), _flat(10), final, AP) == 1


def test_time_barrier_down():
    final = ENTRY * (1 - TIME_BARRIER_MIN_MOVE * 2)
    assert triple_barrier_label(ENTRY, _flat(10), _flat(10), final, AP) == 0


def test_time_barrier_flat_is_neutral():
    """
    Yatay kapanış → NÖTR (-1). Bu etiket eğitimden ve isabet oranından
    ÇIKARILIR; 0 (DOWN) sayılırsa isabet yapay olarak düşerdi.
    """
    final = ENTRY * (1 + TIME_BARRIER_MIN_MOVE / 2)
    assert triple_barrier_label(ENTRY, _flat(10), _flat(10), final, AP) == -1


# ── Bozuk girdi ──────────────────────────────────────────────────────────────

@pytest.mark.parametrize("bad", [None, 0.0, -5.0, float("nan"), float("inf")])
def test_invalid_entry_is_neutral(bad):
    """Geçersiz giriş fiyatı asla 0/1 üretmez — sessizce DOWN sayılmaz."""
    assert triple_barrier_label(bad, _flat(10), _flat(10), ENTRY, AP) == -1


def test_nan_bars_are_skipped_not_counted():
    """NaN barlar atlanır; 3. günkü gerçek TP dokunuşu yakalanır."""
    nan = float("nan")
    highs = [nan, nan, TP + 1] + _flat(7)
    lows  = [nan, nan, ENTRY] + _flat(7)
    assert triple_barrier_label(ENTRY, highs, lows, ENTRY, AP) == 1


def test_invalid_final_close_is_neutral():
    assert triple_barrier_label(ENTRY, _flat(10), _flat(10), float("nan"), AP) == -1


# ── ATR sınırlama ────────────────────────────────────────────────────────────

@pytest.mark.parametrize("raw,expected", [
    (0.0,            ATR_FLOOR),
    (-0.01,          ATR_FLOOR),
    (None,           ATR_FLOOR),
    (float("nan"),   ATR_FLOOR),
    (999.0,          ATR_CAP),
    (ATR_FLOOR / 2,  ATR_FLOOR),
    (ATR_CAP * 2,    ATR_CAP),
])
def test_clamp_atr_pct(raw, expected):
    assert clamp_atr_pct(raw) == pytest.approx(expected)


def test_clamp_keeps_value_in_band():
    mid = (ATR_FLOOR + ATR_CAP) / 2
    assert clamp_atr_pct(mid) == pytest.approx(mid)


def test_atr_scales_barriers():
    """
    Bariyerler hissenin kendi oynaklığına ölçeklenir: ATR büyürse aynı
    fiyat hareketi artık TP'ye değmez.
    """
    move = ENTRY * (1 + TP_ATR_MULT * 0.02) + 0.1
    highs = [move] + _flat(9)
    assert triple_barrier_label(ENTRY, highs, _flat(10), ENTRY, 0.02) == 1
    assert triple_barrier_label(ENTRY, highs, _flat(10), ENTRY, 0.05) != 1


# ── Seri hâli ────────────────────────────────────────────────────────────────

def _df(closes, highs=None, lows=None):
    idx = pd.date_range("2026-01-01", periods=len(closes), freq="D")
    return pd.DataFrame({
        "Close": closes,
        "High":  highs if highs is not None else closes,
        "Low":   lows  if lows  is not None else closes,
    }, index=idx)


def test_compute_labels_tail_is_neutral():
    """
    Son HORIZON satır geleceği göremez → -1 kalmalı.
    Bunlar eğitime girerse GELECEĞE BAKMA (look-ahead) sızıntısı olur.
    """
    n = HORIZON + 12
    df = _df([ENTRY] * n)
    atr = pd.Series([AP] * n, index=df.index)
    labels = compute_labels(df, atr)

    assert len(labels) == n
    assert (labels.iloc[n - HORIZON:] == -1).all()
    assert labels.index.equals(df.index)


def test_compute_labels_matches_single_call():
    """Seri hâli ile tek tek çağrı AYNI sonucu vermeli (tanım tekliği)."""
    rng = np.random.default_rng(42)
    n = HORIZON + 30
    closes = ENTRY * (1 + rng.normal(0, 0.02, n).cumsum())
    highs  = closes * 1.015
    lows   = closes * 0.985
    df  = _df(list(closes), list(highs), list(lows))
    atr = pd.Series([AP] * n, index=df.index)

    labels = compute_labels(df, atr)
    for i in range(n - HORIZON):
        expected = triple_barrier_label(
            entry=closes[i],
            future_highs=highs[i + 1: i + 1 + HORIZON],
            future_lows=lows[i + 1: i + 1 + HORIZON],
            final_close=closes[i + HORIZON],
            atr_pct=AP,
        )
        assert labels.iloc[i] == expected, f"satır {i} ayrıştı"


def test_compute_labels_only_valid_values():
    rng = np.random.default_rng(7)
    n = HORIZON + 40
    closes = ENTRY * (1 + rng.normal(0, 0.015, n).cumsum())
    df  = _df(list(closes), list(closes * 1.02), list(closes * 0.98))
    atr = pd.Series([AP] * n, index=df.index)
    assert set(compute_labels(df, atr).unique()) <= {-1, 0, 1}
