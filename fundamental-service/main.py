"""
SerInvest Temel Analiz Servisi (Faz 2)
======================================
Tamamen yerel çalışır, harici AI API kullanmaz.

Neler yapar:
  1. yfinance ile BIST + emtia için temel verileri çeker
     (F/K, PD/DD, Özkaynak Karlılığı, Borç/Özkaynak, Büyüme, Temettü)
  2. KAP RSS ile son özel durum açıklamalarını takip eder
  3. Ağırlıklı puanlama ile 0–1 arası temel skor üretir
  4. Sonuçları RabbitMQ 'fundamental.data' kuyruğuna yayınlar
  5. Her 6 saatte bir döngü çalışır (temel veriler çeyreklik değişir)
"""

import os, json, time, datetime, math, xml.etree.ElementTree as ET
import pika
import requests
import yfinance as yf

RABBITMQ_HOST   = os.environ.get("RABBITMQ_HOST", "localhost")
CYCLE_HOURS     = int(os.environ.get("FUNDAMENTAL_CYCLE_HOURS", "6"))

# TCMB politika faizi — çeyreklik değişir; env var ile güncellenir.
# Kaynak: https://www.tcmb.gov.tr/wps/wcm/connect/EN/TCMB+EN/Main+Menu/Core+Functions/Monetary+Policy/Interest+Rates/
TCMB_RATE_PCT   = float(os.environ.get("TCMB_RATE_PCT", "42.5"))   # % cinsinden

# ── Sembol Listeleri ─────────────────────────────────────────────────────────
BIST_MAP = {
    "THYAO": "THYAO.IS", "GARAN": "GARAN.IS", "AKBNK": "AKBNK.IS",
    "EREGL": "EREGL.IS", "SISE":  "SISE.IS",  "KCHOL": "KCHOL.IS",
    "ARCLK": "ARCLK.IS", "BIMAS": "BIMAS.IS", "ASELS": "ASELS.IS",
    "FROTO": "FROTO.IS", "TUPRS": "TUPRS.IS",  "SASA":  "SASA.IS",
    "SAHOL": "SAHOL.IS", "TTKOM": "TTKOM.IS",  "TCELL": "TCELL.IS",
    "PGSUS": "PGSUS.IS", "MGROS": "MGROS.IS",  "HALKB": "HALKB.IS",
    "VAKBN": "VAKBN.IS", "YKBNK": "YKBNK.IS",  "PETKM": "PETKM.IS",
    "EKGYO": "EKGYO.IS", "ISCTR": "ISCTR.IS",  "TOASO": "TOASO.IS",
    "VESTL": "VESTL.IS",
}
COMMODITY_MAP = {"XAUUSD": "GC=F", "XAGUSD": "SI=F", "BRENTOIL": "BZ=F"}
ALL_SYMBOLS   = {**BIST_MAP, **COMMODITY_MAP}


# ── Yardımcı ─────────────────────────────────────────────────────────────────

def safe(val, default=None):
    try:
        if val is None:
            return default
        f = float(val)
        return default if (math.isnan(f) or math.isinf(f)) else f
    except Exception:
        return default


# ── Puanlama Fonksiyonları ────────────────────────────────────────────────────

def _score_pe(pe):
    """Düşük F/K daha iyi (değer yatırımı). Negatif F/K zararı işaret eder."""
    if pe is None or pe <= 0:
        return -1   # Zarar eden ya da anlamsız
    if pe < 8:   return 2   # Çok ucuz
    if pe < 15:  return 1   # Ucuz
    if pe < 25:  return 0   # Makul
    if pe < 40:  return -1  # Pahalı
    return -2               # Çok pahalı


def _score_pb(pb):
    """PD/DD < 1 şirket defter değerinin altında işlem görüyor."""
    if pb is None or pb <= 0:
        return 0
    if pb < 1:   return 2
    if pb < 2:   return 1
    if pb < 4:   return 0
    return -1


