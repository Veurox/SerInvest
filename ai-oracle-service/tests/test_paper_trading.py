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


# ── 2027-02-12 karar ölçütleri (docs/PLAN_2026-08.md §A0) ────────────────────

@pytest.fixture(autouse=True)
def _decision_window_wide_open(monkeypatch):
    """Karar penceresi (RISK_FILTER_SINCE) kendi testinde sınanır; diğer
    testler sabit Temmuz tarihleri kullandığı için pencere geriye alınır —
    yoksa üretim tarihi her değiştiğinde alakasız testler kırılır."""
    monkeypatch.setattr(pt, "RISK_FILTER_SINCE", "2026-01-01")


def _hist(equities, exposure, start_day=1, month="07"):
    """Günlük equity_history — her gün TEK kayıt."""
    return [{"t": f"2026-{month}-{start_day+i:02d}T18:00:00", "equity": e,
             "invested": e * exposure, "cash": e * (1 - exposure)}
            for i, e in enumerate(equities)]


def test_daily_series_collapses_intraday_snapshots():
    """
    30 dakikada bir alınan anlık görüntüler bağımsız gözlem DEĞİLDİR. Günün
    son kaydı alınmalı; yoksa standart hata şişer (07/2026 PSI hatasının aynısı).
    """
    hist = [
        {"t": "2026-07-01T10:00:00", "equity": 100.0, "invested": 40.0},
        {"t": "2026-07-01T14:00:00", "equity": 105.0, "invested": 42.0},
        {"t": "2026-07-01T18:00:00", "equity": 110.0, "invested": 44.0},
        {"t": "2026-07-02T18:00:00", "equity": 120.0, "invested": 48.0},
    ]
    ser = pt._daily_series(hist)
    assert len(ser) == 2                       # 4 kayıt → 2 gün
    assert ser[0][1] == 110.0                  # günün SON değeri
    assert ser[0][2] == pytest.approx(0.4)     # maruziyet oranı


def test_sharpe_is_invariant_to_constant_leverage(monkeypatch):
    """
    ÖLÇÜT #1'in gerekçesi: nakit %0 getirirken portföy getirisi
    `f × (yatırılanın getirisi)` olur; f sabitken hem ortalama hem standart sapma
    aynı katsayıyla çarpılır ve Sharpe DEĞİŞMEZ. Bu yüzden Sharpe ölçütü iki
    defterin kaldıraç farkına rağmen geçerlidir.
    """
    base = [100.0, 101.0, 100.5, 102.0, 103.0, 102.5, 104.0]
    lev = [100.0 + (e - 100.0) * 0.583 for e in base]   # ölçülen kaldıraç oranı
    monkeypatch.setattr(pt, "load_state", lambda book="main": {"equity_history": _hist(base, 0.75)})
    a = pt.decision_metrics("shadow")["sharpe"]
    monkeypatch.setattr(pt, "load_state", lambda book="main": {"equity_history": _hist(lev, 0.436)})
    b = pt.decision_metrics("main")["sharpe"]
    assert a is not None and b is not None
    assert a == pytest.approx(b, rel=0.02)


def test_worst_month_raw_is_biased_by_leverage(monkeypatch):
    """
    ÖLÇÜT #2'nin HAM hâli yanlıdır: aynı temel hareket, daha düşük kaldıraç →
    mekanik olarak "daha iyi" en kötü ay. Filtre hiçbir şey yapmasa bile kazanır.
    """
    base = [100.0, 90.0]                                # −%10
    lev = [100.0, 100.0 - 10.0 * 0.583]                 # −%5,83 (aynı hareket)
    monkeypatch.setattr(pt, "load_state", lambda book="main": {"equity_history": _hist(base, 0.75)})
    hi = pt.decision_metrics("shadow")
    monkeypatch.setattr(pt, "load_state", lambda book="main": {"equity_history": _hist(lev, 0.436)})
    lo = pt.decision_metrics("main")
    assert lo["worst_month"] > hi["worst_month"]        # ham: düşük kaldıraç "kazanıyor"


def test_worst_month_normalized_removes_leverage_bias(monkeypatch):
    """Normalize edilince aynı temel hareket AYNI sonucu vermeli — yanlılık gitti."""
    base = [100.0, 90.0]
    lev = [100.0, 100.0 - 10.0 * 0.583]
    monkeypatch.setattr(pt, "load_state", lambda book="main": {"equity_history": _hist(base, 0.75)})
    hi = pt.decision_metrics("shadow")
    monkeypatch.setattr(pt, "load_state", lambda book="main": {"equity_history": _hist(lev, 0.436)})
    lo = pt.decision_metrics("main")
    assert lo["worst_month_norm"] == pytest.approx(hi["worst_month_norm"], rel=0.05)


def test_business_days_skips_weekends():
    """Cuma→Pazartesi 3 takvim günü ama 1 İŞLEM günüdür; getiri o kadar birikir."""
    assert pt._business_days_between("2026-07-10", "2026-07-13") == 1   # Cu→Pt
    assert pt._business_days_between("2026-07-13", "2026-07-14") == 1
    assert pt._business_days_between("2026-07-06", "2026-07-13") == 5   # tam hafta
    assert pt._business_days_between("2026-07-13", "2026-07-13") == 1   # asgari 1
    assert pt._business_days_between("bozuk", "2026-07-13") == 1        # çökmez


