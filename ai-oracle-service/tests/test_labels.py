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


# ── Değerlendirme penceresi = etiketleme penceresi (09/2026 kod incelemesi) ──
# evaluate_ml, giriş fiyatını LOGDAN alıp bariyerleri BUGÜN indirilen düzeltilmiş
# barlardan okuyordu. Araya temettü/bedelsiz girince iki taraf farklı düzeltme
# tabanında kalıyor ve SAHTE SL tetikleniyordu. Düzeltmeden sonra giriş de aynı
# indirmeden geliyor. Bu testler, canlı değerlendirmenin eğitimdeki etiketleme
# ile AYNI pencereyi kullandığını çivi ler — iki tanım ayrışırsa model kendi
# ürettiği etiketten farklı bir gerçeğe göre yargılanır.

def _seri(kapanislar, yuksekler=None, alcaklar=None):
    import pandas as pd
    n = len(kapanislar)
    return pd.DataFrame({
        "Close": kapanislar,
        "High":  yuksekler if yuksekler else kapanislar,
        "Low":   alcaklar  if alcaklar  else kapanislar,
    }, index=pd.date_range("2026-01-01", periods=n, freq="D"))


def test_eval_penceresi_etiketleme_ile_ayni():
    """
    Aynı fiyat serisi üzerinde:
      • compute_labels'in i=0 için verdiği etiket
      • evaluate_ml'in dilimlemesiyle (i0=0) triple_barrier_label
    AYNI olmalı. Ayrışırsa canlı isabet, eğitimdeki etiketten başka bir şeyi ölçer.
    """
    import numpy as np
    import pandas as pd
    from ml.config import HORIZON
    from ml.labels import compute_labels, triple_barrier_label

    # 12 barlık seri: 3. günde belirgin yukarı hareket
    kapanis = [100.0] * (HORIZON + 2)
    yuksek  = list(kapanis); alcak = list(kapanis)
    yuksek[3] = 130.0                      # TP'yi rahatça geçer
    df = _seri(kapanis, yuksek, alcak)
    atr = pd.Series(0.02, index=df.index)

    beklenen = compute_labels(df, atr, horizon=HORIZON).iloc[0]

    # evaluate_ml'in yaptigi dilimleme (i0 = 0)
    h = np.asarray(df["High"], dtype=float)
    l = np.asarray(df["Low"], dtype=float)
    c = np.asarray(df["Close"], dtype=float)
    i0 = 0
    alinan = triple_barrier_label(
        entry        = float(c[i0]),
        future_highs = h[i0 + 1 : i0 + 1 + HORIZON],
        future_lows  = l[i0 + 1 : i0 + 1 + HORIZON],
        final_close  = float(c[i0 + HORIZON]),
        atr_pct      = 0.02,
    )
    assert alinan == beklenen == 1


def test_giris_gunu_hareketi_sayilmaz():
    """Giriş gününün kendi gün-içi hareketi bariyeri TETİKLEMEMELİ —
    pozisyon o gün kapanışta açılır. Pencere i+1'den başlar."""
    import numpy as np
    from ml.config import HORIZON
    from ml.labels import triple_barrier_label

    c = [100.0] * (HORIZON + 1)
    h = list(c); l = list(c)
    h[0] = 200.0        # giriş gününde devasa yükseliş — SAYILMAMALI
    l[0] = 50.0         # ve devasa düşüş — SAYILMAMALI
    lab = triple_barrier_label(
        entry=100.0,
        future_highs=np.asarray(h[1:1 + HORIZON], dtype=float),
        future_lows=np.asarray(l[1:1 + HORIZON], dtype=float),
        final_close=100.0, atr_pct=0.02,
    )
    assert lab == -1     # hiçbir bariyer değmedi, yatay → NÖTR


def test_duzeltme_tabani_tekligi_sahte_sl_uretmez():
    """
    KÖK SORUNUN kendisi: giriş ESKİ tabanda, barlar YENİ tabanda olursa
    (temettü sonrası geriye dönük düzeltme) sahte SL çıkar. Aynı tabanda
    okununca çıkmaz.
    """
    import numpy as np
    from ml.config import HORIZON
    from ml.labels import triple_barrier_label

    # Gerçekte fiyat yatay; ama %5 temettü sonrası tüm barlar 95'e çekilmiş.
    barlar = np.asarray([95.0] * HORIZON, dtype=float)

    # YANLIŞ: giriş log'dan (100, eski taban), barlar yeni taban
    yanlis = triple_barrier_label(entry=100.0, future_highs=barlar,
                                  future_lows=barlar, final_close=95.0, atr_pct=0.02)
    # DOĞRU: giriş de aynı indirmeden (95)
    dogru = triple_barrier_label(entry=95.0, future_highs=barlar,
                                 future_lows=barlar, final_close=95.0, atr_pct=0.02)

    assert yanlis == 0     # sahte SL / aşağı etiket
    assert dogru == -1     # gerçek: yatay → NÖTR
    assert yanlis != dogru