def _score_roe(roe):
    """Yüksek özkaynak karlılığı güçlü şirketi işaret eder."""
    if roe is None:
        return 0
    if roe > 0.30:  return 2
    if roe > 0.15:  return 1
    if roe > 0.05:  return 0
    if roe > 0:     return -1
    return -2


def _score_de(de):
    """Düşük borç/özkaynak daha az finansal risk demektir."""
    if de is None:
        return 0
    if de < 0.3:  return 2
    if de < 0.8:  return 1
    if de < 1.5:  return 0
    if de < 3.0:  return -1
    return -2


def _score_growth(g):
    """Gelir/kazanç büyümesi büyüme potansiyelini gösterir."""
    if g is None:
        return 0
    if g > 0.40:  return 2
    if g > 0.15:  return 1
    if g > 0.02:  return 0
    if g > -0.10: return -1
    return -2


def _score_dividend(dy):
    """Yüksek temettü getirisi değer yatırımcısı için olumludur."""
    if dy is None or dy <= 0:
        return 0
    if dy > 0.07:  return 2
    if dy > 0.04:  return 1
    if dy > 0.02:  return 0
    return 0


def _score_net_debt_ebitda(ratio):
    """Net Borç / FAVÖK — ne kadar düşükse o kadar iyi."""
    if ratio is None:
        return 0
    if ratio < 0:    return 2   # Net nakit pozisyonu — mükemmel
    if ratio < 1.0:  return 1
    if ratio < 2.5:  return 0
    if ratio < 4.0:  return -1
    return -2


def _score_ebitda_margin(margin):
    """FAVÖK Marjı — yüksek marj = güçlü operasyonel karlılık."""
    if margin is None:
        return 0
    if margin > 0.30:  return 2
    if margin > 0.15:  return 1
    if margin > 0.05:  return 0
    if margin > 0:     return -1
    return -2


def compute_fundamental_score(pe, pb, roe, de, rev_growth, earn_growth, div_yield,
                               net_debt_ebitda=None, ebitda_margin=None) -> float:
    """
    Ağırlıklı temel skor (0–1 arası).
    0.5 nötr, > 0.5 olumlu, < 0.5 olumsuz.
    """
    # Ağırlıklar: değerleme en önemli, FAVÖK karlılık, sonra diğerleri
    weighted = (
        _score_pe(pe)                            * 3.0 +
        _score_pb(pb)                            * 2.0 +
        _score_roe(roe)                          * 2.5 +
        _score_de(de)                            * 1.5 +
        _score_growth(rev_growth)                * 1.0 +
        _score_growth(earn_growth)               * 1.0 +
        _score_dividend(div_yield)               * 0.5 +
        _score_net_debt_ebitda(net_debt_ebitda)  * 2.0 +  # FAVÖK bazlı borçluluk
        _score_ebitda_margin(ebitda_margin)      * 1.5    # Operasyonel karlılık
    )
    # Toplam ağırlık: 3+2+2.5+1.5+1+1+0.5+2+1.5 = 15
    # Max: 2×15=30, Min: ≈ -2×(15-0.5)=-29 (temettü min 0)
    total_weight = 3.0 + 2.0 + 2.5 + 1.5 + 1.0 + 1.0 + 0.5 + 2.0 + 1.5  # = 15.5
    max_score    = 2 * total_weight
    min_score    = -2 * (total_weight - 0.5)

    score = (weighted - min_score) / (max_score - min_score)
    return round(max(0.0, min(1.0, score)), 4)


# ── KAP RSS ───────────────────────────────────────────────────────────────────

def fetch_kap_last_disclosure(symbol: str) -> tuple[str, str]:
    """KAP RSS'den son özel durum açıklamasını çeker."""
    try:
        url = f"https://www.kap.org.tr/rss/bildirim/{symbol}"
        resp = requests.get(url, timeout=8, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
        })
        if resp.status_code != 200:
            return "", ""

        root    = ET.fromstring(resp.content)
        channel = root.find("channel")
        if channel is None:
            return "", ""

        item = channel.find("item")
        if item is None:
            return "", ""

        title   = (item.findtext("title", "") or "").strip()[:250]
        pubdate = (item.findtext("pubDate", "") or "").strip()[:50]
        return title, pubdate

    except Exception:
        return "", ""


