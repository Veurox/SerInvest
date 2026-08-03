"""
SerInvest ML v3 — Canlı Katman (Faz 6 Entegrasyonu)
====================================================
Temiz `ml/` paketini canlıya bağlar. Eski sistemin hastalıkları burada YOK:
  • Saf teknik tek model (champion) — füzyon/haber/temel/makro/meta-learner YOK.
  • Hedef/stop EĞİTİMLE AYNI 10g triple-barrier'dan (TP=3×ATR, SL=2×ATR) →
    train/serve tutarlı, gösterilen R:R (1.5) modelin gerçek tanımı.
  • Değerlendirme de AYNI 10g triple-barrier → backtest/canlı metrik tutarlı.
  • Körü körüne retrain YOK: model donuk; yalnızca KORUMALI şampiyon-rakip
    (challenger, bağımsız pencerede şampiyonu net geçerse terfi) ile değişir.

Long-only "kazandıran hisse" mantığı: karar AL / NÖTR (SELL yok).
Akış: champion → her BIST-50 sembolü için P(yukarı) → AL/NÖTR → publish + paper.
"""
import csv
import datetime
import json
import time

import joblib
import numpy as np
import pandas as pd
import pika
import yfinance as yf

from ml.config import (
    BUY_THRESHOLD,
    CHAMPION_FILE,
    EVAL_MIN_AGE_DAYS,
    FEATURE_NAMES,
    HISTORY_PERIOD,
    HORIZON,
    META_FILE,
    ML_DIR,
    PREDICTION_LOG,
    PROMOTE_MIN_EDGE,
    PROMOTE_MIN_FRESH_DAYS,
    PROMOTE_MIN_PRECISION,
    PROMOTE_MIN_SAMPLES,
    PROMOTE_MIN_WINDOW_DAYS,
    PROMOTION_LOG,
    REGIME_EMA_SPAN,
    REGIME_FILTER,
    SIZE_P_FULL,
    SL_ATR_MULT,
    STRONG_BUY_P,
    TP_ATR_MULT,
    TRAIN_CACHE,
    TRANSACTION_COST_PCT,
    XSEC_RANK,
)
import ml.atomic as atomic
from ml.calibration import calibrate, expected_R, kelly_size, load_calibrator
from ml.config import EV_FILTER, META_VETO_P, PROMOTE_WINDOWS
import ml.meta as meta
import ml.monitoring as monitoring
from ml.features import compute_features, fetch_context, xsec_rank_frame, xsec_rank_latest
from ml.labels import clamp_atr_pct, triple_barrier_label
from ml.model import feature_importance, train_model
from ml.universe import load_universe

import infra
import paper_trading
from infra import send_syslog

# ── Sabitler ─────────────────────────────────────────────────────────────────
ML_STATS_FILE = ML_DIR / "live_accuracy.json"   # 10g canlı doğruluk özeti
MAX_POSITION_PCT = 0.10 # tek pozisyon tavanı

# Açıklamalar için Türkçe özellik etiketleri (21 saf teknik)
FEAT_TR = {
    "rsi": "RSI", "rsi_slope": "RSI eğimi",
    "macd_hist": "MACD histogram", "macd_hist_slope": "MACD ivmesi",
    "bb_pct": "Bollinger pozisyonu", "bb_width": "Bollinger genişliği",
    "ema9_diff": "EMA9-EMA20 farkı", "ema20_diff": "EMA20-EMA50 farkı",
    "ema_alignment": "EMA hizalanması", "above_ema200": "EMA200 üstü",
    "ema200_trend": "EMA200 eğimi", "dist_ema50_z": "EMA50 z-uzaklık",
    "ret_5d": "5g getiri", "ret_20d": "20g getiri", "ret_consistency": "Getiri tutarlılığı",
    "vol_ratio": "Hacim oranı", "atr_pct": "Volatilite (ATR%)",
    "price_vs_52w_high": "52H zirveye uzaklık",
    "rel_strength_5d": "5g göreli güç", "rel_strength_20d": "20g göreli güç",
    "usdtry_ret5": "USDTRY 5g",
}


# ═════════════════════════════════════════════════════════════════════════════
#  CHAMPION YAŞAM DÖNGÜSÜ
# ═════════════════════════════════════════════════════════════════════════════

def load_champion():
    """champion.joblib varsa yükler, yoksa None."""
    if CHAMPION_FILE.exists():
        try:
            return joblib.load(CHAMPION_FILE)
        except Exception as e:
            print(f"[ml_live] champion yüklenemedi: {e}")
    return None


def _load_training_data(rebuild: bool = False) -> pd.DataFrame:
    """Önbellekten yükle; yoksa veya rebuild ise BIST-50 veri setini kur."""
    if not rebuild and TRAIN_CACHE.exists():
        return pd.read_csv(TRAIN_CACHE, parse_dates=["date"])
    from ml.dataset import build_dataset
    ML_DIR.mkdir(parents=True, exist_ok=True)
    data = build_dataset(period=HISTORY_PERIOD, verbose=True)
    data.to_csv(TRAIN_CACHE, index=False)
    return data


def prepare_training(data: pd.DataFrame) -> pd.DataFrame:
    """
    Eğitim/doğrulama öncesi özellik dönüşümü. Cache HAM mutlak değerleri tutar
    (deneyler için); XSEC_RANK açıkken burada gün-içi kesitsel rank'e çevrilir.
    Canlı çıkarım xsec_rank_latest ile AYNI dönüşümü uygular.
    """
    if XSEC_RANK:
        return xsec_rank_frame(data)
    return data


def _write_meta(model, data: pd.DataFrame, extra: dict | None = None):
    imp = feature_importance(model)[:8]
    meta = {
        "trained_at":   datetime.datetime.utcnow().isoformat(),
        "n_rows":       int(len(data)),
        "up_pct":       round(100 * float((data["label"] == 1).mean()), 1),
        "date_min":     str(pd.to_datetime(data["date"]).min().date()),
        "date_max":     str(pd.to_datetime(data["date"]).max().date()),
        "horizon":      HORIZON,
        "buy_threshold": BUY_THRESHOLD,
        "tp_atr_mult":  TP_ATR_MULT,
        "sl_atr_mult":  SL_ATR_MULT,
        "xsec_rank":    XSEC_RANK,   # özellikler gün-içi kesitsel percentile mi?
        "top_features": [{"name": n, "pct": p} for n, p in imp],
    }
    if extra:
        meta.update(extra)
    META_FILE.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")


