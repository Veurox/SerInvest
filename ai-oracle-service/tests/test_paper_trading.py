"""
Kâğıt işlem (paper trading) — idempotans, bariyer taraması, seans saatleri.

Neden burası: 07/2026'da BIMAS ve EREGL aynı işlemi CSV'ye İKİ KEZ yazdı
(CSV anında, state döngü sonunda kaydediliyordu; arada restart olunca pozisyon
tekrar kapandı). Getiri istatistikleri sessizce şişmişti.
"""
import datetime

import pytest

import paper_trading as pt


# ── İdempotans: aynı işlem iki kez sayılamaz ─────────────────────────────────

def test_trade_key_identifies_same_trade():
    a = {"entry_date": "2026-07-01T10:00:00", "symbol": "BIMAS", "exit_date": "2026-07-11T18:00:00"}
    b = dict(a, symbol="bimas")                       # büyük/küçük harf önemsiz
    c = dict(a, exit_date="2026-07-11T18:00:00.123")  # mikrosaniye kırpılır
    assert pt._trade_key(a) == pt._trade_key(b) == pt._trade_key(c)


def test_trade_key_distinguishes_different_trades():
    base = {"entry_date": "2026-07-01T10:00:00", "symbol": "BIMAS", "exit_date": "2026-07-11T18:00:00"}
    assert pt._trade_key(base) != pt._trade_key(dict(base, symbol="EREGL"))
    assert pt._trade_key(base) != pt._trade_key(dict(base, exit_date="2026-07-12T18:00:00"))
    assert pt._trade_key(base) != pt._trade_key(dict(base, entry_date="2026-07-02T10:00:00"))


def test_trade_key_survives_missing_fields():
    """Eksik alanlı satır çökertmemeli (bozuk CSV satırı okunabilir)."""
    assert pt._trade_key({}) == ("", "", "")


def test_append_trade_is_idempotent(tmp_path, monkeypatch):
    """Aynı işlem iki kez yazılmaya çalışılırsa CSV'de TEK satır kalmalı."""
    f = tmp_path / "paper_trades.csv"
    monkeypatch.setattr(pt, "TRADES_FILE", f)

    trade = {"entry_date": "2026-07-01T10:00:00", "exit_date": "2026-07-11T18:00:00",
             "symbol": "BIMAS", "shares": 10, "entry_price": 100.0, "exit_price": 106.0,
             "gross_pnl": 60.0, "costs": 2.0, "net_pnl": 58.0, "pnl_pct": 5.8,
             "exit_reason": "TP", "hold_days": 10.3, "entry_conf": 0.53}

    pt._append_trade(trade)
    pt._append_trade(dict(trade))          # restart sonrası ikinci deneme
    pt._append_trade(dict(trade, symbol="bimas"))

    body = f.read_text(encoding="utf-8")
    assert body.count("BIMAS") + body.count("bimas") == 1


def test_append_trade_allows_genuinely_different_trades(tmp_path, monkeypatch):
    f = tmp_path / "paper_trades.csv"
    monkeypatch.setattr(pt, "TRADES_FILE", f)
    base = {"entry_date": "2026-07-01T10:00:00", "exit_date": "2026-07-11T18:00:00",
            "symbol": "BIMAS", "exit_reason": "TP"}
    pt._append_trade(base)
    pt._append_trade(dict(base, symbol="EREGL"))
    assert f.read_text(encoding="utf-8").count("\n") >= 3   # başlık + 2 satır


# ── Bariyer taraması (bilgisayar kapalıyken kaçırılan çıkışlar) ──────────────

POS = {"target": 110.0, "stop": 95.0, "entry_date": "2026-07-01", "last_check": None}


def _bar(d, hi, lo, c=100.0):
    return {"date": d, "high": hi, "low": lo, "close": c}


def test_scan_finds_tp_hit():
    bars = [_bar("2026-07-02", 105, 99), _bar("2026-07-03", 112, 104)]
    assert pt._scan_barrier_exit(dict(POS), bars) == (110.0, "TP", "2026-07-03")


def test_scan_finds_sl_hit():
    bars = [_bar("2026-07-02", 105, 99), _bar("2026-07-03", 101, 94)]
    assert pt._scan_barrier_exit(dict(POS), bars) == (95.0, "SL", "2026-07-03")


