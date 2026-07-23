"""
SerInvest — Piyasa Yorumu Motoru (kural-bazlı yerel sentez)
============================================================
Dört gerçek sinyal kaynağını gerekçeli Türkçe piyasa yorumuna dönüştürür:
  1. REJİM      — XU100 vs EMA200 (ml_live.market_regime) + endeks momentumu
  2. GENİŞLİK   — kaç hisse artıda/ekside (gün-içi open→close) + RSI dağılımı
  3. HACİM      — XU100 hacmi bugün vs 20 günlük ortalama (yfinance)
  4. HABER      — 24s duyarlılık/olay tipolojisi/jeopolitik (Faz 3 aggregate)
  + AI          — modelin kalibre AL sinyalleri özeti

Harici LLM YOK — deterministik kural + şablon sentezi (proje ilkesi).
Çıktı JSON: headline + paragraphs[{topic,text}] + stance{direction,confidence}
+ drivers/risks + disclaimer. 15 dk modül-içi cache (?refresh=1 ile bypass).

NOT: Bu bölüm otomatik piyasa DEĞERLENDİRMESİDİR, yatırım tavsiyesi değildir —
çıktının kendisi de bu uyarıyı taşır.
"""
import datetime
import threading

import yfinance as yf

import infra

# ── Cache ────────────────────────────────────────────────────────────────────
_CACHE: dict = {"ts": None, "payload": None}
_CACHE_TTL_MIN = 15
_LOCK = threading.Lock()

_MARKET_ENTITIES = ("BIST100", "GLOBAL")
_GEO_ENTITIES = ("BIST100", "GLOBAL", "FED")


# ═════════════════════════════════════════════════════════════════════════════
#  VERİ TOPLAMA
# ═════════════════════════════════════════════════════════════════════════════

def _breadth(assets: list) -> dict:
    """Gün-içi genişlik: artıda/ekside hisse oranı + RSI aşırılıkları."""
    bist = [a for a in assets if a.get("assetType") == "BIST"
            and a.get("close") is not None and a.get("open")]
    up = sum(1 for a in bist if a["close"] > a["open"])
    down = sum(1 for a in bist if a["close"] < a["open"])
    rsis = [a["rsi"] for a in bist if a.get("rsi") is not None]
    oversold = sum(1 for r in rsis if r < 30)
    overbought = sum(1 for r in rsis if r > 70)
    return {
        "n": len(bist), "up": up, "down": down,
        "up_pct": round(100 * up / len(bist)) if bist else 0,
        "oversold": oversold, "overbought": overbought,
        "avg_rsi": round(sum(rsis) / len(rsis), 1) if rsis else None,
    }


def _volume_context() -> dict:
    """XU100 hacmi: son işlem günü vs önceki 20 günün ortalaması."""
    out = {"ok": False}
    try:
        df = yf.download("XU100.IS", period="3mo", interval="1d",
                         auto_adjust=True, progress=False, threads=False)
        if df is None or len(df) < 25:
            return out
        vol = df["Volume"].squeeze().dropna()
        vol = vol[vol > 0]
        if len(vol) < 21:
            return out
        today, base = float(vol.iloc[-1]), float(vol.iloc[-21:-1].mean())
        close = df["Close"].squeeze().dropna()
        out.update(ok=True,
                   ratio=round(today / base, 2) if base else None,
                   chg_5d=round(100 * (float(close.iloc[-1]) / float(close.iloc[-6]) - 1), 2)
                          if len(close) >= 6 else None)
    except Exception as e:
        print(f"[commentary] hacim verisi alınamadı: {e}")
    return out


def _news_context() -> dict:
    """Faz 3 aggregate → piyasa ruh hali + olay/jeopolitik yoğunluğu."""
    rows = infra.api_get("/api/signals/aggregate?hours=24") or []
    by = {str(r.get("entity", "")).upper(): r for r in rows}
    mkt = [by[e] for e in _MARKET_ENTITIES if e in by]
    mood_raw = (sum(float(m.get("noveltyScore") or m.get("score") or 0) for m in mkt) / len(mkt)) if mkt else 0.0
    geo = sum(int(by[e].get("geoCount") or 0) for e in _GEO_ENTITIES if e in by)
    total = sum(int(r.get("count") or 0) for r in rows)
    pos_ev = sum(int(r.get("positiveEvents") or 0) for r in rows)
    neg_ev = sum(int(r.get("negativeEvents") or 0) for r in rows)
    # BIST hisseleri arasında en pozitif/negatif haber akışlı varlıklar
    stocks = [r for r in rows
              if r.get("assetType") == "BIST" and int(r.get("count") or 0) >= 2
              and str(r.get("entity", "")).upper() not in _MARKET_ENTITIES]
    stocks.sort(key=lambda r: float(r.get("noveltyScore") or r.get("score") or 0))
    return {
        "mood": round(((mood_raw + 1) / 2) * 100),   # 0-100
        "mood_raw": round(mood_raw, 3),
        "geo": geo, "total": total,
        "pos_events": pos_ev, "neg_events": neg_ev,
        "worst": stocks[0] if stocks else None,
        "best": stocks[-1] if stocks else None,
    }