def train_champion(rebuild_data: bool = False):
    """Tüm veri setiyle champion'ı eğitir ve kaydeder."""
    data = prepare_training(_load_training_data(rebuild_data))
    model = train_model(data[FEATURE_NAMES], data["label"].astype(int), enforce_min=True)
    if model is None:
        send_syslog("[ml v3] Champion eğitilemedi (yetersiz/tek-sınıf veri).", "ERROR")
        return None
    ML_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, CHAMPION_FILE)
    _write_meta(model, data)
    send_syslog(f"[ml v3] Champion eğitildi ve kaydedildi ({len(data):,} satır, 10g ufuk).", "SUCCESS")
    return model


def load_or_train_champion():
    """Boot: champion varsa yükle, yoksa eğit."""
    m = load_champion()
    if m is not None:
        send_syslog("✓ Champion model yüklendi (ml v3 — saf teknik, 10g).", "INFO")
        return m
    send_syslog("[ml v3] Champion bulunamadı — sıfırdan eğitiliyor...", "TRAINING")
    return train_champion()


def champion_meta() -> dict:
    if META_FILE.exists():
        try:
            return json.loads(META_FILE.read_text())
        except Exception:
            pass
    return {}


# ═════════════════════════════════════════════════════════════════════════════
#  ÇIKARIM (tek sembol)
# ═════════════════════════════════════════════════════════════════════════════

def _predict_p_up(model, feat: dict):
    """P(yukarı) + besleme matrisi (açıklama için)."""
    X = pd.DataFrame([[feat.get(f, 0.0) for f in FEATURE_NAMES]], columns=FEATURE_NAMES)
    p = float(model.predict_proba(X)[0][1])
    return p, X


def _rec_from_p(p: float) -> tuple[str, str]:
    """P(yukarı) → (öneri, yön). Long-only: SELL yok."""
    if p >= STRONG_BUY_P:
        return "GÜÇLÜ ALIM", "BUY"
    if p >= BUY_THRESHOLD:
        return "ALIM", "BUY"
    return "NÖTR", "NEUTRAL"


def _targets(close: float, atr_pct: float | None) -> tuple[float, float, float]:
    """EĞİTİMLE AYNI triple-barrier: TP=3×ATR, SL=2×ATR → R:R sabit 1.5."""
    ap = clamp_atr_pct(atr_pct)
    tp = round(close * (1 + TP_ATR_MULT * ap), 2)
    sl = round(close * (1 - SL_ATR_MULT * ap), 2)
    rr = round(TP_ATR_MULT / SL_ATR_MULT, 2)
    return tp, sl, rr


def _position_size(p: float, p_cal: float | None = None) -> float:
    """
    AL için pozisyon boyutu; eşik altı 0. Tek pozisyon tavanı %10.

    Faz 2 (07/2026): kalibratör varsa kesirli Kelly (p_cal ile) — boyut artık
    gerçek olasılığa oranlı. Kalibratör yoksa eski doğrusal rampa (fallback):
    [BUY_THRESHOLD → SIZE_P_FULL]; kalibre edilmemiş LGBM canlıda 0.70+
    üretmediği için eski 0.90 tavanı fiilen %1'lik pozisyonlar doğuruyordu
    (paper portföy %95 nakit kalıyordu — 06/2026 denetim bulgusu).
    """
    if p < BUY_THRESHOLD:
        return 0.0
    if p_cal is not None:
        return kelly_size(p_cal, MAX_POSITION_PCT)
    frac = (p - BUY_THRESHOLD) / (SIZE_P_FULL - BUY_THRESHOLD)
    return round(min(1.0, max(0.0, frac)) * MAX_POSITION_PCT, 4)


def market_regime() -> dict:
    """
    Piyasa rejim kapısı: XU100 kapanışı EMA200'ün altındaysa RISK_OFF —
    yeni AL sinyalleri askıya alınır (mevcut pozisyonlar bariyerle yönetilir).
    Veri alınamazsa UNKNOWN → kapı uygulanmaz (fail-open: sistem donmasın).
    """
    if not REGIME_FILTER:
        return {"regime": "OFF", "detail": "rejim filtresi kapalı"}
    try:
        df = yf.download("XU100.IS", period="2y", interval="1d",
                         auto_adjust=True, progress=False, threads=False)
        if df is None or len(df) < REGIME_EMA_SPAN + 10:
            return {"regime": "UNKNOWN", "detail": "XU100 verisi yetersiz"}
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.droplevel(1)
        close = df["Close"].squeeze().dropna()
        ema = close.ewm(span=REGIME_EMA_SPAN, adjust=False).mean()
        last, e = float(close.iloc[-1]), float(ema.iloc[-1])
        risk_on = last >= e
        return {
            "regime": "RISK_ON" if risk_on else "RISK_OFF",
            "xu100": round(last, 2), "ema": round(e, 2),
            "detail": f"XU100 {last:,.0f} {'≥' if risk_on else '<'} EMA{REGIME_EMA_SPAN} {e:,.0f}",
        }
    except Exception as ex:
        return {"regime": "UNKNOWN", "detail": f"rejim hesaplanamadı: {ex}"}


def _explain(model, X: pd.DataFrame, feat: dict) -> tuple[list, list]:
    """Bu tahmin için en etkili 3 özellik (LightGBM pred_contrib) → drivers/risks."""
    pairs = []
    try:
        contrib = model.booster_.predict(X.values, pred_contrib=True)[0]
        pairs = sorted(
            zip(FEATURE_NAMES, [float(c) for c in contrib[:len(FEATURE_NAMES)]]),
            key=lambda t: -abs(t[1]),
        )[:3]
    except Exception:
        pairs = [(n, 0.0) for n, _ in feature_importance(model)[:3]]

    drivers, risks = [], []
    for name, c in pairs:
        tr  = FEAT_TR.get(name, name)
        val = feat.get(name)
        try:
            vs = f"{float(val):.2f}"
        except Exception:
            vs = str(val)
        yon = "yukarı" if c >= 0 else "aşağı"
        txt = f"{tr}: {vs} (model etkisi {'+' if c >= 0 else '−'}{abs(c):.2f}, {yon} yönde)"
        (drivers if c >= 0 else risks).append(txt)
    return drivers, risks