# ── Temel Veri Çekme ─────────────────────────────────────────────────────────

def fetch_fundamentals(symbol: str, yf_sym: str) -> dict | None:
    """yfinance + KAP ile bir sembol için temel analiz verileri üretir."""
    try:
        ticker = yf.Ticker(yf_sym)
        info   = ticker.info or {}

        # Ham değerler
        pe       = safe(info.get("trailingPE"))
        fwd_pe   = safe(info.get("forwardPE"))
        pb       = safe(info.get("priceToBook"))
        roe      = safe(info.get("returnOnEquity"))   # oran (0.15 = %15)
        de       = safe(info.get("debtToEquity"))
        # yfinance BIST için debtToEquity bazen 100x döndürür
        if de is not None and de > 20:
            de /= 100

        rev_g    = safe(info.get("revenueGrowth"))    # oran (0.20 = %20)
        earn_g   = safe(info.get("earningsGrowth"))
        div_y    = safe(info.get("dividendYield"))
        mkt_cap  = safe(info.get("marketCap"))
        beta     = safe(info.get("beta"))
        fw52h    = safe(info.get("fiftyTwoWeekHigh"))
        fw52l    = safe(info.get("fiftyTwoWeekLow"))
        cur_p    = safe(info.get("currentPrice") or info.get("regularMarketPrice"))
        eps      = safe(info.get("trailingEps"))
        fwd_eps  = safe(info.get("forwardEps"))
        sector   = str(info.get("sector", "") or "")[:100]
        name     = str(info.get("longName", "") or "")[:100]

        # FAVÖK / EBITDA değerleri
        ebitda       = safe(info.get("ebitda"))
        total_rev    = safe(info.get("totalRevenue"))
        total_debt   = safe(info.get("totalDebt"))
        cash         = safe(info.get("cashAndCashEquivalents") or info.get("totalCash"))

        # FAVÖK Marjı
        ebitda_margin = round(ebitda / total_rev, 4) if ebitda and total_rev and total_rev > 0 else None

        # Net Borç / FAVÖK (Net Debt = Toplam Borç - Nakit)
        net_debt = None
        net_debt_ebitda = None
        if total_debt is not None and cash is not None:
            net_debt = total_debt - cash
        elif total_debt is not None:
            net_debt = total_debt
        if net_debt is not None and ebitda and ebitda > 0:
            net_debt_ebitda = round(net_debt / ebitda, 2)

        # 52 haftalık konum (0 = dip, 1 = tepe)
        pos52w = None
        if fw52h and fw52l and cur_p and (fw52h - fw52l) > 0:
            pos52w = round((cur_p - fw52l) / (fw52h - fw52l), 4)

        # Temel skor (FAVÖK verileriyle güçlendirildi)
        fscore = compute_fundamental_score(
            pe, pb, roe, de, rev_g, earn_g, div_y,
            net_debt_ebitda=net_debt_ebitda,
            ebitda_margin=ebitda_margin,
        )

        # KAP (yalnızca BIST hisseleri için)
        kap_title, kap_date = "", ""
        if yf_sym.endswith(".IS"):
            kap_title, kap_date = fetch_kap_last_disclosure(symbol)

        is_bist = yf_sym.endswith(".IS")
        return {
            "symbol":            symbol,
            "asset_type":        "BIST" if is_bist else "COMMODITY",
            "company_name":      name,
            "sector":            sector,
            # Değerleme
            "pe_ratio":           round(pe, 2)          if pe             else None,
            "forward_pe":         round(fwd_pe, 2)       if fwd_pe         else None,
            "pb_ratio":           round(pb, 2)           if pb             else None,
            # Karlılık
            "roe":                round(roe, 4)          if roe            else None,
            "eps":                round(eps, 4)          if eps            else None,
            "forward_eps":        round(fwd_eps, 4)      if fwd_eps        else None,
            # FAVÖK / Operasyonel Karlılık (kritik BİST metriği)
            "ebitda":             ebitda,
            "ebitda_margin":      ebitda_margin,
            "net_debt_ebitda":    net_debt_ebitda,
            # Risk
            "debt_to_equity":     round(de, 4)           if de             else None,
            "beta":               round(beta, 3)         if beta           else None,
            # Büyüme
            "revenue_growth":     round(rev_g, 4)        if rev_g          else None,
            "earnings_growth":    round(earn_g, 4)       if earn_g         else None,
            # Temettü & Piyasa
            "dividend_yield":     round(div_y, 4)        if div_y          else None,
            "market_cap":         mkt_cap,
            "position_52w":       pos52w,
            # Makro Bağlam
            "tcmb_rate_pct":      TCMB_RATE_PCT,
            # Özet Skor
            "fundamental_score":  fscore,
            # KAP
            "last_kap_title":     kap_title,
            "last_kap_date":      kap_date,
            "updated_at":         datetime.datetime.utcnow().isoformat(),
        }

    except Exception as e:
        print(f"  [{symbol}] yfinance hatası: {e}")
        return None