def test_scan_returns_earliest_hit():
    """İlk vuruş kazanır — sonraki günlerdeki hareket sonucu değiştirmez."""
    bars = [_bar("2026-07-02", 112, 99), _bar("2026-07-03", 120, 90)]
    assert pt._scan_barrier_exit(dict(POS), bars)[2] == "2026-07-02"


def test_scan_same_day_both_is_conservative_sl():
    """
    Aynı gün TP ve SL → SL. Günlük bardan sıra bilinemez; muhafazakâr taraf
    seçilir. Ters çevrilirse paper getiri sistematik olarak ŞİŞER.
    (ml/labels.py aynı kuralı etiketlemede uygular — tanım tekliği.)
    """
    bars = [_bar("2026-07-02", 115, 90)]
    assert pt._scan_barrier_exit(dict(POS), bars) == (95.0, "SL", "2026-07-02")


def test_scan_ignores_entry_day():
    """Giriş günü gün-içi hareketi sayılmaz — pozisyon o gün açıldı."""
    bars = [_bar("2026-07-01", 115, 90)]
    assert pt._scan_barrier_exit(dict(POS), bars) is None


def test_scan_ignores_already_checked_days():
    """last_check'e kadar taranan günler tekrar sayılmaz (çift çıkış olmaz)."""
    pos = dict(POS, last_check="2026-07-05T18:00:00")
    bars = [_bar("2026-07-03", 115, 90), _bar("2026-07-06", 101, 99)]
    assert pt._scan_barrier_exit(pos, bars) is None


def test_scan_none_when_no_barrier_touched():
    bars = [_bar("2026-07-02", 105, 99), _bar("2026-07-03", 106, 98)]
    assert pt._scan_barrier_exit(dict(POS), bars) is None


def test_scan_handles_missing_barriers():
    """target/stop yoksa çökmemeli."""
    assert pt._scan_barrier_exit({"entry_date": "2026-07-01"}, [_bar("2026-07-02", 999, 1)]) is None


# ── Seans saatleri ───────────────────────────────────────────────────────────

def test_market_closed_on_weekend():
    sat = datetime.datetime(2026, 8, 8, 12, 0)   # Cumartesi
    sun = datetime.datetime(2026, 8, 9, 12, 0)   # Pazar
    assert pt.market_closed_reason(sat) == "Hafta sonu"
    assert pt.market_closed_reason(sun) == "Hafta sonu"
    assert not pt.is_market_open(sat)


def test_market_open_midsession_weekday():
    wed = datetime.datetime(2026, 8, 5, 12, 0)   # Çarşamba öğlen
    if wed.date().isoformat() in pt.BIST_HOLIDAYS:
        pytest.skip("o gün resmi tatil")
    assert pt.market_closed_reason(wed) is None
    assert pt.is_market_open(wed)


def test_market_closed_outside_session_hours():
    early = datetime.datetime(2026, 8, 5, 7, 0)
    late  = datetime.datetime(2026, 8, 5, 22, 0)
    assert pt.market_closed_reason(early) == "Seans dışı"
    assert pt.market_closed_reason(late) == "Seans dışı"


def test_holiday_is_reported_with_name():
    if not pt.BIST_HOLIDAYS:
        pytest.skip("tatil listesi boş")
    iso = sorted(pt.BIST_HOLIDAYS)[0]
    d = datetime.date.fromisoformat(iso)
    reason = pt.market_closed_reason(datetime.datetime(d.year, d.month, d.day, 12, 0))
    assert reason is not None and reason.startswith("Tatil:")


# ── Tutma süresi ─────────────────────────────────────────────────────────────

def test_hold_days_basic():
    assert pt._hold_days("2026-07-01T10:00:00", "2026-07-11T10:00:00") == pytest.approx(10.0)


def test_hold_days_never_negative_on_garbage():
    """Bozuk tarih çökertmemeli — 0 dönmeli."""
    assert pt._hold_days("bozuk-tarih", "2026-07-11T10:00:00") == 0.0
    assert pt._hold_days("", None) == 0.0