def _ai_context(oracle_rows: list) -> dict:
    """Modelin güncel duruşu: sembol başına en yeni analiz → AL özeti."""
    latest: dict = {}
    for o in oracle_rows or []:
        s = o.get("symbol")
        if s and (s not in latest or (o.get("analyzedAt") or "") > (latest[s].get("analyzedAt") or "")):
            latest[s] = o
    buys = [o for o in latest.values() if "ALIM" in (o.get("recommendation") or "")]
    buys.sort(key=lambda o: -(o.get("confidence") or 0))
    return {
        "n": len(latest), "buys": len(buys),
        "buy_pct": round(100 * len(buys) / len(latest)) if latest else 0,
        "avg_conf": round(100 * sum(o.get("confidence") or 0 for o in buys) / len(buys)) if buys else None,
        "top": [o["symbol"] for o in buys[:3]],
    }


# ═════════════════════════════════════════════════════════════════════════════
#  SENTEZ (kural + şablon)
# ═════════════════════════════════════════════════════════════════════════════

def _compose(regime: dict, br: dict, volc: dict, news: dict, ai: dict) -> dict:
    drivers, risks, paragraphs = [], [], []

    # ── Duruş skoru: her kaynak −2..+2 katkı ──────────────────────────────────
    score = 0.0

    # 1) Rejim + endeks momentumu
    risk_on = regime.get("regime") == "RISK_ON"
    if regime.get("regime") == "RISK_ON":
        score += 1.5
        drivers.append("XU100, 200 günlük ortalamasının üzerinde (rejim: RISK-ON)")
    elif regime.get("regime") == "RISK_OFF":
        score -= 2.0
        risks.append("XU100, 200 günlük ortalamasının altında — düşen piyasa rejimi")
    chg5 = volc.get("chg_5d")
    if chg5 is not None:
        if chg5 > 1.5: score += 0.5
        elif chg5 < -1.5: score -= 0.5
    reg_txt = (
        f"Endeks tarafında {regime.get('detail', 'rejim verisi yok')}. "
        + (f"Son 5 işlem gününde XU100 %{abs(chg5):.1f} {'yükseldi' if chg5 >= 0 else 'geriledi'}. " if chg5 is not None else "")
        + ("Trend filtresi yeni alımlara izin veriyor." if risk_on
           else "Trend filtresi devrede: model düşen piyasada yeni alım açmaz, mevcut pozisyonlar bariyerle yönetilir."
           if regime.get("regime") == "RISK_OFF" else "")
    )
    paragraphs.append({"topic": "Piyasa Yönü & Rejim", "text": reg_txt.strip()})

    # 2) Genişlik + hacim
    upp = br["up_pct"]
    if upp >= 60: score += 1.0; drivers.append(f"Genişlik pozitif: hisselerin %{upp}'i günü artıda geçiriyor")
    elif upp <= 40: score -= 1.0; risks.append(f"Genişlik zayıf: hisselerin yalnızca %{upp}'i artıda")
    vr = volc.get("ratio")
    vol_txt = ""
    if vr is not None:
        if vr >= 1.3:
            vol_txt = f"Endeks hacmi 20 günlük ortalamasının %{round((vr-1)*100)} üzerinde — hareketin arkasında katılım var."
            score += 0.5 if upp >= 50 else -0.5
            (drivers if upp >= 50 else risks).append("Yüksek hacim mevcut yönü teyit ediyor")
        elif vr <= 0.7:
            vol_txt = f"Endeks hacmi ortalamanın %{round((1-vr)*100)} altında — katılım zayıf, hareketlerin kalıcılığı şüpheli."
            risks.append("Düşük hacim: sinyallerin teyidi zayıf")
        else:
            vol_txt = "Endeks hacmi 20 günlük ortalamasına yakın seyrediyor."
    ext = ""
    if br["oversold"] >= max(3, br["n"] // 10):
        ext = f" {br['oversold']} hisse aşırı satım bölgesinde (RSI<30) — tepki alımı potansiyeli izlenebilir."
    elif br["overbought"] >= max(3, br["n"] // 10):
        ext = f" {br['overbought']} hisse aşırı alım bölgesinde (RSI>70) — kâr satışı riski artıyor."
    paragraphs.append({
        "topic": "Genişlik & Hacim",
        "text": f"Takip edilen {br['n']} hissenin {br['up']}'i artıda, {br['down']}'i ekside "
                f"(ortalama RSI {br['avg_rsi']}). {vol_txt}{ext}".strip(),
    })

    # 3) Haber & duyarlılık (Faz 3 olay tipolojisi)
    mood = news["mood"]
    if mood >= 60: score += 0.8; drivers.append(f"Haber duyarlılığı iyimser ({mood}/100)")
    elif mood <= 40: score -= 0.8; risks.append(f"Haber duyarlılığı negatif ({mood}/100)")
    if news["geo"] >= 15:
        score -= 0.7
        risks.append(f"Son 24 saatte {news['geo']} jeopolitik başlık — manşet riski yüksek")
    news_txt = (
        f"Son 24 saatte {news['total']} haber işlendi; yenilik-ağırlıklı piyasa ruh hali {mood}/100 "
        f"({'iyimser' if mood >= 58 else 'temkinli' if mood > 42 else 'negatif'}). "
    )
    if news["geo"] >= 8:
        news_txt += f"Jeopolitik akış yoğun ({news['geo']} başlık) — ani fiyatlamalara açık ortam. "
    if news["pos_events"] or news["neg_events"]:
        news_txt += (f"Şirket olayları: {news['pos_events']} pozitif (temettü/geri alım/sözleşme) "
                     f"— {news['neg_events']} negatif (ceza/jeopolitik) etiketlendi. ")
    best, worst = news.get("best"), news.get("worst")
    if best and float(best.get("noveltyScore") or 0) > 0.25:
        news_txt += f"Haber akışı en güçlü lehte olan: {best['entity']}. "
    if worst and float(worst.get("noveltyScore") or 0) < -0.25:
        news_txt += f"En olumsuz akış: {worst['entity']}."
    paragraphs.append({"topic": "Haber Akışı & Duyarlılık", "text": news_txt.strip()})

    # 4) Modelin duruşu
    ai_txt = ""
    if ai["n"]:
        ai_txt = (f"Model {ai['n']} sembolün {ai['buys']}'inde (%{ai['buy_pct']}) alım sinyali taşıyor"
                  + (f"; kalibre ortalama güven %{ai['avg_conf']}" if ai["avg_conf"] else "") + ". ")
        if ai["top"]:
            ai_txt += f"En yüksek güvenli adaylar: {', '.join(ai['top'])}. "
        if ai["buy_pct"] >= 60:
            ai_txt += "Sinyal genişliği yüksek — teknik tablo evrenin genelinde benzer yönlü."
            score += 0.5
        elif ai["buy_pct"] <= 15:
            ai_txt += "Model büyük ölçüde kenarda (NÖTR) bekliyor."
    paragraphs.append({"topic": "Modelin Duruşu", "text": ai_txt.strip() or "Model analizi bekleniyor."})

    # ── Duruş → yön + güven ───────────────────────────────────────────────────
    if score >= 1.5: direction, dir_txt = "YUKARI", "yukarı yönlü"
    elif score <= -1.5: direction, dir_txt = "AŞAĞI", "aşağı yönlü"
    else: direction, dir_txt = "YATAY", "yatay/kararsız"
    confidence = "yüksek" if abs(score) >= 3 else "orta" if abs(score) >= 1.5 else "düşük"

    headline = (
        f"Kısa vadeli görünüm {dir_txt} ({confidence} güven): "
        + (drivers[0] if direction == "YUKARI" and drivers
           else risks[0] if direction == "AŞAĞI" and risks
           else "sinyaller karışık, teyit bekleniyor")
        + "."
    )

    return {
        "generated_at": datetime.datetime.utcnow().isoformat() + "Z",
        "headline": headline,
        "stance": {"direction": direction, "confidence": confidence,
                   "score": round(score, 2), "horizon": "1-2 hafta"},
        "paragraphs": paragraphs,
        "drivers": drivers[:4],
        "risks": risks[:4],
        "disclaimer": "Bu bölüm verilerden otomatik üretilen piyasa değerlendirmesidir; yatırım tavsiyesi değildir.",
    }


# ═════════════════════════════════════════════════════════════════════════════
#  GİRİŞ NOKTASI
# ═════════════════════════════════════════════════════════════════════════════

def build_commentary(force: bool = False) -> dict:
    """Yorumu üretir (15 dk cache). Veri kaynakları düşerse kısmi ama geçerli çıktı."""
    with _LOCK:
        now = datetime.datetime.utcnow()
        if (not force and _CACHE["payload"] is not None and _CACHE["ts"] is not None
                and (now - _CACHE["ts"]).total_seconds() < _CACHE_TTL_MIN * 60):
            return _CACHE["payload"]

    import ml_live   # döngüsel importu önlemek için fonksiyon içinde
    regime = ml_live.market_regime()
    assets = infra.api_get("/api/market/overview") or []
    oracle = infra.api_get("/api/oracle/overview") or []
    payload = _compose(regime, _breadth(assets), _volume_context(), _news_context(),
                       _ai_context(oracle))

    with _LOCK:
        _CACHE["ts"] = now
        _CACHE["payload"] = payload
    return payload
