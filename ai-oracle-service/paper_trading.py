"""
SerInvest Oracle — Otonom Model Portföyü (Paper Trading)
=========================================================

Modelin KENDİ sanal portföyü. Gerçek para yok — model her analiz döngüsünde
kullanıcının seçtiği hisselerde kendi kararlarıyla alım/satım yapar. Amaç:
modelin canlı performansını gerçek piyasada test etmek (paper trading).

Kurallar (kullanıcı onayı 05/2026):
  • Evren        : UI'dan seçilen hisse listesi (paper_universe.json)
  • İşlem kuralı : Modelin pozisyon önerisine göre — rec=ALIM & position_pct>0 → LONG aç
  • Sermaye      : 100.000 ₺ başlangıç sanal nakit
  • Çıkış        : TP (hedef) / SL (stop) / zaman bariyeri (HORIZON gün) / model SELL'e döndü
  • Maliyet      : Her alım+satımda TRANSACTION_COST_PCT komisyon+spread

Long-only: BIST'te bireysel açığa satış pratik değil. SELL sinyali = pozisyon
açma / varsa kapat. Böylece model hem "al" hem "sat" kararı verir.

Durum dosyaları (MODELS_DIR):
  paper_portfolio.json — nakit, açık pozisyonlar, equity geçmişi
  paper_trades.csv     — kapanan işlemler (denetim izi)
  paper_universe.json  — seçili hisseler

Thread-safe: analiz döngüsü tek thread'de çalışsa da admin endpoint'leri
ayrı thread → tüm okuma/yazma _LOCK ile korunur.
"""
import csv
import datetime
import json
import math
import os
import threading

import ml.atomic as atomic
from ml.config import (
    HORIZON,            # 10 işlem günü — canlı champion ile AYNI ufuk
    MODELS_DIR,
    TRANSACTION_COST_PCT,
)

# ── Dosya yolları ────────────────────────────────────────────────────────────
PORTFOLIO_FILE = MODELS_DIR / "paper_portfolio.json"
TRADES_FILE    = MODELS_DIR / "paper_trades.csv"
UNIVERSE_FILE  = MODELS_DIR / "paper_universe.json"

# ── Sabitler ─────────────────────────────────────────────────────────────────
INITIAL_CAPITAL   = 100_000.0   # ₺
MAX_OPEN_POSITIONS = 8          # aynı anda en fazla açık pozisyon
MAX_EQUITY_HISTORY = 5000       # snapshot tavanı (dosya şişmesin)

# ── Faz 2 (ml v4 — 07/2026): Portföy kısıtları ───────────────────────────────
# 3 banka hissesi = 1 makro risk. Sektör tavanı korelasyon riskini sınırlar;
# brüt maruziyet tavanı her koşulda nakit tamponu bırakır.
MAX_PER_SECTOR     = 2          # aynı sektörden en fazla açık pozisyon
MAX_GROSS_EXPOSURE = 0.80       # yatırılan / equity tavanı (%20 nakit tamponu)