def fetch_snapshot(sym: str, yf_sym: str, ctx: pd.DataFrame):
    """
    Sembol için OHLCV indir + son HAM özellik satırı.
    Döndürür: (df, raw_feat_dict, close) veya None.
    """
    df = yf.download(yf_sym, period="1y", interval="1d",
                     auto_adjust=True, progress=False, threads=False)
    if df is None or len(df) < 60:
        return None
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.droplevel(1)
    feat_df = compute_features(df, ctx=ctx)
    feat = feat_df.iloc[-1].to_dict()
    close_s = df["Close"].squeeze().dropna()
    if len(close_s) == 0:
        return None
    return df, feat, float(close_s.iloc[-1])


def analyze_symbol(model, sym: str, yf_sym: str, snap: tuple,
                   model_feat: dict | None = None,
                   live_acc: float = 0.0, regime: dict | None = None,
                   cal=None, news_map: dict | None = None, meta_model=None):
    """
    Karar + mesaj üretimi. snap = fetch_snapshot çıktısı (df, ham_feat, close).
    model_feat: MODELE giren özellikler (XSEC_RANK'te günün kesitsel rank'i);
    None ise ham özellikler kullanılır. Hedef/stop HER ZAMAN ham atr_pct ile
    hesaplanır (percentile ATR ile bariyer hesaplamak anlamsız olur).
    regime RISK_OFF ise AL sinyalleri NÖTR'e indirgenir (yeni pozisyon açılmaz).

    Faz 2: cal = isotonic kalibratör (yoksa kimlik). KARAR ham p ile verilir
    (champion davranışı değişmez); kalibre p → EV filtresi + Kelly boyut + güven.
    """
    df, feat, close = snap

    p, X = _predict_p_up(model, model_feat if model_feat is not None else feat)
    rec, rec_dir = _rec_from_p(p)

    # ── Faz 2: kalibre olasılık + beklenen değer (ATR birimi) ──────────────────
    p_cal = calibrate(p, cal)
    ev = expected_R(p_cal)

    # ── Rejim kapısı: düşen piyasada (XU100 < EMA200) yeni AL açılmaz ──────────
    gated = False
    if regime is not None and regime.get("regime") == "RISK_OFF" and rec_dir == "BUY":
        gated = True
        rec, rec_dir = "NÖTR", "NEUTRAL"

    # ── Faz 2: EV kapısı — kalibre beklenen değer ≤ 0 ise AL iptal ─────────────
    # Yalnızca gerçek kalibratörle uygulanır (kimlik fallback'te p_cal=p ham
    # olasılıktır; onunla EV kapısı kurmak eşik mantığını bozar).
    ev_gated = False
    if EV_FILTER and cal is not None and rec_dir == "BUY" and ev <= 0:
        ev_gated = True
        rec, rec_dir = "NÖTR", "NEUTRAL"

    atr_pct = feat.get("atr_pct")

    # ── Faz 3: Meta-labeling — haber/rejim özellikleri SADECE bu katmandan ─────
    # Her ham-AL sinyalinin meta-özellikleri KARAR ANINDA loglanır (as-of disiplini;
    # rejim/EV kapısına takılanlar dahil — eğitim verisi kapıdan bağımsız birikir).
    # Meta-model canlıdaysa: p_meta < META_VETO_P → AL veto; değilse boyut çarpanı.
    pm = None
    meta_gated = False
    meta_feats = None
    if p >= BUY_THRESHOLD and news_map is not None:
        try:
            meta_feats = meta.build_features(sym, p, clamp_atr_pct(atr_pct), news_map, regime)
            meta.log_meta_row(sym, meta_feats)
        except Exception as e:
            print(f"  [meta] {sym} özellik/log hatası: {e}")
    if meta_model is not None and meta_feats is not None and rec_dir == "BUY":
        pm = meta.p_meta(meta_model, meta_feats)
        if pm < META_VETO_P:
            meta_gated = True
            rec, rec_dir = "NÖTR", "NEUTRAL"

    is_buy = rec_dir == "BUY"
    tp, sl, rr = _targets(close, atr_pct)
    pos = _position_size(p, p_cal if cal is not None else None) if is_buy else 0.0
    if is_buy and pos > 0 and pm is not None:
        pos = round(pos * meta.size_multiplier(pm), 4)
    drivers, risks = _explain(model, X, feat)

    bias = "YÜKSELİŞ" if is_buy else "YATAY"
    conf_word = "yüksek" if p >= 0.66 else "orta" if p >= 0.55 else "düşük"
    reasoning = (
        f"Saf teknik model, 10 işlem-günü ufkunda yukarı (TP'ye SL'den önce değme) "
        f"olasılığını %{p*100:.0f} ({conf_word}) hesapladı → {rec}."
    )
    if cal is not None:
        reasoning += (
            f" Kalibre olasılık %{p_cal*100:.0f}, işlem başına beklenen değer "
            f"{ev:+.2f}R (maliyet dahil)."
        )
    if gated:
        reasoning += (
            f" Model sinyali ALIM'dı; rejim kapısı nedeniyle askıda "
            f"({regime.get('detail', 'XU100 EMA200 altında')})."
        )
        risks = [f"Rejim: {regime.get('detail', 'XU100 EMA200 altında')} — düşen piyasada yeni alım askıda"] + (risks or [])
    if ev_gated:
        reasoning += (
            f" Model sinyali ALIM'dı; EV kapısı iptal etti (kalibre %{p_cal*100:.0f} "
            f"olasılıkla beklenen değer {ev:+.2f}R ≤ 0 — maliyet sonrası kazanç beklenmiyor)."
        )
        risks = [f"EV kapısı: kalibre olasılık %{p_cal*100:.0f} → beklenen değer {ev:+.2f}R ≤ 0"] + (risks or [])
    if pm is not None and not meta_gated and is_buy:
        reasoning += f" Meta-model (haber/rejim) güveni %{pm*100:.0f} → boyut ×{meta.size_multiplier(pm):.2f}."
    if meta_gated:
        reasoning += (
            f" Model sinyali ALIM'dı; meta-model veto etti (haber/rejim bağlamında "
            f"başarı olasılığı %{pm*100:.0f} < %{META_VETO_P*100:.0f})."
        )
        risks = [f"Meta veto: haber/rejim bağlamında P(başarı) %{pm*100:.0f} — eşik altı"] + (risks or [])
    watches = [
        f"Hedef {tp} / Stop {sl} (10g triple-barrier, R:R {rr})",
        "Saf teknik sinyal — haber/temel/makro karışımı yok.",
    ]
    if live_acc > 0:
        watches.append(f"Model AL isabeti (10g, canlı): {live_acc:.1%}")
    if not is_buy:
        watches.append("Eşik altı (NÖTR) — pozisyon açılmaz, mevcut pozisyonlar bariyerle yönetilir.")

    msg = {
        "symbol":            sym,
        "asset_type":        "BIST",
        "price_at_analysis": close,
        "recommendation":    rec,
        # Faz 2: kullanıcıya KALİBRE olasılık gösterilir (dürüst güven);
        # kalibratör yoksa p_cal = p (kimlik).
        "confidence":        round(p_cal, 4),
        "short_term_bias":   bias,
        "short_term_target": tp if is_buy else None,
        "short_term_stop":   sl if is_buy else None,
        "position_size_pct": pos,
        "risk_reward_ratio": rr if is_buy else None,
        "long_term_bias":    bias,
        "long_term_target":  round(close * (1 + 2 * TP_ATR_MULT * clamp_atr_pct(atr_pct)), 2) if is_buy else None,
        "reasoning":         reasoning,
        "key_drivers":       json.dumps(drivers or ["Teknik göstergeler nötr"], ensure_ascii=False),
        "risks":             json.dumps(risks or ["Belirgin aşağı-yön sürücüsü yok"], ensure_ascii=False),
        "watch_points":      json.dumps(watches, ensure_ascii=False),
        # Saf teknik sistem: yalnız technical_score anlamlı; diğerleri nötr (kullanılmıyor).
        "technical_score":   round(p, 4),
        "news_score":        0.5,
        "macro_score":       0.5,
        "fundamental_score": 0.5,
        "analyzed_at":       datetime.datetime.utcnow().isoformat(),
    }
    log = {
        "symbol": sym, "yf_sym": yf_sym, "p_up": round(p, 4),
        "p_cal": round(p_cal, 4), "ev": round(ev, 4),
        "rec": rec, "rec_dir": rec_dir, "close": close,
        "target": tp, "stop": sl, "atr_pct": round(clamp_atr_pct(atr_pct), 5),
    }
    return msg, log, (df, close, rec_dir, p_cal, pos, tp, sl, ev)


