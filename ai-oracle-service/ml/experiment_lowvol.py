"""
SerInvest — Deney: Getiri yerine RİSK tahmin etmek (çevrimdışı, canlıya dokunmaz)
==================================================================================
Buraya kadar kanıtlanan (08/2026):

  Teknik gösterge setiyle GETİRİ sıralaması yapılamıyor. Beş model mimarisi,
  sekiz ufuk, örtüşme düzeltmesi ve maliyet düşümüyle ölçüldü — ekonomik olarak
  kullanılabilir kesitsel kenar YOK.
  (ml/experiment_ranking.py, experiment_objective.py, experiment_horizon2.py)

Ama getiri tahmini ile risk tahmini aynı zorlukta değildir:
  • Getiri neredeyse öngörülemez (r ≈ 0.03, maliyetin onda biri).
  • OYNAKLIK ise kuvvetle kalıcıdır — bugün oynak olan hisse yarın da oynaktır.
    Bu, finansta en tekrarlanabilir olgulardan biridir.

Ve "düşük oynaklık anomalisi": düşük oynaklıklı hisseler, riske göre
düzeltilmiş getiride yüksek oynaklıklıları geçme eğilimindedir. Ölçümlerimizde
`atr_pct` her ufukta tutarlı NEGATİF korelasyon verdi (t = -3.85 … -6.57).

Bu deney sorar: **oynaklığa göre seçim, eşit ağırlıklı endeksten daha iyi
riske-göre-düzeltilmiş getiri veriyor mu?**

Neden bu adil bir test:
  • Aylık denge (20 iş günü) → yılda ~12 dönüş → işlem maliyeti yönetilebilir.
  • Karşılaştırma tabanı eşit ağırlıklı 50 hisse (sistemin fiilen yaptığı şey).
  • Sharpe hem getiriyi hem oynaklığı hesaba katar; yüksek enflasyonda nominal
    getiriye bakmak yanıltıcıdır, bu yüzden asıl ölçüt Sharpe.

Çalıştırma:  docker compose exec ai-oracle-service python -m ml.experiment_lowvol
Çıktı:       models/ml_v3/experiment_lowvol.json   (HİÇBİR canlı dosya değişmez)
"""
import datetime
import json
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, "/app")

from ml.config import ML_DIR, TRANSACTION_COST_PCT
from ml.experiment_horizon import CACHE_FILE

OUT_FILE = ML_DIR / "experiment_lowvol.json"

REBALANCE_DAYS = 20        # aylık denge
TRADING_DAYS   = 252


def portfolio_path(panel: pd.DataFrame, rank_col: str | None, ascending: bool,
                   frac: float, rebalance: int = REBALANCE_DAYS) -> dict:
    """
    Dönem dönem portföy kurar ve gerçekleşen getiriyi biriktirir.

    rank_col=None → eşit ağırlıklı tüm evren (karşılaştırma tabanı).
    Maliyet: her dengede değişen pozisyonlar için TRANSACTION_COST_PCT.
    """
    days = sorted(panel["date"].unique())
    rets, held_prev = [], set()

    for i in range(0, len(days) - rebalance, rebalance):
        d0, d1 = days[i], days[i + rebalance]
        cur = panel[panel["date"] == d0]
        nxt = panel[panel["date"] == d1][["symbol", "close"]].rename(columns={"close": "close1"})
        m = cur.merge(nxt, on="symbol", how="inner")
        if len(m) < 10:
            continue

        if rank_col is None:
            sel = m
        else:
            m2 = m.dropna(subset=[rank_col])
            if len(m2) < 10:
                continue
            k = max(1, int(round(len(m2) * frac)))
            sel = m2.nsmallest(k, rank_col) if ascending else m2.nlargest(k, rank_col)

        r = (sel["close1"] / sel["close"] - 1.0).mean()

        held = set(sel["symbol"])
        turnover = len(held - held_prev) / max(1, len(held))
        held_prev = held

        rets.append(float(r - turnover * TRANSACTION_COST_PCT))

    if len(rets) < 8:
        return {"n_periods": len(rets)}

    a = np.asarray(rets)
    per_year = TRADING_DAYS / rebalance
    mean, sd = a.mean(), a.std(ddof=1)
    equity = float(np.prod(1 + a))
    years = len(a) / per_year
    return {
        "n_periods": int(len(a)),
        "mean_period_return": round(float(mean), 5),
        "annualized_return": round(float((1 + mean) ** per_year - 1), 4),
        "annualized_vol": round(float(sd * np.sqrt(per_year)), 4),
        "sharpe": round(float(mean / sd * np.sqrt(per_year)), 3) if sd > 0 else None,
        "total_growth": round(equity - 1, 4),
        "cagr": round(float(equity ** (1 / years) - 1), 4) if years > 0 else None,
        "worst_period": round(float(a.min()), 4),
        "win_rate": round(float((a > 0).mean()), 3),
    }


