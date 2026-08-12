"""
Tahmin olgunluğu — TEK KAYNAK (evaluate_ml + admin takvimi + UI aynı sayıyı görmeli).

Neden burası: olgunluk saat bazlı hesaplanıyordu. Akşam 22:08'de yazılan bir
tahmin, 20 gün sonra saat 22:08'e kadar "olgunlaşmadı" sayılıyordu — takvimde
bir gün fazladan bekleme görünüyordu. Kural takvim GÜNÜ üzerinden olmalı.
"""
import datetime

import pytest

from ml.config import EVAL_MIN_AGE_DAYS
from ml_live import maturity

TS = datetime.datetime(2026, 7, 8, 22, 8, 26)   # geç akşam yazılmış tahmin


def _at(days, hour=0, minute=0):
    return datetime.datetime.combine(
        TS.date() + datetime.timedelta(days=days),
        datetime.time(hour, minute))


# ── Takvim günü bazı (saat bazı DEĞİL) ───────────────────────────────────────

def test_age_is_calendar_days_not_hours():
    """Ertesi gün sabah 00:05 → yaş 1 (saat bazlı olsaydı 0 olurdu)."""
    assert maturity(TS, _at(1, 0, 5))["age_days"] == 1


def test_matures_at_midnight_not_at_write_hour():
    """
    Asıl hata buydu: 20. günün SABAHI olgun sayılmalı, akşam 22:08'i
    beklememeli. Ters çevrilirse UI'da anlamsız bir gün fazladan bekleme çıkar.
    """
    assert maturity(TS, _at(EVAL_MIN_AGE_DAYS, 0, 1))["matured"] is True


def test_not_matured_one_day_early():
    m = maturity(TS, _at(EVAL_MIN_AGE_DAYS - 1, 23, 59))
    assert m["matured"] is False and m["days_left"] == 1


def test_same_day_is_not_matured():
    m = maturity(TS, _at(0, 23, 59))
    assert m["matured"] is False and m["age_days"] == 0


# ── Yargı tarihi ve kalan gün ────────────────────────────────────────────────

def test_verdict_date_is_fixed_offset():
    m = maturity(TS, _at(0))
    assert m["verdict_date"] == TS.date() + datetime.timedelta(days=EVAL_MIN_AGE_DAYS)


def test_verdict_date_does_not_drift_with_now():
    """Yargı tarihi tahminin kendi tarihine bağlı — 'now' değişince kaymaz."""
    dates = {maturity(TS, _at(d))["verdict_date"] for d in range(0, EVAL_MIN_AGE_DAYS + 5)}
    assert len(dates) == 1


def test_days_left_counts_down_by_one():
    for d in range(0, EVAL_MIN_AGE_DAYS):
        assert maturity(TS, _at(d))["days_left"] == EVAL_MIN_AGE_DAYS - d


def test_days_left_never_negative():
    """Olgunlaşmış tahminde 'kalan gün' negatif gösterilmemeli."""
    for d in (EVAL_MIN_AGE_DAYS, EVAL_MIN_AGE_DAYS + 30):
        assert maturity(TS, _at(d))["days_left"] == 0


def test_matured_is_monotonic():
    """Bir kez olgunlaştıysa geri dönmez."""
    seen_matured = False
    for d in range(0, EVAL_MIN_AGE_DAYS + 10):
        m = maturity(TS, _at(d))["matured"]
        if seen_matured:
            assert m is True
        seen_matured = seen_matured or m


# ── Eşiğin gerekçesi ─────────────────────────────────────────────────────────

def test_eval_min_age_covers_horizon_with_slack():
    """
    10 işlem günlük pencere takvimde ~14 gün sürer; hafta sonu/tatil payıyla
    eşik bunun belirgin üstünde olmalı. Aksi hâlde henüz kapanmamış pencereler
    'sonuçlandı' diye yargılanır ve isabet oranı yalan söyler.
    """
    from ml.config import HORIZON
    assert EVAL_MIN_AGE_DAYS >= HORIZON * 1.6


# ── Eğitim verisi tavanı (08/2026: sabit vardı ama uygulanmıyordu) ───────────

def test_training_rows_capped():
    """
    MAX_TRAIN_ROWS gerçekten uygulanmalı. Denetimde bu sabit tanımlıydı ve
    yorumunda "137 OOM'a karşı" yazıyordu ama hiçbir yerde kullanılmıyordu —
    yani koruma yalnızca yorumdan ibaretti.
    """
    import pandas as pd
    from ml.config import MAX_TRAIN_ROWS
    from ml_live import _cap_training_rows

    n = MAX_TRAIN_ROWS + 500
    df = pd.DataFrame({
        "date": pd.date_range("2020-01-01", periods=n, freq="h"),
        "label": [1, 0] * (n // 2),
    })
    out = _cap_training_rows(df)
    assert len(out) == MAX_TRAIN_ROWS


def test_training_cap_keeps_newest_rows():
    """Kırpma EN ESKİ satırlardan olmalı — güncel rejim korunsun."""
    import pandas as pd
    from ml.config import MAX_TRAIN_ROWS
    from ml_live import _cap_training_rows

    n = MAX_TRAIN_ROWS + 100
    df = pd.DataFrame({
        "date": pd.date_range("2020-01-01", periods=n, freq="h"),
        "label": [1] * n,
    })
    out = _cap_training_rows(df.sample(frac=1, random_state=0))   # sırası bozuk gelse de
    assert out["date"].max() == df["date"].max()
    assert out["date"].min() > df["date"].min()


def test_training_cap_is_noop_when_small():
    """Tavanın altındaysa veri DOKUNULMADAN geçmeli."""
    import pandas as pd
    from ml_live import _cap_training_rows

    df = pd.DataFrame({"date": pd.date_range("2026-01-01", periods=50), "label": [1] * 50})
    assert len(_cap_training_rows(df)) == 50