# ═════════════════════════════════════════════════════════════════════════════
#  CANLI DÖNGÜ
# ═════════════════════════════════════════════════════════════════════════════

def _publish(msg: dict) -> bool:
    if not infra._ensure_channel():
        return False
    try:
        infra.GLOBAL_CHANNEL.basic_publish(
            exchange="", routing_key="oracle.analysis",
            body=json.dumps(msg, ensure_ascii=False),
            properties=pika.BasicProperties(delivery_mode=2, content_type="application/json"),
        )
        return True
    except Exception as e:
        print(f"  publish hatası {msg.get('symbol')}: {e}")
        return False


def run_ml_cycle(model_holder: list):
    """BIST-50 evrenini champion ile tarar, publish + log + paper trade yapar."""
    if not infra._ensure_channel():
        print("[ml cycle] RabbitMQ yok, atlanıyor.")
        return
    model = model_holder[0]
    if model is None:
        send_syslog("[ml cycle] Champion hazır değil — döngü atlandı.", "WARN")
        return

    ts = datetime.datetime.now().strftime("%H:%M:%S")
    send_syslog(f"[ml v3] Analiz döngüsü başladı (saf teknik, 10g) — {ts}", "INFO")

    try:
        ctx = fetch_context(period="1y")
    except Exception as e:
        print(f"[ml cycle] bağlam indirilemedi: {e}")
        ctx = pd.DataFrame()

    # Rejim kapısı — döngü başına 1 kez hesaplanır
    regime = market_regime()
    if regime.get("regime") == "RISK_OFF":
        send_syslog(f"[ml v3] REJİM KAPISI AKTİF — {regime.get('detail')} → yeni AL askıda.", "WARN")
    elif regime.get("regime") == "RISK_ON":
        print(f"[ml cycle] rejim: RISK_ON ({regime.get('detail')})")

    universe = load_universe()
    live_acc = get_live_accuracy()

    # Faz 2: isotonic kalibratör (walk-forward sonrası oluşur; yoksa kimlik fallback)
    cal = load_calibrator()
    if cal is not None:
        print("[ml cycle] kalibratör aktif — EV filtresi + Kelly boyutlandırma devrede")
    else:
        print("[ml cycle] kalibratör yok — ham p + doğrusal rampa (fallback). "
              "Walk-forward çalıştırınca oluşur.")

    # Faz 3: haber özellikleri (meta-labeling) — hata olursa boş (fail-open)
    try:
        news_map = meta.fetch_news_map(infra.api_get)
        print(f"[ml cycle] haber haritası: {len(news_map)} varlık (48s penceresi)")
    except Exception as e:
        print(f"[ml cycle] haber haritası alınamadı (meta pasif): {e}")
        news_map = {}
    meta_model = meta.load_meta()
    if meta_model is not None:
        print("[ml cycle] meta-model CANLIDA — AL sinyalleri haber/rejim süzgecinden geçiyor")

    paper_state    = paper_trading.load_state()
    paper_universe = set(paper_trading.get_universe())
    paper_mkt_open = paper_trading.is_market_open()
    today_str      = datetime.date.today().isoformat()
    paper_candidates: list[dict] = []   # AL adayları — döngü sonunda EV sırasıyla açılır

    # ── Faz 1: evrenin özellik fotoğrafı (ham) ────────────────────────────────
    snaps: dict[str, tuple] = {}
    for sym, yf_sym in universe.items():
        try:
            s = fetch_snapshot(sym, yf_sym, ctx)
            if s is not None:
                snaps[sym] = s
            time.sleep(0.5)
        except Exception as e:
            print(f"  {sym} veri hatası: {e}")
            time.sleep(0.4)

    # ── Faz 2: kesitsel rank (bugünün evreni) — eğitimle AYNI dönüşüm ─────────
    raw_feats = {sym: s[1] for sym, s in snaps.items()}

    # Faz 4: günün HAM özellik fotoğrafını logla (PSI drift monitörü tabanı)
    try:
        monitoring.log_features(raw_feats)
    except Exception as e:
        print(f"[ml cycle] özellik logu yazılamadı: {e}")

    model_feats = xsec_rank_latest(raw_feats) if XSEC_RANK else raw_feats
    if XSEC_RANK:
        print(f"[ml cycle] kesitsel rank: {len(model_feats)} sembol bugünün evreninde sıralandı")

    count = buys = 0
    for sym, snap in snaps.items():
        yf_sym = universe[sym]
        try:
            result = analyze_symbol(model, sym, yf_sym, snap,
                                    model_feat=model_feats.get(sym),
                                    live_acc=live_acc, regime=regime, cal=cal,
                                    news_map=news_map, meta_model=meta_model)
            msg, log, paper_ctx = result
            _publish(msg)
            _log_prediction(log)

            rec_dir = log["rec_dir"]
            if rec_dir == "BUY":
                buys += 1

            # Paper trading — yalnız kullanıcı evrenindeki hisseler.
            # Faz 2: çıkışlar (TP/SL/TIME/SIGNAL) anında işlenir; ALIM'lar aday
            # havuzunda toplanır ve döngü sonunda EV sırasıyla + portföy
            # kısıtlarıyla açılır (greedy top-k — en iyi fırsata öncelik).
            if sym in paper_universe:
                try:
                    df, close, _rd, p_c, pos, tp, sl, ev = paper_ctx
                    recent = df.tail(40)
                    def _col(name):
                        c = recent[name]
                        return c.iloc[:, 0] if hasattr(c, "columns") else c.squeeze()
                    _h, _l, _c = _col("High"), _col("Low"), _col("Close")
                    bars = [
                        {"date": d.strftime("%Y-%m-%d"), "high": float(hv), "low": float(lv), "close": float(cv)}
                        for d, hv, lv, cv in zip(recent.index, _h, _l, _c)
                        if pd.notna(hv) and pd.notna(lv) and pd.notna(cv)
                    ]
                    fresh = bool(bars) and bars[-1]["date"] == today_str
                    paper_trading.on_signal(
                        paper_state, sym, close, rec_dir, p_c, pos, tp, sl,
                        bars=bars, market_open=paper_mkt_open, fresh=fresh,
                        allow_open=False,
                    )
                    if (rec_dir == "BUY" and pos > 0 and fresh
                            and sym not in paper_state["positions"]):
                        paper_candidates.append({
                            "symbol": sym, "price": close, "conf": p_c,
                            "position_pct": pos, "target": tp, "stop": sl,
                            "score": ev,
                        })
                except Exception as e:
                    print(f"  [Paper] {sym}: {e}")

            count += 1
            print(f"  {sym:<8} {log['close']:>9.2f} → {msg['recommendation']:<11} P(yukarı)={log['p_up']:.0%}")
            time.sleep(0.8)
        except Exception as e:
            print(f"  {sym} hata: {e}")
            time.sleep(0.6)

    # Faz 2: AL adaylarını EV sırasıyla + portföy kısıtlarıyla aç (greedy top-k)
    try:
        if paper_candidates and paper_mkt_open:
            opened = paper_trading.open_from_candidates(paper_state, paper_candidates)
            if opened:
                print(f"  [Paper] {opened}/{len(paper_candidates)} aday pozisyona çevrildi (EV sıralı, kısıtlı)")
    except Exception as e:
        print(f"  [Paper] aday açma hatası: {e}")

    # Paper: equity fotoğrafı (yalnız açıkken) + state kaydet
    try:
        if paper_mkt_open:
            bench_px = None
            try:
                _b = yf.download("XU100.IS", period="5d", interval="1d",
                                 auto_adjust=True, progress=False, threads=False)
                if _b is not None and len(_b) > 0:
                    bench_px = float(_b["Close"].squeeze().dropna().iloc[-1])
            except Exception:
                pass
            paper_trading.snapshot_equity(paper_state, benchmark_price=bench_px)
        paper_trading.save_state(paper_state)
    except Exception as e:
        print(f"  [Paper] snapshot hatası: {e}")

    send_syslog(f"[ml v3] Döngü bitti — {count}/{len(universe)} sembol, {buys} AL sinyali.", "SUCCESS")