# BIST sektör haritası (paper evreni sembolleri). Bilinmeyen sembol kendi adını
# sektör olarak alır → tavana takılmaz (fail-open; yanlış bloklamaktansa serbest).
SECTOR_MAP: dict[str, str] = {
    # Bankalar
    "AKBNK": "BANKA", "ALBRK": "BANKA", "GARAN": "BANKA", "HALKB": "BANKA",
    "ISCTR": "BANKA", "SKBNK": "BANKA", "TSKB": "BANKA", "VAKBN": "BANKA", "YKBNK": "BANKA",
    # Holdingler
    "AGHOL": "HOLDING", "ALARK": "HOLDING", "BERA": "HOLDING", "DOHOL": "HOLDING",
    "ENKAI": "HOLDING", "KCHOL": "HOLDING", "SAHOL": "HOLDING", "TKFEN": "HOLDING",
    # Sigorta
    "ANHYT": "SIGORTA", "ANSGR": "SIGORTA", "TURSG": "SIGORTA",
    # Havacılık & Ulaştırma
    "THYAO": "HAVACILIK", "PGSUS": "HAVACILIK", "TAVHL": "HAVACILIK",
    # Otomotiv & Yan Sanayi
    "FROTO": "OTOMOTIV", "TOASO": "OTOMOTIV", "DOAS": "OTOMOTIV", "KARSN": "OTOMOTIV",
    "OTKAR": "OTOMOTIV", "TTRAK": "OTOMOTIV", "BRISA": "OTOMOTIV", "EGEEN": "OTOMOTIV",
    # Enerji (üretim / yenilenebilir / ekipman)
    "AKSEN": "ENERJI", "AKFYE": "ENERJI", "ASTOR": "ENERJI", "BIOEN": "ENERJI",
    "CWENE": "ENERJI", "ENJSA": "ENERJI", "GESAN": "ENERJI", "KONTR": "ENERJI",
    "ODAS": "ENERJI", "SMRTG": "ENERJI", "ZOREN": "ENERJI",
    # Rafineri & Petrokimya & Kimya
    "TUPRS": "KIMYA", "PETKM": "KIMYA", "SASA": "KIMYA", "AKSA": "KIMYA",
    "GUBRF": "KIMYA", "HEKTS": "KIMYA",
    # Demir-Çelik & Metal
    "EREGL": "METAL", "KRDMD": "METAL", "BRSAN": "METAL", "KCAER": "METAL",
    # Çimento & Yapı Malzemeleri
    "AKCNS": "CIMENTO", "BUCIM": "CIMENTO", "CIMSA": "CIMENTO", "GOLTS": "CIMENTO",
    "KONYA": "CIMENTO", "OYAKC": "CIMENTO", "BIENY": "CIMENTO",
    # Gıda & İçecek
    "AEFES": "GIDA", "CCOLA": "GIDA", "ULKER": "GIDA", "TABGD": "GIDA", "TUKAS": "GIDA",
    # Perakende & Giyim
    "BIMAS": "PERAKENDE", "MGROS": "PERAKENDE", "SOKM": "PERAKENDE", "MAVI": "PERAKENDE",
    # Telekom
    "TCELL": "TELEKOM", "TTKOM": "TELEKOM",
    # Teknoloji & Savunma
    "ASELS": "TEKNOLOJI", "KAREL": "TEKNOLOJI", "MIATK": "TEKNOLOJI", "PENTA": "TEKNOLOJI",
    # Beyaz Eşya & Elektronik & Cam
    "ARCLK": "DAYANIKLI", "VESTL": "DAYANIKLI", "VESBE": "DAYANIKLI", "SISE": "DAYANIKLI",
    # GYO
    "EKGYO": "GYO", "AKFGY": "GYO", "AKSGY": "GYO",
    # Sağlık & İlaç
    "MPARK": "SAGLIK", "ECILC": "SAGLIK",
}


def get_sector(sym: str) -> str:
    """Sembolün sektörü; haritada yoksa sembolün kendisi (tavansız)."""
    return SECTOR_MAP.get(sym.upper(), sym.upper())
# Zaman bariyeri: HORIZON işlem günü ≈ HORIZON*1.4 takvim günü (hafta sonu payı)
TIME_BARRIER_DAYS = max(1, round(HORIZON * 1.4))

# BIST seans saatleri (TR yerel — container saati TR'ye ayarlı, schedule 18:10 kullanıyor).
# Sürekli işlem ~10:00–18:00, kapanış seansı ~18:10. 18:30'a kadar tolerans.
MARKET_OPEN_TIME  = datetime.time(10, 0)
MARKET_CLOSE_TIME = datetime.time(18, 30)

