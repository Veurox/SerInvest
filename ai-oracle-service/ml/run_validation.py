"""
SerInvest ML v3 — Doğrulama Çalıştırıcı
========================================
Veri setini kur (önbelleğe al) → purged walk-forward → özet kaydet/yazdır.
Container içinde: python -m ml.run_validation  (veya python /app/ml/run_validation.py)
"""
import json
import sys
import warnings

warnings.filterwarnings("ignore")
sys.path.insert(0, "/app")

import pandas as pd

from ml.config import HISTORY_PERIOD, ML_DIR, TRAIN_CACHE
from ml.dataset import build_dataset
from ml.validation import purged_walk_forward

SUMMARY_FILE = ML_DIR / "validation_summary.json"


def main(use_cache: bool = True):
    ML_DIR.mkdir(parents=True, exist_ok=True)

    if use_cache and TRAIN_CACHE.exists():
        print(f"[run] Önbellekten yükleniyor: {TRAIN_CACHE}")
        data = pd.read_csv(TRAIN_CACHE, parse_dates=["date"])
    else:
        print("[run] Veri seti kuruluyor (50 sembol indiriliyor, ~3-4 dk)...")
        data = build_dataset(period=HISTORY_PERIOD, verbose=True)
        data.to_csv(TRAIN_CACHE, index=False)
        print(f"[run] Önbelleğe kaydedildi: {TRAIN_CACHE}")

    # Canlı sistemle AYNI özellik dönüşümü (XSEC_RANK → gün-içi kesitsel percentile)
    from ml.config import XSEC_RANK
    if XSEC_RANK:
        from ml.features import xsec_rank_frame
        print("[run] Kesitsel rank dönüşümü uygulanıyor (XSEC_RANK=True)")
        data = xsec_rank_frame(data)

    print(f"\n[run] Walk-forward başlıyor — {len(data)} satır\n{'='*60}")
    result = purged_walk_forward(data, verbose=True)

    SUMMARY_FILE.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"\n{'='*60}\n📊 DÜRÜST WALK-FORWARD SONUCU\n{'='*60}")
    if "error" in result:
        print("HATA:", result["error"]); return
    print(f"  Adım sayısı           : {result['n_folds']}")
    print(f"  OOS tahmin            : {result['n_oos']:,}")
    print(f"  Genel yön doğruluğu   : {result['overall_accuracy']:.1%}")
    print(f"  AL sinyali            : {result['buy_signals']:,} (kapsam %{result['buy_coverage']*100:.1f})")
    print(f"  AL PRECISION (kazanma): {result['buy_precision']:.1%}" if result['buy_precision'] is not None else "  AL precision: —")
    print(f"  Kâr eşiği (precision) : {result['breakeven_precision']:.1%}  (asimetrik R:R sayesinde düşük)")
    print(f"  Beklenen R/işlem      : {result['expected_R_per_trade']:+.3f} ATR birimi" if result['expected_R_per_trade'] is not None else "")
    verdict = "✅ KÂRLI" if result['profitable'] else "❌ kâr eşiği altında"
    print(f"  SONUÇ                 : {verdict}")
    print(f"\n  Özet kaydedildi: {SUMMARY_FILE}")


if __name__ == "__main__":
    main(use_cache="--fresh" not in sys.argv)
