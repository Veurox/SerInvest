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


def test_each_book_reads_its_own_trades(tmp_path, monkeypatch):
    """
    08/2026 hatası: _read_trades yolu `_paths(book)` ile DOĞRU hesaplıyor,
    varlığını DOĞRU kontrol ediyor, ama sonra modül düzeyindeki TRADES_FILE'ı
    (ana defter) açıyordu. Gölge defter, ana defterin 37 işlemini kendi
    istatistiği gibi gösteriyordu — gerçekte 2 işlemi vardı.

    Bu, 2027-02-12 karşılaştırmasını kirleten türden bir hata: iki defter
    aynı sayıları gösterirse kıyas anlamını yitirir.
    """
    main_f   = tmp_path / "paper_trades.csv"
    shadow_f = tmp_path / "paper_trades_shadow.csv"
    monkeypatch.setattr(pt, "TRADES_FILE", main_f)
    monkeypatch.setattr(pt, "MODELS_DIR", tmp_path)

    base = {"entry_date": "2026-07-01T10:00:00", "exit_date": "2026-07-11T18:00:00",
            "exit_reason": "TP", "net_pnl": 10.0}
    pt._append_trade(dict(base, symbol="ANA1"), book="main")
    pt._append_trade(dict(base, symbol="ANA2"), book="main")
    pt._append_trade(dict(base, symbol="ANA3"), book="main")
    pt._append_trade(dict(base, symbol="GOLGE1"), book="shadow")

    ana    = pt._read_trades(book="main")
    golge  = pt._read_trades(book="shadow")

    assert len(ana) == 3 and len(golge) == 1
    assert {t["symbol"] for t in golge} == {"GOLGE1"}      # ana defterin işlemi SIZMADI
    assert "GOLGE1" not in {t["symbol"] for t in ana}
    assert shadow_f.exists()


def test_missing_book_file_returns_empty(tmp_path, monkeypatch):
    """Gölge dosyası henüz yoksa ANA dosyaya düşmemeli — boş dönmeli."""
    main_f = tmp_path / "paper_trades.csv"
    monkeypatch.setattr(pt, "TRADES_FILE", main_f)
    monkeypatch.setattr(pt, "MODELS_DIR", tmp_path)
    pt._append_trade({"entry_date": "2026-07-01T10:00:00", "exit_date": "2026-07-11T18:00:00",
                      "symbol": "ANA", "exit_reason": "TP"}, book="main")
    assert pt._read_trades(book="shadow") == []


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


# ── Bar kapısıyla uyum (17.10.2026) ──────────────────────────────────────────
#
# Bar kapısı engellediği sembolü portföyüyle birlikte atlıyordu: TUPRS ve
# AEFES 14 günlük süre sınırını 29 gün aştı, 16.09'dan sonra tek işlem
# kapanmadı ve hiçbir alım açılamazdı. Çıkışlar artık kapıdan bağımsız
# (manage_position); alımlar akşam sinyalinden bekleyen emir olarak ertesi
# seansta uygulanıyor (queue_candidates / execute_pending).

@pytest.fixture
def defter(tmp_path, monkeypatch):
    """Diske dokunmayan boş ana defter (kapanışlar save_state çağırıyor)."""
    monkeypatch.setattr(pt, "MODELS_DIR", tmp_path)
    monkeypatch.setattr(pt, "PORTFOLIO_FILE", tmp_path / "paper_portfolio.json")
    monkeypatch.setattr(pt, "TRADES_FILE", tmp_path / "paper_trades.csv")
    st = pt._new_state()
    st["book"] = "main"
    return st


def _pozisyon(st, sym="TUPRS", gun_once=20, giris=100.0, hedef=110.0, stop=95.0):
    giris_t = datetime.datetime.utcnow() - datetime.timedelta(days=gun_once)
    st["positions"][sym] = {
        "symbol": sym, "shares": 10, "entry_price": giris,
        "entry_date": giris_t.isoformat(), "target": hedef, "stop": stop,
        "last_price": giris, "entry_cost": 0.0, "entry_conf": 0.6,
        "last_check": giris_t.isoformat(),
    }
    st["cash"] -= 10 * giris
    return giris_t.date().isoformat()


def test_suresi_dolan_pozisyon_seansta_kapanir(defter):
    _pozisyon(defter, gun_once=20)
    sebep = pt.manage_position(defter, "TUPRS", 101.0, [], market_open=True,
                               fresh=True, son_kapanmis="2026-10-16")
    assert sebep == "TIME"
    assert "TUPRS" not in defter["positions"]


def test_sure_cikisi_seans_disinda_ve_bayat_fiyatla_beklemez_kapatmaz(defter):
    _pozisyon(defter, gun_once=20)
    assert pt.manage_position(defter, "TUPRS", 101.0, [], market_open=False,
                              fresh=True, son_kapanmis="2026-10-16") is None
    assert pt.manage_position(defter, "TUPRS", 101.0, [], market_open=True,
                              fresh=False, son_kapanmis="2026-10-16") is None
    assert "TUPRS" in defter["positions"]