# ── BIST Resmi Tatil Takvimi (borsanın kapalı olduğu günler) ─────────────────
# YILLIK GÜNCELLENMELİ. Dini bayramlar (Ramazan/Kurban) her yıl ~11 gün kayar.
# NOT: Bu liste eksik/yanlış olsa bile "veri tazeliği" gardı (analysis.py) yedek
# koruma sağlar — kapalı günde o güne ait bar oluşmadığı için yeni pozisyon zaten
# açılmaz. Liste; is_market_open'ı dürüstleştirmek, TIME/SIGNAL çıkışlarını ve equity
# snapshot'ını tatilde durdurmak ve UI rozetinde tatil adını göstermek için.
# (Arife günleri yarım seanstır — muhafazakâr olarak kapalı sayıyoruz.)
BIST_HOLIDAYS: dict[str, str] = {
    "2026-01-01": "Yılbaşı",
    "2026-03-19": "Ramazan Bayramı (Arife)",
    "2026-03-20": "Ramazan Bayramı",
    "2026-03-21": "Ramazan Bayramı",
    "2026-03-22": "Ramazan Bayramı",
    "2026-04-23": "Ulusal Egemenlik ve Çocuk Bayramı",
    "2026-05-01": "İşçi Bayramı",
    "2026-05-19": "Atatürk'ü Anma, Gençlik ve Spor Bayramı",
    "2026-05-26": "Kurban Bayramı (Arife)",
    "2026-05-27": "Kurban Bayramı",
    "2026-05-28": "Kurban Bayramı",
    "2026-05-29": "Kurban Bayramı",
    "2026-07-15": "Demokrasi ve Millî Birlik Günü",
    "2026-08-30": "Zafer Bayramı",
    "2026-10-28": "Cumhuriyet Bayramı (Arife)",
    "2026-10-29": "Cumhuriyet Bayramı",
}

_LOCK = threading.RLock()


def market_closed_reason(now: datetime.datetime | None = None) -> str | None:
    """Piyasa kapalıysa nedenini döndürür ('Hafta sonu' / 'Tatil: X' / 'Seans dışı'); açıksa None."""
    now = now or datetime.datetime.now()
    iso = now.date().isoformat()
    if iso in BIST_HOLIDAYS:
        return f"Tatil: {BIST_HOLIDAYS[iso]}"
    if now.weekday() >= 5:           # Cmt/Paz
        return "Hafta sonu"
    if not (MARKET_OPEN_TIME <= now.time() <= MARKET_CLOSE_TIME):
        return "Seans dışı"
    return None


def is_market_open(now: datetime.datetime | None = None) -> bool:
    """BIST açık mı? Hafta içi + seans saatleri + resmi tatil kontrolü."""
    return market_closed_reason(now) is None


def _scan_barrier_exit(pos: dict, bars: list) -> tuple | None:
    """
    Pozisyon açıldıktan sonraki SEANS barlarında TP/SL gün-içi vuruldu mu tarar.
    bars: [{date:'YYYY-MM-DD', high, low, close}, ...] artan sırada.

    Bilgisayar kapalıyken kaçırılan bariyer vuruşlarını yakalar ve çıkışı
    GERÇEK bariyer fiyatından (o anki fiyattan değil) kaydeder → gerçekçi P&L.
    Döndürür: (exit_price, reason, exit_date) veya None.
    """
    target = pos.get("target")
    stop   = pos.get("stop")
    # Daha önce taranan son güne kadar olanları atla (last_check tarih kısmı).
    last_seen = (pos.get("last_check") or pos.get("entry_date") or "")[:10]
    entry_day = (pos.get("entry_date") or "")[:10]
    for b in bars:
        d = b["date"]
        # Giriş günü ve daha öncesi + zaten taranan günler hariç
        if d <= entry_day or d <= last_seen:
            continue
        hi, lo = b["high"], b["low"]
        hit_tp = target is not None and hi >= target
        hit_sl = stop   is not None and lo <= stop
        # Aynı gün ikisi de → günlük bardan sıra bilinemez → muhafazakâr SL
        if hit_tp and hit_sl:
            return (stop, "SL", d)
        if hit_tp:
            return (target, "TP", d)
        if hit_sl:
            return (stop, "SL", d)
    return None

_TRADE_FIELDS = [
    "entry_date", "exit_date", "symbol", "shares",
    "entry_price", "exit_price", "gross_pnl", "costs", "net_pnl",
    "pnl_pct", "exit_reason", "hold_days", "entry_conf",
]