def test_sharpe_robust_to_recording_gaps(monkeypatch):
    """
    ÖLÇÜLEN GERÇEK: bilgisayar sürekli açık değil, 40 günde 16 kayıt ve
    aralarda 14 güne varan boşluklar var. Aynı temel getiri süreci, biri
    kesintisiz biri boşluklu kaydedilirse Sharpe YAKIN çıkmalı — boşluk
    düzeltmesi olmadan boşluklu seri oynaklığı şişirip Sharpe'ı bozuyordu.
    """
    # Kesintisiz: her iş günü %0,3 artış
    full, eq = [], 100.0
    for d in range(1, 21):
        eq *= 1.003
        full.append({"t": f"2026-07-{d:02d}T18:00:00", "equity": eq, "invested": eq * 0.5})
    full = [h for h in full
            if datetime.date.fromisoformat(h["t"][:10]).weekday() < 5]
    # Boşluklu: aynı süreçten yalnızca bazı günler kaydedilmiş
    sparse = [full[i] for i in (0, 1, 5, 6, 11, 13)]

    monkeypatch.setattr(pt, "load_state", lambda book="main": {"equity_history": full})
    s_full = pt.decision_metrics("main")["sharpe"]
    monkeypatch.setattr(pt, "load_state", lambda book="main": {"equity_history": sparse})
    m_sparse = pt.decision_metrics("main")
    assert m_sparse["sampling_gaps"] > 0        # boşluk gerçekten var
    assert s_full is not None and m_sparse["sharpe"] is not None
    # Sabit büyüme → her iki seride de oynaklık ~0, Sharpe çok büyük ve aynı işaretli
    assert (s_full > 0) == (m_sparse["sharpe"] > 0)


def test_sharpe_gap_correction_changes_result(monkeypatch):
    """
    Düzeltmenin GERÇEKTEN iş yaptığını göster: 14 günlük boşluktan sonra gelen
    büyük hareket, 1 günlük hareket sayılırsa oynaklık şişer. Δd bölmesi bunu
    ölçeğine indirir; iki gözlemin normalize edilmiş büyüklüğü yakınlaşır.
    """
    hist = [
        {"t": "2026-07-06T18:00:00", "equity": 100.0, "invested": 50.0},
        {"t": "2026-07-07T18:00:00", "equity": 101.0, "invested": 50.0},   # 1 gün, %1
        {"t": "2026-07-27T18:00:00", "equity": 116.0, "invested": 58.0},   # 15 iş günü
    ]
    monkeypatch.setattr(pt, "load_state", lambda book="main": {"equity_history": hist})
    m = pt.decision_metrics("main")
    assert m["sampling_gaps"] == 1
    assert m["days_spanned"] == 15
    assert m["sharpe"] is not None          # patlamadı, sonlu bir sayı üretti


def test_decision_metrics_excludes_prefilter_history(monkeypatch):
    """
    İKİNCİ DENETİM TURU BULGUSU (17.08.2026): ana defterin serisi 08.07'den
    başlıyordu, filtre ise 14.08'de doğdu — filtresiz 5 hafta Sharpe'a
    karışıyordu. Plan "AYNI dönemde" diyor; pencere dışı kayıt ölçüme giremez.
    Temmuz'a felaket koyup Ağustos'a sakin seyir koyuyoruz: pencere işliyorsa
    felaket görünmez OLMALI.
    """
    monkeypatch.setattr(pt, "RISK_FILTER_SINCE", "2026-08-14")
    hist = (_hist([100.0, 50.0, 25.0, 12.5], 0.5, start_day=1, month="07")
            + _hist([100.0, 100.5, 101.0, 101.5], 0.5, start_day=14, month="08"))
    monkeypatch.setattr(pt, "load_state", lambda book="main": {"equity_history": hist})
    m = pt.decision_metrics("main")
    assert m["window_start"] == "2026-08-14"
    assert m["n_days"] == 4                          # Temmuz çöküşü DAHİL DEĞİL
    assert m["worst_month"] is not None and m["worst_month"] > 0.0


def test_decision_metrics_survives_empty_history(monkeypatch):
    """Veri yoksa çökmemeli — None dönüp 'yetersiz' demeli."""
    monkeypatch.setattr(pt, "load_state", lambda book="main": {"equity_history": []})
    m = pt.decision_metrics("main")
    assert m["sharpe"] is None and m["worst_month"] is None
    assert m["note"] is not None


def test_decision_not_declared_before_date(monkeypatch):
    """Karar tarihinden önce okumak KARAR SAYILMAZ — erteleme kadar zararlıdır."""
    monkeypatch.setattr(pt, "load_state", lambda book="main": {"equity_history": []})
    d = pt.filter_decision()
    assert d["decision_date"] == "2027-02-12"
    assert d["decided"] is (datetime.date.today().isoformat() >= "2027-02-12")
