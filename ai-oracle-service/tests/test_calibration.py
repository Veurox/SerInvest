"""
Kalibrasyon + EV + Kelly matematiği.

Neden burası: EV formülü "işlem yapılsın mı" kararını, Kelly ise "ne kadar
para" sorusunu belirler. İkisi de sessizce yanlış olabilir — sonuç yalnızca
haftalar sonra zararla görünür. Burada matematiksel değişmezler kilitlenir.
"""
import numpy as np
import pytest

from ml.calibration import (MIN_CALIB_SAMPLES, breakeven_p, calibrate,
                            expected_R, fit_calibrator, kelly_size)
from ml.config import MIN_CALIB_SUPPORT, MIN_CALIB_SUPPORT_DAYS
from ml.config import (KELLY_FRACTION, MIN_POSITION_PCT, SL_ATR_MULT,
                       TP_ATR_MULT, TRANSACTION_COST_PCT)


# ── Beklenen değer ───────────────────────────────────────────────────────────

def test_expected_R_monotonic_in_p():
    """Kazanma olasılığı arttıkça EV azalamaz."""
    vals = [expected_R(p) for p in np.linspace(0.0, 1.0, 21)]
    assert all(b >= a for a, b in zip(vals, vals[1:]))


def test_expected_R_endpoints():
    """p=1 → tam TP eksi maliyet; p=0 → tam SL zararı eksi maliyet."""
    cost = TRANSACTION_COST_PCT / 0.02
    assert expected_R(1.0) == pytest.approx(TP_ATR_MULT - cost)
    assert expected_R(0.0) == pytest.approx(-SL_ATR_MULT - cost)


def test_breakeven_is_where_EV_is_zero():
    """breakeven_p tanımı EV=0 noktasıyla TUTARLI olmalı (iki formül, tek gerçek)."""
    assert expected_R(breakeven_p()) == pytest.approx(0.0, abs=1e-9)


def test_breakeven_below_half_thanks_to_asymmetry():
    """
    TP(3×) > SL(2×) olduğu için başabaş olasılığı %50'nin ALTINDA.
    Bu, "isabet %50'nin altında ama sistem kârlı" durumunun matematiği.
    """
    assert 0.0 < breakeven_p() < 0.5


def test_cost_raises_breakeven():
    """Maliyet arttıkça başabaş eşiği yükselir."""
    assert breakeven_p(0.004) > breakeven_p(0.0)


def test_zero_cost_breakeven_is_pure_ratio():
    assert breakeven_p(0.0) == pytest.approx(SL_ATR_MULT / (TP_ATR_MULT + SL_ATR_MULT))


# ── Kelly boyutlandırma ──────────────────────────────────────────────────────

def test_kelly_zero_below_breakeven():
    """Kenar yoksa pozisyon YOK — negatif EV'de para riske edilmez."""
    for p in (0.0, 0.10, 0.25, breakeven_p() - 0.01):
        assert kelly_size(p, max_pct=0.20) == 0.0


def test_kelly_positive_above_breakeven():
    assert kelly_size(0.80, max_pct=0.50) > 0


def test_kelly_respects_max_pct():
    """Tavan her zaman bağlayıcı — Kelly tek başına portföyü ele geçiremez."""
    assert kelly_size(0.99, max_pct=0.05) <= 0.05


def test_kelly_monotonic_in_p():
    sizes = [kelly_size(p, max_pct=1.0) for p in np.linspace(0.3, 0.95, 14)]
    assert all(b >= a for a, b in zip(sizes, sizes[1:]))


def test_kelly_is_fractional_not_full():
    """
    Tam Kelly iflas riski taşır; sistem KELLY_FRACTION (¼) kullanır.
    Bu testin kırılması "kaldıraç sessizce 4'e katlandı" demektir.
    """
    p, b = 0.90, TP_ATR_MULT / SL_ATR_MULT
    full = p - (1 - p) / b
    assert kelly_size(p, max_pct=1.0) == pytest.approx(KELLY_FRACTION * full, abs=1e-4)


def test_kelly_drops_dust_positions():
    """MIN_POSITION_PCT altındaki boyut 0'a yuvarlanır — anlamsız işlem açılmaz."""
    p = breakeven_p() + 1e-4
    size = kelly_size(p, max_pct=1.0)
    assert size == 0.0 or size >= MIN_POSITION_PCT


# ── Kalibratör yaşam döngüsü ─────────────────────────────────────────────────