# ── Durum yükleme / kaydetme ─────────────────────────────────────────────────
def _new_state() -> dict:
    now = datetime.datetime.utcnow().isoformat()
    return {
        "initial_capital": INITIAL_CAPITAL,
        "cash":            INITIAL_CAPITAL,
        "positions":       {},     # symbol -> position dict
        "equity_history":  [],     # [{t, equity, cash, invested, benchmark}]
        "created_at":      now,
        "last_cycle":      None,
        "benchmark_start": None,   # ilk snapshot'taki XU100 seviyesi
        "n_trades":        0,
    }


def load_state() -> dict:
    with _LOCK:
        if PORTFOLIO_FILE.exists():
            try:
                return json.loads(PORTFOLIO_FILE.read_text(encoding="utf-8"))
            except Exception as e:
                print(f"[Paper] Durum okunamadı, sıfırdan başlanıyor: {e}")
        return _new_state()


def save_state(state: dict) -> None:
    """Portföy durumunu ATOMİK yazar — yarım yazım tüm portföyü kaybettirirdi."""
    with _LOCK:
        try:
            atomic.write_json(PORTFOLIO_FILE, state)
        except Exception as e:
            print(f"[Paper] Durum kaydedilemedi: {e}")


# ── Evren (UI'dan seçilen hisseler) ──────────────────────────────────────────
def get_universe() -> list:
    with _LOCK:
        if UNIVERSE_FILE.exists():
            try:
                data = json.loads(UNIVERSE_FILE.read_text(encoding="utf-8"))
                syms = data.get("symbols", [])
                return [str(s).upper().strip() for s in syms if s]
            except Exception:
                pass
        return []


def set_universe(symbols: list) -> list:
    cleaned = sorted({str(s).upper().strip() for s in symbols if s and str(s).strip()})
    with _LOCK:
        UNIVERSE_FILE.write_text(
            json.dumps(
                {"symbols": cleaned, "updated_at": datetime.datetime.utcnow().isoformat()},
                ensure_ascii=False, indent=2,
            ),
            encoding="utf-8",
        )
    return cleaned


# ── Kapanan işlem kaydı (CSV) ────────────────────────────────────────────────
def _trade_key(row: dict) -> tuple:
    """İşlemin kimliği — aynı pozisyonun ikinci kez kaydını yakalamak için."""
    return (str(row.get("entry_date", ""))[:19],
            str(row.get("symbol", "")).upper(),
            str(row.get("exit_date", ""))[:19])


def _append_trade(trade: dict) -> None:
    """
    Kapanan işlemi CSV'ye ekler — İDEMPOTANT.

    07/2026 bulgusu: CSV'ye yazım _close_position içinde anında oluyordu ama
    state (paper_portfolio.json) döngü SONUNDA kaydediliyordu. Arada konteyner
    yeniden başlarsa pozisyon eski JSON'da duruyor → bir sonraki döngüde tekrar
    kapanıyor → aynı işlem CSV'ye İKİ KEZ yazılıyordu (BIMAS/EREGL vakası).
    Artık aynı (giriş, sembol, çıkış) üçlüsü varsa satır atlanır.
    """
    with _LOCK:
        try:
            if TRADES_FILE.exists():
                key = _trade_key(trade)
                with open(TRADES_FILE, "r", encoding="utf-8") as f:
                    for r in csv.DictReader(f):
                        if _trade_key(r) == key:
                            print(f"  [Paper] {trade.get('symbol')} işlemi zaten kayıtlı — atlandı (mükerrer koruma)")
                            return
            write_header = not TRADES_FILE.exists()
            with open(TRADES_FILE, "a", newline="", encoding="utf-8") as f:
                w = csv.DictWriter(f, fieldnames=_TRADE_FIELDS)
                if write_header:
                    w.writeheader()
                w.writerow({k: trade.get(k, "") for k in _TRADE_FIELDS})
                f.flush()
                os.fsync(f.fileno())
        except Exception as e:
            print(f"[Paper] İşlem CSV yazılamadı: {e}")