def main():
    if not CACHE_FILE.exists():
        print("[düşükoynaklık] Önce ml.experiment_horizon çalıştırılmalı (panel önbelleği yok).")
        return
    panel = pd.read_csv(CACHE_FILE, parse_dates=["date"])
    print(f"[düşükoynaklık] Panel: {len(panel):,} satır · {panel['symbol'].nunique()} sembol")
    print(f"  {panel['date'].min().date()} → {panel['date'].max().date()}\n")

    strategies = [
        ("eşit ağırlık (taban)",       None,        True,  1.00),
        ("en düşük oynaklık %20",      "atr_pct",   True,  0.20),
        ("en düşük oynaklık %40",      "atr_pct",   True,  0.40),
        ("en YÜKSEK oynaklık %20",     "atr_pct",   False, 0.20),
        ("52h zirveye yakın %20",      "price_vs_52w_high", False, 0.20),
        ("52h zirveden uzak %20",      "price_vs_52w_high", True,  0.20),
    ]

    rows = []
    for name, col, asc, frac in strategies:
        if col is not None and col not in panel.columns:
            continue
        r = portfolio_path(panel, col, asc, frac)
        r["strategy"] = name
        rows.append(r)

    base = next((r for r in rows if r["strategy"].startswith("eşit")), None)
    out = {"computed_at": datetime.datetime.utcnow().isoformat(),
           "rebalance_days": REBALANCE_DAYS,
           "cost_per_trade": TRANSACTION_COST_PCT,
           "results": rows}
    OUT_FILE.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")

    print("=" * 96)
    print(f"AYLIK DENGELENEN PORTFÖYLER (maliyet dâhil, {rows[0]['n_periods']} dönem)")
    print("=" * 96)
    print(f"  {'strateji':26} {'yıllık':>8} {'oynaklık':>9} {'Sharpe':>7} {'toplam':>9} {'en kötü ay':>11} {'kazanan ay':>11}")
    for r in rows:
        if "sharpe" not in r:
            continue
        print(f"  {r['strategy']:26} {r['annualized_return']:>7.1%} {r['annualized_vol']:>9.1%} "
              f"{r['sharpe'] if r['sharpe'] is not None else 0:>7.2f} {r['total_growth']:>9.1%} "
              f"{r['worst_period']:>11.1%} {r['win_rate']:>11.0%}")

    if base and base.get("sharpe"):
        print(f"\n  Taban Sharpe = {base['sharpe']:.2f}. Bir strateji ancak bunu BELİRGİN geçerse anlamlıdır.")
        print("  UYARI: 6 strateji denendi; tek bir iyi sonuç çoklu-deneme yanlılığı olabilir.")
        print(f"  Dönem sayısı {base['n_periods']} — Sharpe farkının standart hatası kabaca "
              f"{np.sqrt(2/base['n_periods']):.2f}.")
    print(f"\n[deney] Kaydedildi → {OUT_FILE}")


if __name__ == "__main__":
    main()
