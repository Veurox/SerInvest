"""
Risk filtresi — kural kilidi.

Kural docs/PLAN_2026-08.md §A0'da ÖNCEDEN yazıldı ve sonradan ayarlanmayacak.
Bu testler kuralın sessizce değişmesini engeller: geçmişte tekrarlayan hata,
sonucu gördükten sonra başarı tanımını (ve eşikleri) değiştirmekti.
"""
import pytest

from ml import risk_filter as rf
from ml.config import (COVERAGE_TARGET, RISK_FILTER_MIN_SYMBOLS,
                       RISK_FILTER_TOP_PCT)


def make(n: int, **over) -> dict[str, dict]:
    """n sembollük evren; atr_pct artan, price_vs_52w_high azalan."""
    feats = {
        f"S{i:02d}": {"atr_pct": 0.01 + i * 0.001,
                      "price_vs_52w_high": 1.0 - i * 0.01}
        for i in range(n)
    }
    feats.update(over)
    return feats


# ── Kuralın kendisi ──────────────────────────────────────────────────────────

def test_low_vol_and_near_high_wins():
    """
    S00 hem en düşük oynaklıklı hem zirveye en yakın → skorda birinci olmalı.
    Bu, ml/experiment_lowvol.py'de ölçülen yönün ta kendisi.
    """
    feats = make(50)
    s = rf.score(feats)
    assert max(s, key=s.get) == "S00"
    assert min(s, key=s.get) == "S49"


def test_selection_size_matches_top_pct():
    feats = make(50)
    sel = rf.select(feats)
    assert sel is not None
    assert len(sel) == round(50 * RISK_FILTER_TOP_PCT)


def test_selected_are_the_best_scored():
    feats = make(50)
    sel = rf.select(feats)
    s = rf.score(feats)
    en_dusuk_secilen = min(s[x] for x in sel)
    en_yuksek_elenen = max(s[x] for x in s if x not in sel)
    assert en_dusuk_secilen > en_yuksek_elenen


def test_high_volatility_is_excluded():
    """Ölçümde en kötü grup buydu (Sharpe 0.58) — kesinlikle elenmeli."""
    feats = make(50)
    feats["RISKLI"] = {"atr_pct": 0.90, "price_vs_52w_high": 0.50}
    sel = rf.select(feats)
    assert "RISKLI" not in sel


def test_far_from_52w_high_is_excluded():
    """Diğer kötü grup (Sharpe 0.51)."""
    feats = make(50)
    feats["DIPTE"] = {"atr_pct": 0.02, "price_vs_52w_high": 0.05}
    sel = rf.select(feats)
    assert "DIPTE" not in sel


def test_coverage_lands_in_target_band():
    """
    Kapsam hedefi %20–40. Filtrenin ürettiği oran bu bandın İÇİNDE olmalı;
    aksi hâlde model doğrulanmadığı bir rejimde çalışmaya devam eder (I5/I11).
    """
    lo, hi = COVERAGE_TARGET
    for n in (20, 33, 50, 97):
        sel = rf.select(make(n))
        assert sel is not None
        assert lo <= len(sel) / n <= hi, f"n={n} kapsam bandı dışında"


# ── Eksik ve bozuk veri ──────────────────────────────────────────────────────

def test_symbol_missing_a_criterion_is_not_selected():
    """
    Eksik veriyi ortalamayla doldurmak, veri gelmeyen sembolü sessizce
    "ortalama riskli" saymaktır. Skorlanamayan sembol geçemez.
    """
    feats = make(50)
    feats["EKSIK"] = {"atr_pct": 0.001}          # price_vs_52w_high yok
    assert "EKSIK" not in rf.score(feats)
    assert "EKSIK" not in rf.select(feats)


@pytest.mark.parametrize("bad", [None, float("nan"), float("inf"), "abc", ""])
def test_broken_values_are_dropped_not_crash(bad):
    feats = make(50)
    feats["BOZUK"] = {"atr_pct": bad, "price_vs_52w_high": bad}
    sel = rf.select(feats)
    assert sel is not None and "BOZUK" not in sel


def test_small_universe_returns_none_not_empty():
    """
    None = "ölçemedim, karışma"; boş küme = "ölçtüm, hiçbiri geçmedi".
    İkisini karıştırmak veri kesintisinde TÜM sinyalleri susturur.
    """
    assert rf.select(make(RISK_FILTER_MIN_SYMBOLS - 1)) is None
    assert rf.select({}) is None


def test_universe_at_threshold_is_filtered():
    assert rf.select(make(RISK_FILTER_MIN_SYMBOLS)) is not None


def test_mostly_broken_universe_returns_none():
    """Çoğu sembolün verisi bozuksa kesitsel sıralama güvenilmez → filtre yok."""
    feats = {f"B{i}": {"atr_pct": None, "price_vs_52w_high": None} for i in range(40)}
    feats.update(make(5))
    assert rf.select(feats) is None


# ── Sıralama ayrıntıları ─────────────────────────────────────────────────────

def test_ties_get_average_rank():
    """
    Beraberlikte ortalama sıra verilmezse aynı değerli semboller sözlük
    sırasına göre keyfi biçimde ayrılırdı — sıralama veriden değil isimden
    etkilenirdi.
    """
    feats = {f"T{i}": {"atr_pct": 0.02, "price_vs_52w_high": 0.5} for i in range(30)}
    s = rf.score(feats)
    assert len(set(round(v, 9) for v in s.values())) == 1


def test_deterministic():
    """Aynı girdi → aynı çıktı. Rastgelelik tutarsızlık kaynağıdır."""
    feats = make(50)
    assert rf.select(feats) == rf.select(feats)


def test_score_is_order_independent():
    """Sembollerin sözlükteki sırası sonucu değiştirmemeli."""
    feats = make(40)
    reversed_feats = dict(reversed(list(feats.items())))
    assert rf.select(feats) == rf.select(reversed_feats)


# ── Şeffaflık ────────────────────────────────────────────────────────────────

def test_explain_reports_rank_and_verdict():
    feats = make(50)
    e = rf.explain(feats, "S00")
    assert e["scored"] and e["passed"] and e["rank"] == 1 and e["of"] == 50


def test_explain_handles_missing_data():
    feats = make(50)
    feats["EKSIK"] = {}
    e = rf.explain(feats, "EKSIK")
    assert e["scored"] is False and "veri eksik" in e["reason"]