def _read_trades(limit: int = 200) -> list:
    with _LOCK:
        if not TRADES_FILE.exists():
            return []
        try:
            with open(TRADES_FILE, "r", encoding="utf-8") as f:
                rows = list(csv.DictReader(f))
            return rows[-limit:]
        except Exception:
            return []


# ── İşlem mantığı ────────────────────────────────────────────────────────────
def _hold_days(entry_date_str: str, until: str | None = None) -> float:
    try:
        ed = datetime.datetime.fromisoformat(entry_date_str)
        end = datetime.datetime.fromisoformat(until) if until else datetime.datetime.utcnow()
        return (end - ed).total_seconds() / 86400.0
    except Exception:
        return 0.0


def _close_position(state: dict, sym: str, exit_price: float, reason: str,
                    exit_dt: str | None = None) -> dict | None:
    """
    Açık pozisyonu kapat, nakde dön, CSV'ye yaz. Kapanan trade dict döner.

    exit_dt: çıkış zaman damgası (ISO). Bariyer (TP/SL) gün-içi vuruşlarında
    GEÇMİŞ seans gününün kapanış saati verilir; None ise şu an (utcnow).
    """
    pos = state["positions"].pop(sym, None)
    if pos is None or exit_price is None or exit_price <= 0:
        if pos is not None:
            state["positions"][sym] = pos   # geri koy — fiyat yoksa kapatma
        return None

    # Bariyer vuruşu geçmiş bir seans gününde olduysa o günün kapanış saatini kullan
    exit_iso = exit_dt or datetime.datetime.utcnow().isoformat()
    if len(exit_iso) == 10:                 # sadece tarih geldiyse → BIST kapanışı
        exit_iso = exit_iso + "T18:00:00"

    shares      = pos["shares"]
    entry_price = pos["entry_price"]
    proceeds    = shares * exit_price
    exit_cost   = proceeds * TRANSACTION_COST_PCT
    state["cash"] += proceeds - exit_cost

    gross_pnl = (exit_price - entry_price) * shares
    total_cost = pos.get("entry_cost", 0.0) + exit_cost
    net_pnl   = gross_pnl - total_cost
    pnl_pct   = (exit_price - entry_price) / entry_price if entry_price else 0.0
    hold_d    = _hold_days(pos["entry_date"], until=exit_iso)

    trade = {
        "entry_date":  pos["entry_date"][:19],
        "exit_date":   exit_iso[:19],
        "symbol":      sym,
        "shares":      shares,
        "entry_price": round(entry_price, 4),
        "exit_price":  round(exit_price, 4),
        "gross_pnl":   round(gross_pnl, 2),
        "costs":       round(total_cost, 2),
        "net_pnl":     round(net_pnl, 2),
        "pnl_pct":     round(pnl_pct, 4),
        "exit_reason": reason,
        "hold_days":   round(hold_d, 1),
        "entry_conf":  pos.get("entry_conf"),
    }
    _append_trade(trade)
    state["n_trades"] = state.get("n_trades", 0) + 1
    print(f"  [Paper] KAPAT {sym} @ {exit_price:.2f} ({reason}) → net P&L {net_pnl:+.0f}₺ ({pnl_pct:+.1%})")
    # State'i HEMEN kalıcılaştır: aksi halde döngü sonuna kadarki restart penceresinde
    # pozisyon eski JSON'dan geri gelir ve işlem ikinci kez kapanır (07/2026 bulgusu).
    save_state(state)
    return trade