# ── Ana Döngü ─────────────────────────────────────────────────────────────────

def run_cycle(channel) -> None:
    ts = datetime.datetime.now().strftime("%H:%M:%S")
    print(f"\n{'─' * 55}")
    print(f"  Temel Analiz Döngüsü — {ts}")
    print(f"{'─' * 55}")

    success = 0

    for symbol, yf_sym in ALL_SYMBOLS.items():
        data = fetch_fundamentals(symbol, yf_sym)

        if data:
            channel.basic_publish(
                exchange="",
                routing_key="fundamental.data",
                body=json.dumps(data, ensure_ascii=False),
                properties=pika.BasicProperties(
                    delivery_mode=2,
                    content_type="application/json",
                ),
            )
            pe_str    = f"F/K={data['pe_ratio']:.1f}" if data["pe_ratio"] else "F/K=—"
            roe_str   = f"ROE={data['roe']*100:.0f}%" if data["roe"] else "ROE=—"
            nd_str    = f"ND/FAVÖK={data['net_debt_ebitda']:.1f}x" if data.get("net_debt_ebitda") is not None else ""
            score_str = f"skor={data['fundamental_score']:.2f}"
            kap_str   = f" | KAP: {data['last_kap_title'][:35]}..." if data["last_kap_title"] else ""
            print(f"  {symbol:<10} {pe_str:<10} {roe_str:<9} {nd_str:<16} {score_str}{kap_str}")
            success += 1

        # yfinance rate limiting — BIST için daha az bekle (Nasdaq'a göre daha az istek var)
        time.sleep(1.2)

    print(f"\n  {success}/{len(ALL_SYMBOLS)} varlık analiz edildi.")


# ── RabbitMQ Bağlantısı ───────────────────────────────────────────────────────

def connect_rabbitmq() -> pika.BlockingConnection:
    host = RABBITMQ_HOST
    for attempt in range(15):
        try:
            conn = pika.BlockingConnection(
                pika.ConnectionParameters(
                    host=host,
                    heartbeat=600,
                    blocked_connection_timeout=300,
                )
            )
            print(f"RabbitMQ bağlantısı kuruldu: {host}")
            return conn
        except pika.exceptions.AMQPConnectionError:
            print(f"RabbitMQ hazır değil ({attempt + 1}/15)...")
            time.sleep(5)
    raise RuntimeError("RabbitMQ'ya bağlanılamadı")


# ── Giriş Noktası ─────────────────────────────────────────────────────────────

def main():
    print("SerInvest Temel Analiz Servisi başlatılıyor (Faz 2)...")
    # Diğer servislerin başlamasını bekle
    time.sleep(20)

    conn    = connect_rabbitmq()
    channel = conn.channel()
    channel.queue_declare(queue="fundamental.data", durable=True)

    try:
        while True:
            run_cycle(channel)
            print(f"\nSonraki temel analiz döngüsü {CYCLE_HOURS} saat sonra...")
            time.sleep(CYCLE_HOURS * 3600)
    except KeyboardInterrupt:
        print("Durduruluyor...")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