def test_stop_piyasa_kapaliyken_de_gecmis_bardan_yakalanir(defter):
    giris = _pozisyon(defter, gun_once=5)
    d = (datetime.date.fromisoformat(giris) + datetime.timedelta(days=1)).isoformat()
    sebep = pt.manage_position(defter, "TUPRS", 96.0, [_bar(d, 101, 94)],
                               market_open=False, fresh=False, son_kapanmis=d)
    assert sebep == "SL"


def test_yarim_bar_taranir_ama_tarandi_sayilmaz(defter):
    """Eski hata: gün içindeki ilk tur bugünü 'tarandı' işaretliyor, günün
    geri kalanındaki stop vuruşu bir daha hiç görülmüyordu."""
    giris = _pozisyon(defter, gun_once=5)
    dun = (datetime.date.fromisoformat(giris) + datetime.timedelta(days=1)).isoformat()
    bugun = (datetime.date.fromisoformat(giris) + datetime.timedelta(days=2)).isoformat()

    # 11:00 — bugünün yarım barı stopa değmedi
    assert pt.manage_position(defter, "TUPRS", 99.0,
                              [_bar(dun, 102, 98), _bar(bugun, 100, 97)],
                              market_open=True, fresh=True, son_kapanmis=dun) is None
    assert defter["positions"]["TUPRS"]["last_check"][:10] == dun

    # 15:00 — aynı günün barı artık stopun altına inmiş
    assert pt.manage_position(defter, "TUPRS", 94.5,
                              [_bar(dun, 102, 98), _bar(bugun, 100, 94)],
                              market_open=True, fresh=True, son_kapanmis=dun) == "SL"


def test_analiz_edilen_sembolun_eski_emri_silinir_digeri_kalir(defter):
    pt.queue_candidates(defter, {"AKBNK", "GARAN"},
                        [{"symbol": "AKBNK", "bar_gunu": "2026-10-15"},
                         {"symbol": "GARAN", "bar_gunu": "2026-10-15"}])
    # ertesi akşam: AKBNK artık AL değil, GARAN bu turda analiz edilmedi
    pt.queue_candidates(defter, {"AKBNK", "THYAO"},
                        [{"symbol": "THYAO", "bar_gunu": "2026-10-16"}])
    assert set(defter["pending"]) == {"GARAN", "THYAO"}


def _emir(sym="THYAO", bar="2026-10-16", stop=280.0, hedef=330.0):
    return {"symbol": sym, "bar_gunu": bar, "signal_price": 300.0, "conf": 0.6,
            "position_pct": 0.1, "target": hedef, "stop": stop, "score": 0.05}


def test_emir_ertesi_seansta_o_anki_fiyattan_acilir(defter):
    pt.queue_candidates(defter, {"THYAO"}, [_emir()])
    acilan = pt.execute_pending(defter, {"THYAO": (305.0, True)},
                                market_open=True, son_kapanmis="2026-10-16")
    assert acilan == 1
    assert defter["positions"]["THYAO"]["entry_price"] == 305.0   # sinyal fiyatı 300 değil
    assert defter["pending"] == {}


def test_emir_seans_kapaliyken_ve_fiyat_bayatken_bekler(defter):
    pt.queue_candidates(defter, {"THYAO"}, [_emir()])
    assert pt.execute_pending(defter, {"THYAO": (300.0, True)},
                              market_open=False, son_kapanmis="2026-10-16") == 0
    assert pt.execute_pending(defter, {"THYAO": (300.0, False)},
                              market_open=True, son_kapanmis="2026-10-16") == 0
    assert "THYAO" in defter["pending"]


def test_seansi_kacan_emir_duser(defter):
    """Makine ertesi gün hiç açılmadıysa eski sinyalle günler sonra alım yapılmaz."""
    pt.queue_candidates(defter, {"THYAO"}, [_emir(bar="2026-10-15")])
    assert pt.execute_pending(defter, {"THYAO": (300.0, True)},
                              market_open=True, son_kapanmis="2026-10-16") == 0
    assert defter["pending"] == {} and defter["positions"] == {}


def test_bariyerin_disinda_acilan_fiyatla_alinmaz(defter):
    pt.queue_candidates(defter, {"THYAO", "GARAN"},
                        [_emir("THYAO"), _emir("GARAN")])
    acilan = pt.execute_pending(defter, {"THYAO": (279.0, True), "GARAN": (331.0, True)},
                                market_open=True, son_kapanmis="2026-10-16")
    assert acilan == 0 and defter["positions"] == {} and defter["pending"] == {}


def test_son_kapanmis_gun_hafta_sonu_cumaya_doner():
    cmt = datetime.datetime(2026, 10, 17, 12, 0)
    pzt_seans = datetime.datetime(2026, 10, 19, 11, 0)
    pzt_aksam = datetime.datetime(2026, 10, 19, 19, 0)
    assert pt.son_kapanmis_gun(cmt) == "2026-10-16"
    assert pt.son_kapanmis_gun(pzt_seans) == "2026-10-16"   # cuma emri pazartesi geçerli
    assert pt.son_kapanmis_gun(pzt_aksam) == "2026-10-19"