def _open_position(state: dict, sym: str, price: float, position_pct: float,
                   target, stop, conf: float) -> bool:
    """Equity'nin position_pct'i kadar LONG aç. Başarılıysa True."""
    equity = _total_equity(state)
    target_value = equity * position_pct
    # Nakitle sınırla
    invest = min(target_value, state["cash"] * 0.98)
    if invest <= 0 or price <= 0:
        return False
    shares = math.floor(invest / price)
    if shares <= 0:
        return False

    cost_basis = shares * price
    entry_cost = cost_basis * TRANSACTION_COST_PCT
    if cost_basis + entry_cost > state["cash"]:
        return False

    state["cash"] -= cost_basis + entry_cost
    state["positions"][sym] = {
        "symbol":      sym,
        "shares":      shares,
        "entry_price": round(price, 4),
        "entry_date":  datetime.datetime.utcnow().isoformat(),
        "target":      round(target, 4) if target else None,
        "stop":        round(stop, 4) if stop else None,
        "last_price":  round(price, 4),
        "entry_cost":  round(entry_cost, 2),
        "entry_conf":  round(conf, 4),
        "last_check":  datetime.datetime.utcnow().isoformat(),   # bariyer tarama bazı
    }
    print(f"  [Paper] AÇ {sym} {shares} adet @ {price:.2f} (%{position_pct*100:.1f}, güven %{conf*100:.0f})")
    return True


def _total_equity(state: dict) -> float:
    """Nakit + açık pozisyonların güncel piyasa değeri (last_price ile)."""
    invested = sum(
        p["shares"] * (p.get("last_price") or p["entry_price"])
        for p in state["positions"].values()
    )
    return state["cash"] + invested


# ── Döngü entegrasyonu ───────────────────────────────────────────────────────
def on_signal(state: dict, sym: str, price, rec_dir: str, conf: float,
              position_pct, target, stop,
              bars: list | None = None, market_open: bool = True,
              fresh: bool = True, allow_open: bool = True) -> None:
    """
    Analiz döngüsünde her sembol için çağrılır (yalnızca evrendeki semboller).
    Mevcut pozisyonu çıkış için kontrol eder, gerekirse yeni pozisyon açar.
    state YERİNDE değiştirilir; kaydetme çağıran tarafa aittir.

    Gerçekçilik korumaları (05/2026):
      • bars        : Sembolün son seans OHLC barları → TP/SL gün-içi tarama (boşluk-farkında).
      • market_open : Yeni pozisyon AÇMA ve TIME/SIGNAL çıkışları yalnızca BIST açıkken icra edilir.
      • fresh       : Kullanılan bar güncel seansa ait değilse (bayat veri) işlem açılmaz.
    TP/SL bariyer çıkışları piyasa kapalı olsa bile GEÇMİŞ seans barlarından
    tespit edilip gerçek bariyer fiyatından kapatılır (kaçırılmış stop'lar yakalanır).

    allow_open=False (Faz 2): yalnızca çıkışlar işlenir; ALIM'lar çağıran tarafça
    aday havuzunda toplanıp open_from_candidates ile EV sıralı + kısıtlı açılır.
    """
    sym = sym.upper()
    if price is None or price <= 0:
        return

    pos = state["positions"].get(sym)

    # ── Açık pozisyon ──
    if pos is not None:
        pos["last_price"] = round(float(price), 4)

        # 1) Boşluk-farkında TP/SL: geçmiş seans barlarını tara (her zaman geçerli).
        if bars:
            hit = _scan_barrier_exit(pos, bars)
            if hit:
                exit_price, reason, exit_date = hit
                _close_position(state, sym, float(exit_price), reason, exit_dt=exit_date)
                return
            pos["last_check"] = datetime.datetime.utcnow().isoformat()

        # 2) TIME / SIGNAL çıkışları: "şu an" icra → yalnızca piyasa açıkken.
        if market_open:
            if _hold_days(pos["entry_date"]) >= TIME_BARRIER_DAYS:
                _close_position(state, sym, float(price), "TIME")
                return
            if rec_dir == "SELL":
                _close_position(state, sym, float(price), "SIGNAL")
                return
        return

    # ── Pozisyon yok: yalnızca piyasa AÇIK + veri TAZE iken ALIM aç ──
    if not allow_open:
        return
    if not (market_open and fresh):
        return
    if rec_dir == "BUY" and position_pct and position_pct > 0:
        if len(state["positions"]) >= MAX_OPEN_POSITIONS:
            return
        _open_position(state, sym, float(price), float(position_pct),
                       target, stop, conf)