def test_calibrate_identity_without_calibrator():
    """Kalibratör yoksa sistem ÇALIŞMAYA DEVAM eder (kimlik fallback)."""
    for p in (0.0, 0.37, 0.5, 1.0):
        assert calibrate(p, None) == pytest.approx(p)


def test_calibrate_survives_broken_calibrator():
    """Bozuk kalibratör tahmini çökertmez — ham p'ye düşer."""
    class Boom:
        def predict(self, _):
            raise RuntimeError("bozuk")
    assert calibrate(0.42, Boom()) == pytest.approx(0.42)


def test_fit_refuses_small_sample():
    """Az örnekle fit YASAK — az veriye uydurulmuş eğri güveni yalanlar."""
    n = MIN_CALIB_SAMPLES - 1
    rng = np.random.default_rng(0)
    p = rng.uniform(0, 1, n)
    assert fit_calibrator(p, (p > 0.5).astype(int)) is None


def test_fit_refuses_single_class():
    """Tek sınıflı etikette fit anlamsız — None dönmeli."""
    n = MIN_CALIB_SAMPLES + 100
    rng = np.random.default_rng(1)
    p = rng.uniform(0, 1, n)
    assert fit_calibrator(p, np.ones(n, dtype=int)) is None


def test_fitted_calibrator_is_monotonic_and_bounded():
    """
    Isotonic çıktısı artan ve [0.01, 0.99] arasında olmalı.
    (selftest I6 aynı değişmezi CANLI kalibratörde kontrol eder.)
    """
    rng = np.random.default_rng(3)
    n = MIN_CALIB_SAMPLES * 3
    p = rng.uniform(0.2, 0.8, n)
    y = (rng.uniform(0, 1, n) < p).astype(int)

    cal = fit_calibrator(p, y)
    assert cal is not None

    grid = np.linspace(0.0, 1.0, 60)
    out = [calibrate(float(x), cal) for x in grid]
    assert all(b >= a - 1e-9 for a, b in zip(out, out[1:])), "monoton değil"
    assert all(0.01 - 1e-9 <= v <= 0.99 + 1e-9 for v in out), "sınır dışı"


def test_calibrator_clips_out_of_range_input():
    """Eğitim aralığı dışındaki p çökertmez (out_of_bounds='clip')."""
    rng = np.random.default_rng(5)
    n = MIN_CALIB_SAMPLES * 2
    p = rng.uniform(0.3, 0.6, n)
    cal = fit_calibrator(p, (rng.uniform(0, 1, n) < p).astype(int))
    assert cal is not None
    for x in (-1.0, 0.0, 1.0, 2.0):
        assert 0.0 <= calibrate(x, cal) <= 1.0


# ── Desteklenmeyen üst kuyruğun kırpılması (08/2026 bulgusu) ─────────────────
# 17.08 tazelemesinde eğri 0.345-0.725 arası düzken (0.5251) ham p ≥ 0.90'da
# 0.99'a fırlamıştı; üst kutunun gözlenen oranı ise %57,2 idi. Canlıda 350
# tahminin 52'si Kelly'nin %10 tavanına çıkmıştı. Bu testler kırpmanın hem
# çalıştığını hem de DÜRÜST kısmı bozmadığını çivi ler.

def _tail_data(n_body=6000, n_tail=30, seed=0):
    """Gövdesi bilgisiz (p≈0.5), kuyruğu az örnekli ve TAMAMI UP olan veri.
    Isotonic bu kuyruğu ezberleyip 0.99'a fırlar — gerçek hayattaki desen."""
    rng = np.random.default_rng(seed)
    p_body = rng.uniform(0.30, 0.70, n_body)
    y_body = rng.integers(0, 2, n_body)              # tamamen gürültü
    p_tail = rng.uniform(0.95, 0.99, n_tail)
    y_tail = np.ones(n_tail, dtype=int)              # hepsi UP (şans eseri)
    return np.concatenate([p_body, p_tail]), np.concatenate([y_body, y_tail])


def test_unsupported_tail_is_capped():
    """Az örnekli kuyruk 0.99 iddia edemez."""
    p, y = _tail_data()
    cal = fit_calibrator(p, y)
    assert cal is not None
    assert cal.si_support_cap is not None
    ham_tail = float(cal.predict([0.98])[0])
    kirpilmis = calibrate(0.98, cal)
    assert ham_tail > 0.9                    # isotonic gerçekten ezberledi
    assert kirpilmis <= cal.si_support_cap   # ama dışarı sızmadı
    assert kirpilmis < ham_tail