# ═════════════════════════════════════════════════════════════════════════════
#  TAHMIN LOG'U (10g değerlendirme için)
# ═════════════════════════════════════════════════════════════════════════════

_LOG_FIELDS = ["timestamp", "symbol", "yf_sym", "p_up", "p_cal", "ev",
               "rec", "rec_dir", "close", "target", "stop", "atr_pct", "eval"]


def _log_prediction(log: dict):
    """Tahmini PREDICTION_LOG'a yazar. Aynı (sembol, gün) varsa üzerine yazar."""
    today = datetime.datetime.utcnow().date().isoformat()
    new_row = {
        "timestamp": datetime.datetime.utcnow().isoformat(),
        "symbol": log["symbol"], "yf_sym": log["yf_sym"],
        "p_up": log["p_up"], "p_cal": log.get("p_cal", ""), "ev": log.get("ev", ""),
        "rec": log["rec"], "rec_dir": log["rec_dir"],
        "close": log["close"], "target": log["target"], "stop": log["stop"],
        "atr_pct": log["atr_pct"], "eval": "",
    }
    rows, found = [], False
    if PREDICTION_LOG.exists():
        with open(PREDICTION_LOG, "r", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                if r.get("symbol") == log["symbol"] and r.get("timestamp", "")[:10] == today:
                    new_row["eval"] = r.get("eval", "")   # mevcut değerlendirmeyi koru
                    rows.append(new_row); found = True
                else:
                    rows.append(r)
    if not found:
        rows.append(new_row)
    ML_DIR.mkdir(parents=True, exist_ok=True)
    # Atomik yazım: yarım kalmış dosya = bozuk timestamp (07/2026 bulgusu)
    atomic.write_csv(PREDICTION_LOG, _LOG_FIELDS, rows)


# ═════════════════════════════════════════════════════════════════════════════
#  10 GÜNLÜK DEĞERLENDİRME (eğitimle AYNI triple-barrier)
# ═════════════════════════════════════════════════════════════════════════════

def maturity(ts: datetime.datetime, now: datetime.datetime | None = None) -> dict:
    """
    Bir tahminin olgunluk durumu — TEK KAYNAK (evaluate_ml + admin takvimi).

    Karşılaştırma TAKVİM GÜNÜ üzerinden yapılır, saat üzerinden DEĞİL.
    Gerekçe (07/2026): tahmin akşam 22:08'de yazıldıysa saat-bazlı `(now-ts).days`
    yargıyı ertesi günün 22:08'ine ötelerdi. Oysa kuralın amacı "10 işlem günlük
    triple-barrier penceresi kapandı mı?" — o pencere 20. günden çok önce kapanır
    (ölçüldü: 8 Tem tahmininde pencere 23 Tem'de kapandı, 13 bar mevcuttu).
    Saat hassasiyeti sonucu değiştirmez, yalnızca UI'da anlamsız bekleme yaratır.
    """
    now = now or datetime.datetime.utcnow()
    age = (now.date() - ts.date()).days
    vdate = ts.date() + datetime.timedelta(days=EVAL_MIN_AGE_DAYS)
    return {
        "age_days":     age,
        "matured":      age >= EVAL_MIN_AGE_DAYS,
        "verdict_date": vdate,
        "days_left":    max(0, (vdate - now.date()).days),
    }


def evaluate_ml():
    """
    Bekleyen tahminleri 10g triple-barrier ile değerlendirir (model tanımıyla AYNI).
    AL precision (AL dediğinde TP'ye önce değme oranı) ana metrik → live_accuracy.json.
    """
    if not PREDICTION_LOG.exists():
        return
    now = datetime.datetime.utcnow()

    with open(PREDICTION_LOG, "r", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    updated = False
    for row in rows:
        if row.get("eval"):
            continue
        try:
            ts = datetime.datetime.fromisoformat(row["timestamp"])
        except Exception:
            continue
        if not maturity(ts, now)["matured"]:
            continue
        try:
            entry   = float(row["close"])
            atr_pct = float(row.get("atr_pct") or 0.0) or None
            yf_sym  = row["yf_sym"]
            win_start = (ts + datetime.timedelta(days=1)).strftime("%Y-%m-%d")
            win_end   = (ts + datetime.timedelta(days=HORIZON + 12)).strftime("%Y-%m-%d")
            dfw = yf.download(yf_sym, start=win_start, end=win_end, interval="1d",
                              auto_adjust=True, progress=False, threads=False)
            if dfw is None or dfw.empty:
                continue
            if isinstance(dfw.columns, pd.MultiIndex):
                dfw.columns = dfw.columns.droplevel(1)
            highs = np.asarray(dfw["High"], dtype=float).flatten()[:HORIZON]
            lows  = np.asarray(dfw["Low"],  dtype=float).flatten()[:HORIZON]
            closes = np.asarray(dfw["Close"], dtype=float).flatten()[:HORIZON]
            if len(closes) == 0:
                continue
            final_close = float(closes[-1])
            ret = (final_close - entry) / entry if entry else 0.0
            lab = triple_barrier_label(entry, highs, lows, final_close, atr_pct)
            actual = "UP" if lab == 1 else "DOWN" if lab == 0 else "NEUTRAL"
            row["eval"] = f"{actual}|{ret:.4f}"
            updated = True
            time.sleep(0.4)
        except Exception as e:
            print(f"  [ml eval] {row.get('symbol')}: {e}")

    if updated:
        atomic.write_csv(PREDICTION_LOG, list(rows[0].keys()), rows)
    rebuild_ml_stats()

    # Faz 3: yeni değerlendirmeler geldiyse meta-modeli eğitmeyi dene.
    # train_meta kendi kapılarını uygular (min örnek + test AUC) — kanıtsız
    # katman canlıya alınmaz; yetersizse sessizce birikmeye devam eder.
    try:
        meta.train_meta()
    except Exception as e:
        print(f"[meta] eğitim denemesi hatası: {e}")


def _breakeven_precision() -> float:
    cost_units = TRANSACTION_COST_PCT / 0.02
    return (SL_ATR_MULT + cost_units) / (TP_ATR_MULT + SL_ATR_MULT)


def _era_stats(rows: list[dict], breakeven: float) -> dict:
    """
    Bir satır kümesi için AL precision + TABAN ÇİZGİSİ + lift.
    Taban = TÜM değerlendirilen tahminlerin (AL+NÖTR) UP oranı — "model olmasa
    hepsini alsaydık" precision'ı. lift = model becerisinin canlı ölçüsü.
    """
    al_total = al_eval = al_correct = 0
    all_eval = all_up = 0
    for r in rows:
        actual = (r.get("eval") or "").split("|")[0].strip()
        if actual in ("UP", "DOWN"):
            all_eval += 1
            if actual == "UP":
                all_up += 1
        if r.get("rec_dir") == "BUY":
            al_total += 1
            if actual in ("UP", "DOWN"):
                al_eval += 1
                if actual == "UP":
                    al_correct += 1
    out = {
        "al_signals": al_total, "al_evaluated": al_eval, "al_correct": al_correct,
        "al_precision": None, "evaluated_all": all_eval,
        "base_rate": None, "lift": None, "profitable": None,
    }
    if all_eval > 0:
        out["base_rate"] = round(all_up / all_eval, 4)
    if al_eval > 0:
        prec = al_correct / al_eval
        out["al_precision"] = round(prec, 4)
        out["profitable"]   = bool(prec > breakeven)
        if out["base_rate"] is not None:
            out["lift"] = round(prec - out["base_rate"], 4)
    return out


def rebuild_ml_stats() -> dict:
    """
    Log'dan canlı metrikler → live_accuracy.json.
    İki dönem: TÜM ZAMANLAR + MEVCUT ŞAMPİYON (eski modelin sinyalleri yeni
    modelin metriğini kirletmesin — 07/2026 xsec_rank geçişi sonrası kritik).
    """
    be = round(_breakeven_precision(), 4)
    champ_since = (champion_meta() or {}).get("trained_at") or None
    stats = {
        "horizon": HORIZON, "buy_threshold": BUY_THRESHOLD,
        "al_signals": 0, "al_evaluated": 0, "al_correct": 0,
        "al_precision": None, "evaluated_all": 0, "base_rate": None, "lift": None,
        "breakeven_precision": be, "profitable": None,
        "n_total": 0, "champion_since": champ_since, "champion": None,
        "last_eval": now_iso(),
    }
    if not PREDICTION_LOG.exists():
        ML_STATS_FILE.write_text(json.dumps(stats, ensure_ascii=False, indent=2))
        return stats

    with open(PREDICTION_LOG, "r", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    stats["n_total"] = len(rows)

    # Tüm zamanlar (geriye dönük uyumlu üst-düzey alanlar)
    stats.update(_era_stats(rows, be))
    stats["breakeven_precision"] = be   # _era_stats üzerine yazmasın

    # Mevcut şampiyon dönemi
    if champ_since:
        champ_rows = [r for r in rows if (r.get("timestamp") or "") >= champ_since]
        stats["champion"] = _era_stats(champ_rows, be)

    ML_DIR.mkdir(parents=True, exist_ok=True)
    ML_STATS_FILE.write_text(json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8")
    return stats


def get_live_accuracy() -> float:
    """AL precision (10g). Yoksa 0."""
    if ML_STATS_FILE.exists():
        try:
            s = json.loads(ML_STATS_FILE.read_text())
            return float(s.get("al_precision") or 0.0)
        except Exception:
            pass
    return 0.0


def now_iso() -> str:
    return datetime.datetime.utcnow().isoformat()


# ═════════════════════════════════════════════════════════════════════════════
#  KORUMALI ŞAMPİYON-RAKİP (Faz 4) — körü körüne retrain YOK
# ═════════════════════════════════════════════════════════════════════════════

def _al_precision_on(model, df: pd.DataFrame) -> tuple[float | None, int]:
    """Bir model + (feature+label) test seti üzerinde AL precision + AL sayısı."""
    if len(df) == 0:
        return None, 0
    proba = model.predict_proba(df[FEATURE_NAMES])[:, 1]
    y = df["label"].astype(int).values
    al = proba >= BUY_THRESHOLD
    n = int(al.sum())
    if n == 0:
        return None, 0
    return float(y[al].mean()), n


def promote_if_better(test_window_days: int = 45) -> dict:
    """
    KORUMALI promosyon — DÜRÜST TERAZİ (07/2026 düzeltmesi).

    ═══ ESKİ HATA ═══
    Test pencereleri şampiyonun EĞİTİM ARALIĞININ İÇİNDEYDİ (şampiyon
    2026-06-24'e kadar eğitilmiş, pencereler Şubat–Haziran 2026). Şampiyon kendi
    ders kitabından sınava girip %73-93 gösteriyordu; oysa dürüst walk-forward
    skoru %51.1. Rakip out-of-sample olduğu için 20-40 puanlık bir handikapla
    yarışıyor ve YAPISAL OLARAK kazanamıyordu → 2/2 deneme reddedildi, model
    sonsuza kadar donuk kalacaktı. "Bilgisayarı açık tutmak modeli eğitmiyor"
    şikâyetinin kökü buydu.

    ═══ YENİ KURAL ═══
    Karşılaştırma YALNIZCA şampiyonun HİÇ GÖRMEDİĞİ tarihlerde yapılır
    (champion_meta.date_max sonrası). Böylece iki model de aynı pencerede
    out-of-sample olur — elma elmaya. O kadar taze veri yoksa hileli bir sonuç
    üretmek yerine dürüstçe "yetersiz" denir ve şampiyon korunur.

    Terfi şartları (değişmedi):
      • Rakip pencerelerin ÇOĞUNLUĞUNDA şampiyonu PROMOTE_MIN_EDGE farkla geçer
      • Havuzlanmış AL örneği ≥ PROMOTE_MIN_SAMPLES
      • Havuzlanmış rakip precision ≥ PROMOTE_MIN_PRECISION
    """
    result = {"decision": "kept", "checked_at": now_iso()}

    # ── Şampiyonun veri kesim tarihi — dürüst terazinin dayanağı ──────────────
    cutoff_s = (champion_meta() or {}).get("date_max")
    if not cutoff_s:
        result.update(reason="şampiyon künyesinde date_max yok — dürüst karşılaştırma kurulamadı")
        _log_promotion(result)
        return result

    try:
        # Rank gün-içi hesaplandığı için cutoff bölmesinden ÖNCE uygulanması sızıntı yaratmaz.
        data = prepare_training(_load_training_data(rebuild=False))
        cache_max = pd.to_datetime(data["date"]).max().date()
        # Etiket HORIZON işlem günü ileri baktığı için en yeni etiketlenebilir
        # tarih ≈ bugün − ~16 takvim günü. Önbellek bunun gerisindeyse taze veri var.
        expected_max = datetime.date.today() - datetime.timedelta(days=int(round(HORIZON * 1.6)))
        stale_days = (expected_max - cache_max).days
        # İKİ sebeple tazele: (a) önbellek şampiyon kesimini hiç geçmiyor,
        # (b) önbellek bayat → fresh_days donar ve terfi ASLA mümkün olmaz
        #     (07/2026: koşul yalnız (a) idi, fresh_days 22'de takılı kalıyordu).
        if str(cache_max) <= cutoff_s or stale_days > 7:
            send_syslog(f"[ml v3] Terfi için taze veri indiriliyor "
                        f"(önbellek {cache_max}, ~{stale_days} gün bayat)...", "INFO")
            data = prepare_training(_load_training_data(rebuild=True))
    except Exception as e:
        result["error"] = f"veri yüklenemedi: {e}"
        _log_promotion(result)
        return result

    data = data.sort_values("date").reset_index(drop=True)
    dates = pd.to_datetime(data["date"])
    max_d = dates.max()
    cutoff = pd.Timestamp(cutoff_s)
    purge = pd.Timedelta(days=int(round(HORIZON * 1.6)) + 4)   # etiket sızıntı tamponu

    # ── Taze (şampiyonun görmediği) aralık yeterli mi? ───────────────────────
    fresh_days = int((max_d - cutoff).days)
    result.update(champion_cutoff=cutoff_s, data_max=str(max_d.date()),
                  fresh_days=fresh_days, min_fresh_days=PROMOTE_MIN_FRESH_DAYS,
                  balance="honest_oos")
    if fresh_days < PROMOTE_MIN_FRESH_DAYS:
        result.update(reason=(f"şampiyonun görmediği veri {fresh_days} gün "
                              f"(< {PROMOTE_MIN_FRESH_DAYS}) — dürüst karşılaştırma için yetersiz"))
        send_syslog(f"[ml v3] Terfi atlandı: taze veri {fresh_days} gün, "
                    f"en az {PROMOTE_MIN_FRESH_DAYS} gün gerekiyor (şampiyon korunuyor).", "INFO")
        _log_promotion(result)
        return result

    # Taze aralığı en fazla PROMOTE_WINDOWS parçaya böl (her pencere ≥ asgari uzunluk)
    n_win = max(1, min(PROMOTE_WINDOWS, fresh_days // PROMOTE_MIN_WINDOW_DAYS))
    win_len = fresh_days / n_win
    result["n_windows_planned"] = n_win

    champion = load_champion()
    windows = []
    chal_correct = chal_total = 0      # havuzlanmış rakip AL isabeti
    wins = comparable = 0

    for k in range(n_win):
        # Pencereler ŞAMPİYON KESİMİNDEN SONRA, kronolojik sırada
        w_start = cutoff + pd.Timedelta(days=k * win_len)
        w_end   = cutoff + pd.Timedelta(days=(k + 1) * win_len)
        test  = data[(dates > w_start) & (dates <= w_end)]
        train = data[dates <= w_start - purge]
        if len(train) < 2000 or len(test) < 100:
            windows.append({"window": f"{w_start.date()}→{w_end.date()}",
                            "skipped": f"yetersiz veri (train={len(train)}, test={len(test)})"})
            continue

        challenger = train_model(train[FEATURE_NAMES], train["label"].astype(int), enforce_min=True)
        if challenger is None:
            windows.append({"window": f"{w_start.date()}→{w_end.date()}", "skipped": "rakip eğitilemedi"})
            continue

        chal_prec, chal_n = _al_precision_on(challenger, test)
        champ_prec, champ_n = (_al_precision_on(champion, test) if champion is not None else (None, 0))

        win = (chal_prec is not None
               and (champ_prec is None or (chal_prec - champ_prec) >= PROMOTE_MIN_EDGE))
        if chal_prec is not None:
            comparable += 1
            wins += 1 if win else 0
            chal_correct += int(round(chal_prec * chal_n))
            chal_total   += chal_n
        windows.append({
            "window": f"{w_start.date()}→{w_end.date()}",
            "challenger_precision": round(chal_prec, 4) if chal_prec is not None else None,
            "challenger_al_n": chal_n,
            "champion_precision": round(champ_prec, 4) if champ_prec is not None else None,
            "champion_al_n": champ_n,
            "challenger_wins": bool(win),
        })

    pooled_prec = (chal_correct / chal_total) if chal_total > 0 else None
    result.update(
        windows=windows, n_windows=n_win, comparable_windows=comparable,
        challenger_wins=wins,
        pooled_precision=round(pooled_prec, 4) if pooled_prec is not None else None,
        pooled_al_n=chal_total,
        edge_required=PROMOTE_MIN_EDGE, min_samples=PROMOTE_MIN_SAMPLES,
        min_precision=PROMOTE_MIN_PRECISION, test_window_days=test_window_days,
    )

    promote = (
        comparable >= 2                                  # en az 2 karşılaştırılabilir pencere
        and wins * 2 > comparable                        # çoğunlukta kazanmalı
        and chal_total >= PROMOTE_MIN_SAMPLES
        and pooled_prec is not None
        and pooled_prec >= PROMOTE_MIN_PRECISION
    )

    if promote:
        # Rakibi TÜM veriyle yeniden eğit → yeni champion.
        new_champ = train_model(data[FEATURE_NAMES], data["label"].astype(int), enforce_min=True)
        if new_champ is not None:
            joblib.dump(new_champ, CHAMPION_FILE)
            _write_meta(new_champ, data, extra={"promoted_from_challenger": True,
                                                "challenger_oos_precision": round(pooled_prec, 4),
                                                "windows_won": f"{wins}/{comparable}"})
            result["decision"] = "promoted"
            send_syslog(
                f"[ml v3] ✅ TERFİ (dürüst terazi): Rakip {wins}/{comparable} pencerede kazandı "
                f"(şampiyonun görmediği {fresh_days} günlük veride), havuz precision "
                f"{pooled_prec:.1%} (n={chal_total}) → yeni champion eğitildi.", "SUCCESS",
            )
        else:
            result.update(decision="kept", reason="yeni champion eğitilemedi")
    else:
        send_syslog(
            f"[ml v3] Promosyon RET (dürüst terazi): rakip {wins}/{comparable} pencerede kazandı "
            f"(havuz {('%.1f%%' % (pooled_prec*100)) if pooled_prec is not None else '—'}, n={chal_total}) "
            f"— çoğunluk/eşik sağlanmadı → mevcut champion korunuyor.", "INFO",
        )

    _log_promotion(result)
    return result


def days_since_last_promotion_check() -> float | None:
    """
    Son terfi kontrolünün üstünden kaç gün geçti? Günlük yoksa None.
    Boot telafisi için: `schedule` kaçan işi TELAFİ ETMEZ — bilgisayar Pazar
    20:00'de kapalıysa haftalık terfi hiç çalışmaz ve kimse fark etmez
    (08/2026: kullanıcı "Pazar açmayı unuttum, eğitildi mi?" diye sordu).
    """
    try:
        if not PROMOTION_LOG.exists():
            return None
        last = None
        for line in PROMOTION_LOG.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                ts = json.loads(line).get("checked_at")
                if ts:
                    last = ts
            except Exception:
                continue
        if not last:
            return None
        return (datetime.datetime.utcnow() - datetime.datetime.fromisoformat(last)).total_seconds() / 86400.0
    except Exception:
        return None


def promotion_catchup(max_age_days: float = 7.0) -> dict | None:
    """
    Kaçırılmış haftalık terfi kontrolünü telafi eder. Son kontrol
    max_age_days'ten eskiyse promote_if_better çalıştırır, değilse dokunmaz.
    """
    age = days_since_last_promotion_check()
    if age is not None and age < max_age_days:
        print(f"[ml v3] Terfi kontrolü {age:.1f} gün önce yapılmış — telafi gerekmiyor.")
        return None
    send_syslog(f"[ml v3] Haftalık terfi kontrolü kaçmış "
                f"({'hiç yapılmamış' if age is None else f'{age:.1f} gün önce'}) — telafi çalıştırılıyor.", "INFO")
    return promote_if_better()


def _log_promotion(result: dict):
    try:
        ML_DIR.mkdir(parents=True, exist_ok=True)
        with open(PROMOTION_LOG, "a", encoding="utf-8") as f:
            f.write(json.dumps(result, ensure_ascii=False) + "\n")
    except Exception as e:
        print(f"[ml_live] promotion log yazılamadı: {e}")