def open_from_candidates(state: dict, candidates: list[dict]) -> int:
    """
    Faz 2: AL adaylarını skorlarına (EV) göre azalan sırada, portföy kısıtları
    altında açar (greedy top-k). Kısıtlar:
      • MAX_OPEN_POSITIONS  — toplam açık pozisyon tavanı
      • MAX_PER_SECTOR      — aynı sektörden en fazla N pozisyon (korelasyon riski)
      • MAX_GROSS_EXPOSURE  — yatırılan/equity tavanı (nakit tamponu)
    candidates: [{symbol, price, conf, position_pct, target, stop, score}, ...]
    Döndürür: açılan pozisyon sayısı.
    """
    opened = 0
    ranked = sorted(candidates, key=lambda c: -(c.get("score") or 0.0))
    for c in ranked:
        sym = str(c["symbol"]).upper()
        if sym in state["positions"]:
            continue
        if len(state["positions"]) >= MAX_OPEN_POSITIONS:
            print(f"  [Paper] {sym} atlandı — pozisyon tavanı ({MAX_OPEN_POSITIONS}) dolu")
            break
        # Sektör tavanı
        sector = get_sector(sym)
        n_sector = sum(1 for s in state["positions"] if get_sector(s) == sector)
        if n_sector >= MAX_PER_SECTOR:
            print(f"  [Paper] {sym} atlandı — {sector} sektör tavanı ({MAX_PER_SECTOR}) dolu")
            continue
        # Brüt maruziyet tavanı (planlanan pozisyon dahil)
        equity = _total_equity(state)
        invested = equity - state["cash"]
        planned = equity * float(c["position_pct"])
        if equity > 0 and (invested + planned) / equity > MAX_GROSS_EXPOSURE:
            print(f"  [Paper] {sym} atlandı — brüt maruziyet tavanı (%{MAX_GROSS_EXPOSURE*100:.0f}) aşılırdı")
            continue
        if _open_position(state, sym, float(c["price"]), float(c["position_pct"]),
                          c.get("target"), c.get("stop"), float(c.get("conf") or 0.0)):
            opened += 1
    return opened


def snapshot_equity(state: dict, benchmark_price=None) -> None:
    """Döngü sonunda toplam equity + benchmark fotoğrafı çek."""
    now = datetime.datetime.utcnow().isoformat()
    equity   = _total_equity(state)
    invested = equity - state["cash"]

    if benchmark_price and state.get("benchmark_start") is None:
        state["benchmark_start"] = round(float(benchmark_price), 4)

    state["equity_history"].append({
        "t":         now[:19],
        "equity":    round(equity, 2),
        "cash":      round(state["cash"], 2),
        "invested":  round(invested, 2),
        "benchmark": round(float(benchmark_price), 4) if benchmark_price else None,
    })
    # Tavanı aş → en eskiyi at
    if len(state["equity_history"]) > MAX_EQUITY_HISTORY:
        state["equity_history"] = state["equity_history"][-MAX_EQUITY_HISTORY:]
    state["last_cycle"] = now