def test_cap_does_not_touch_supported_body():
    """DÜRÜST kısım (bol örnekli düz bölge) aynen kalmalı."""
    p, y = _tail_data()
    cal = fit_calibrator(p, y)
    for x in (0.35, 0.45, 0.55, 0.65):
        assert calibrate(x, cal) == pytest.approx(float(cal.predict([x])[0]), abs=1e-9)


def test_cap_level_is_actually_supported():
    """Tavan, en az MIN_CALIB_SUPPORT örnekle desteklenen bir seviye olmalı."""
    p, y = _tail_data()
    cal = fit_calibrator(p, y)
    pred = np.round(cal.predict(p), 6)
    n_at_cap = int((pred == round(float(cal.si_support_cap), 6)).sum())
    assert n_at_cap >= MIN_CALIB_SUPPORT


def test_cap_keeps_calibration_monotonic():
    """Kırpma monotonluğu bozmamalı — min() ile tavanlamak monotondur."""
    p, y = _tail_data()
    cal = fit_calibrator(p, y)
    grid = np.linspace(0, 1, 80)
    out = [calibrate(float(x), cal) for x in grid]
    assert all(b >= a - 1e-12 for a, b in zip(out, out[1:]))


def test_no_cap_when_everything_supported():
    """Her seviye bol örnekliyse kırpma DEĞER DEĞİŞTİRMEMELİ (yanlış müdahale yok)."""
    rng = np.random.default_rng(3)
    n = MIN_CALIB_SUPPORT * 40
    p = rng.uniform(0.2, 0.8, n)
    y = (rng.uniform(0, 1, n) < p).astype(int)       # gerçek sinyal var
    cal = fit_calibrator(p, y)
    for x in (0.25, 0.5, 0.75):
        assert calibrate(x, cal) == pytest.approx(float(cal.predict([x])[0]), abs=1e-9)


def test_legacy_calibrator_without_cap_still_works():
    """Diskten yüklenen ESKİ kalibratörde tavan yoksa davranış değişmez."""
    p, y = _tail_data()
    cal = fit_calibrator(p, y)
    del cal.si_support_cap                            # eski artefakt taklidi
    assert calibrate(0.98, cal) == pytest.approx(float(cal.predict([0.98])[0]), abs=1e-9)


def test_cap_shrinks_kelly_position():
    """Asıl amaç: kanıtsız güvenle TAVAN pozisyon açılmasın."""
    p, y = _tail_data()
    cal = fit_calibrator(p, y)
    ham = float(cal.predict([0.98])[0])
    assert kelly_size(ham, 0.10) == pytest.approx(0.10)          # kırpmasız: tavan
    assert kelly_size(calibrate(0.98, cal), 0.10) < 0.10         # kırpmalı: daha küçük


def test_row_support_alone_is_not_enough_days_gate():
    """
    SATIR SAYISI YANILTICIDIR: 400 satır TEK güne yayılıysa bağımsız gözlem
    sayısı 1'dir. PSI (600 satır / 8 gün) ve kalibrasyon raporu (401 satır /
    10 gün) hatalarının aynısı. Gün kapısı bunu keser.
    """
    rng = np.random.default_rng(7)
    n_body, n_tail = 6000, 400
    p_body = rng.uniform(0.30, 0.70, n_body)
    y_body = rng.integers(0, 2, n_body)
    p_tail = rng.uniform(0.95, 0.99, n_tail)
    y_tail = np.ones(n_tail, dtype=int)
    P = np.concatenate([p_body, p_tail])
    Y = np.concatenate([y_body, y_tail])

    # Gövde bol güne yayılı; KUYRUK tek güne sıkışık (satır bol, gün 1)
    d_body = np.array([f"2026-{1 + i % 6:02d}-{1 + i % 28:02d}" for i in range(n_body)])
    d_tail = np.full(n_tail, "2026-07-15")
    D = np.concatenate([d_body, d_tail])

    cal_gunsuz = fit_calibrator(P, Y)          # yalnız satır kapısı
    cal_gunlu  = fit_calibrator(P, Y, D)       # satır + gün kapısı

    # Kuyruk 400 satırla satır kapısını geçerdi; gün kapısı geçirmemeli.
    assert cal_gunlu.si_support_cap < cal_gunsuz.si_support_cap
    assert calibrate(0.98, cal_gunlu) < calibrate(0.98, cal_gunsuz)


def test_day_gate_threshold_is_guarded():
    """Eşik sessizce düşürülürse havuzlanmış-anlamlılık hatası geri döner."""
    assert MIN_CALIB_SUPPORT_DAYS >= 10
    assert MIN_CALIB_SUPPORT >= 200
