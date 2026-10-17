"""
Tahmin olgunluğu — TEK KAYNAK (evaluate_ml + admin takvimi + UI aynı sayıyı görmeli).

Neden burası: olgunluk saat bazlı hesaplanıyordu. Akşam 22:08'de yazılan bir
tahmin, 20 gün sonra saat 22:08'e kadar "olgunlaşmadı" sayılıyordu — takvimde
bir gün fazladan bekleme görünüyordu. Kural takvim GÜNÜ üzerinden olmalı.
"""
import datetime

import pytest

from ml.config import EVAL_MIN_AGE_DAYS
import ml_live
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


# ── Tahmin logu şema bütünlüğü (04.09.2026 bulgusu) ─────────────────────────

def test_log_row_builder_covers_every_schema_field():
    """
    _log_prediction_locked satırı anahtar anahtar ELLE kuruyor. Şemaya
    (_LOG_FIELDS) yeni bir kolon eklenip buraya kopyalanmazsa DictWriter onu
    sessizce BOŞ yazar — kolon başlıkta görünür ama hep boştur.

    04.09.2026'da tam bu oldu: `rec_dir_nofilter` 9 gün boyunca boş yazıldı ve
    I11'in "kapsam düşüşünün sebebi filtre mi" atfı hiç çalışmadı. Hata sessizdi
    çünkü I11 bunu "yeni kolon dolmaya başladı" diye geçici bir hâl sanıyordu.

    Bu test, satır kurucusunun şemadaki HER alanı ürettiğini garanti eder.
    """
    import ml_live
    from ml_live import _LOG_FIELDS

    yazilan = {}
    orijinal = ml_live.atomic.write_csv
    try:
        def yakala(path, fieldnames, rows, **kw):
            yazilan["fields"] = list(fieldnames)
            yazilan["row"] = dict(rows[-1])
        ml_live.atomic.write_csv = yakala

        gercek_log = ml_live.PREDICTION_LOG
        ml_live.PREDICTION_LOG = gercek_log.parent / "__yok_test__.csv"
        try:
            ml_live._log_prediction_locked({
                "symbol": "TEST", "yf_sym": "TEST.IS", "p_up": 0.61,
                "p_cal": 0.52, "ev": 0.4, "rec": "NÖTR", "rec_dir": "NEUTRAL",
                "rec_dir_nofilter": "BUY",          # filtre öncesi karar
                "close": 10.0, "target": 11.0, "stop": 9.0, "atr_pct": 0.02,
            })
        finally:
            ml_live.PREDICTION_LOG = gercek_log
    finally:
        ml_live.atomic.write_csv = orijinal

    satir = yazilan["row"]
    eksik = [f for f in _LOG_FIELDS if f not in satir]
    assert not eksik, f"şemada olup satırda ÜRETİLMEYEN alan(lar): {eksik}"
    # Ve değer gerçekten taşınmalı — boş yazılmamalı
    assert satir["rec_dir_nofilter"] == "BUY"


# ── Değerlendirme giriş günü ve canlı geçmiş (18.10.2026 denetimi) ───────────

def test_giris_gunu_bar_gunu_esas():
    """Sabah 09:00 (06:00 UTC) analizi DÜNKÜ bardan üretilir; değerlendirme de
    o bardan başlamalı — kayıt damgasından değil."""
    ts = datetime.datetime(2026, 10, 20, 6, 0)
    assert ml_live.giris_gunu({"bar_gunu": "2026-10-19"}, ts) == datetime.date(2026, 10, 19)


def test_giris_gunu_eski_satir_damgaya_duser():
    ts = datetime.datetime(2026, 9, 10, 15, 30)
    assert ml_live.giris_gunu({"bar_gunu": ""}, ts) == datetime.date(2026, 9, 10)
    assert ml_live.giris_gunu({}, ts) == datetime.date(2026, 9, 10)


def test_canli_ozellik_gecmisi_egitimle_ayni():
    """1y (252 bar) indirmede EMA200'ün başlangıç ağırlığı ~%8 kalıyordu;
    16.10'da 50 hissenin 4'ünde above_ema200 ters çıktı. Canlı geçmiş
    eğitimle aynı olmalı ve başlangıç ağırlığı ihmal edilebilir kalmalı."""
    from ml.config import HISTORY_PERIOD
    assert ml_live.LIVE_HISTORY_PERIOD == HISTORY_PERIOD
    yil = int(HISTORY_PERIOD.rstrip("y"))
    bar = 245 * yil                       # BIST ~245 işlem günü/yıl, alt sınır
    assert (1 - 2 / 201) ** bar < 0.001