# ── Özet / API ───────────────────────────────────────────────────────────────
def get_summary(trades_limit: int = 100) -> dict:
    """Admin endpoint için tam portföy durumu + performans metrikleri."""
    with _LOCK:
        state = load_state()
        universe = get_universe()
        trades = _read_trades(limit=500)

    equity   = _total_equity(state)
    initial  = state.get("initial_capital", INITIAL_CAPITAL)
    total_ret = (equity - initial) / initial if initial else 0.0

    # Kapanan işlem istatistikleri
    closed = []
    for t in trades:
        try:
            closed.append({
                "entry_date":  t.get("entry_date", ""),
                "exit_date":   t.get("exit_date", ""),
                "symbol":      t.get("symbol", ""),
                "shares":      int(float(t.get("shares", 0) or 0)),
                "entry_price": float(t.get("entry_price", 0) or 0),
                "exit_price":  float(t.get("exit_price", 0) or 0),
                "net_pnl":     float(t.get("net_pnl", 0) or 0),
                "pnl_pct":     float(t.get("pnl_pct", 0) or 0),
                "exit_reason": t.get("exit_reason", ""),
                "hold_days":   float(t.get("hold_days", 0) or 0),
            })
        except Exception:
            continue

    n_closed = len(closed)
    wins     = [t for t in closed if t["net_pnl"] > 0]
    losses   = [t for t in closed if t["net_pnl"] <= 0]
    win_rate = (len(wins) / n_closed) if n_closed else None
    total_net_pnl = round(sum(t["net_pnl"] for t in closed), 2)
    avg_win  = round(sum(t["net_pnl"] for t in wins) / len(wins), 2) if wins else 0.0
    avg_loss = round(sum(t["net_pnl"] for t in losses) / len(losses), 2) if losses else 0.0
    gross_win  = sum(t["net_pnl"] for t in wins)
    gross_loss = abs(sum(t["net_pnl"] for t in losses))
    profit_factor = round(gross_win / gross_loss, 2) if gross_loss > 0 else None

    # Benchmark karşılaştırması
    bench_ret = None
    bstart = state.get("benchmark_start")
    hist = state.get("equity_history", [])
    if bstart and hist:
        last_bench = next((h["benchmark"] for h in reversed(hist) if h.get("benchmark")), None)
        if last_bench:
            bench_ret = (last_bench - bstart) / bstart

    # Açık pozisyonlar (güncel P&L ile)
    open_positions = []
    for sym, p in state["positions"].items():
        lp = p.get("last_price") or p["entry_price"]
        upnl = (lp - p["entry_price"]) * p["shares"]
        upnl_pct = (lp - p["entry_price"]) / p["entry_price"] if p["entry_price"] else 0.0
        open_positions.append({
            "symbol":       sym,
            "shares":       p["shares"],
            "entry_price":  p["entry_price"],
            "last_price":   lp,
            "target":       p.get("target"),
            "stop":         p.get("stop"),
            "entry_date":   p["entry_date"][:19],
            "hold_days":    round(_hold_days(p["entry_date"]), 1),
            "market_value": round(p["shares"] * lp, 2),
            "unrealized_pnl":     round(upnl, 2),
            "unrealized_pnl_pct": round(upnl_pct, 4),
            "entry_conf":   p.get("entry_conf"),
        })
    open_positions.sort(key=lambda x: -x["unrealized_pnl"])

    return {
        "initial_capital": initial,
        "cash":            round(state["cash"], 2),
        "equity":          round(equity, 2),
        "invested":        round(equity - state["cash"], 2),
        "total_return":    round(total_ret, 4),
        "total_net_pnl":   total_net_pnl,
        "open_count":      len(open_positions),
        "open_positions":  open_positions,
        "n_closed_trades": n_closed,
        "win_rate":        round(win_rate, 4) if win_rate is not None else None,
        "avg_win":         avg_win,
        "avg_loss":        avg_loss,
        "profit_factor":   profit_factor,
        "benchmark_return": round(bench_ret, 4) if bench_ret is not None else None,
        "universe":        universe,
        "equity_history":  hist[-trades_limit:] if False else hist,
        "closed_trades":   list(reversed(closed))[:trades_limit],
        "last_cycle":      state.get("last_cycle"),
        "created_at":      state.get("created_at"),
        "max_open":        MAX_OPEN_POSITIONS,
        "time_barrier_days": TIME_BARRIER_DAYS,
        "market_open":     is_market_open(),            # BIST şu an açık mı (seans + tatil gardı)
        "market_status":   market_closed_reason() or "Açık",  # kapalıysa nedeni (UI rozeti)
    }


def reset() -> dict:
    """Portföyü sıfırla — nakit 100k'ya döner, pozisyonlar/işlemler silinir."""
    with _LOCK:
        state = _new_state()
        save_state(state)
        try:
            TRADES_FILE.unlink(missing_ok=True)
        except Exception:
            pass
    print("[Paper] Portföy sıfırlandı.")
    return state
