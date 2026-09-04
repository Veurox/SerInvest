"""
SerInvest — Deney: Boru hattında SIZINTI var mı? (çevrimdışı)
=============================================================
Neden bu deney (09/2026 kod incelemesi):

MODEL_KANIT.md'deki bütün ölçümler tek bir varsayıma dayanıyor: walk-forward
DÜRÜST, yani gelecekten geçmişe bilgi sızmıyor. Bu varsayım şimdiye kadar
KOD OKUYARAK savunuldu (purge/embargo mantığı, `i+1` etiket penceresi), ama
hiç SINANMADI. Sızıntı varsa "kenar yok" sonucu bile anlamsızdır — çünkü o
zaman ölçtüğümüz şey model değil, boru hattının kendisidir.

Üç test, üçü de FALSİFİYE etmeye çalışır:

  A · GLOBAL KARIŞTIRMA
      Etiketler tüm veri setinde rastgele karıştırılır. Özellik–etiket bağı
      tamamen koparılır. Dürüst bir boru hattında AUC 0.50'ye ÇÖKMELİ.
      Çökmüyorsa: özellikler etiketin kendisinden bilgi taşıyor demektir
      (klasik sızıntı imzası).

  B · GÜN İÇİ KARIŞTIRMA
      Etiketler yalnız AYNI GÜN içinde karıştırılır. Gün etkisi (o gün piyasa
      yükseldi mi) korunur, kesitsel bağ koparılır. Bu, sistemin asıl iddiası
      olan "gün içinde hisse seçebiliyorum" için daha SIKI testtir: A'yı geçip
      B'de sinyal göstermek, sinyalin seçicilikten değil zamanlamadan geldiğini
      söyler.

  C · PURGE SIFIRLAMA
      Eğitim ile test arası boşluk (purge + embargo) sıfırlanır. Etiket 10 gün
      ileri baktığı için eğitim etiketleri test dönemine UZANIR — yani KASITLI
      sızıntı yaratılır. Skor SIÇRAMALI. Sıçramıyorsa purge zaten bir iş
      yapmıyordur ve gerçek walk-forward'a olan güvenimiz temelsizdir.

ÖNEMLİ — güvenlik: her çağrı `fit_calibration=False` ile yapılır. Aksi hâlde
karıştırılmış etiketlerle fit edilen bir kalibratör CANLI dosyanın üzerine
yazılır ve sistemin gerçek boyutlandırmasını bozardı.

Çalıştırma:
    docker compose exec ai-oracle-service python -m ml.experiment_leakage
"""
import datetime
import json

import numpy as np
import pandas as pd

import ml.validation as V
from ml.config import ML_DIR

OUT_FILE = ML_DIR / "experiment_leakage.json"

# Karıştırma tesadüfen sinyal üretebilir; her senaryo birkaç tohumla tekrarlanır.
SEEDS = (0, 1, 2)


def _wf(data: pd.DataFrame, etiket: str) -> dict:
    """Tek walk-forward — kalibratöre ASLA dokunmaz."""
    print(f"\n[deney] {etiket} çalışıyor...")
    r = V.purged_walk_forward(data, verbose=False, fit_calibration=False)
    if "error" in r:
        print(f"  HATA: {r['error']}")
        return {"etiket": etiket, "error": r["error"]}
    ozet = {
        "etiket": etiket,
        "auc": r.get("auc"),
        "accuracy": r.get("overall_accuracy"),
        "buy_precision": r.get("buy_precision"),
        "base_rate": r.get("base_rate"),
        "lift": r.get("lift"),
        "n_folds": r.get("n_folds"),
        "n_oos": r.get("n_oos"),
    }
    print(f"  AUC {ozet['auc']} · doğruluk {ozet['accuracy']} · lift {ozet['lift']}")
    return ozet


def _global_karistir(data: pd.DataFrame, seed: int) -> pd.DataFrame:
    d = data.copy()
    rng = np.random.default_rng(seed)
    d["label"] = rng.permutation(d["label"].values)
    return d


def _gun_ici_karistir(data: pd.DataFrame, seed: int) -> pd.DataFrame:
    """Etiketleri yalnız kendi günü içinde permüte eder — gün etkisi korunur."""
    d = data.copy()
    rng = np.random.default_rng(seed)
    yeni = d["label"].values.copy()
    for _, idx in d.groupby("date").indices.items():
        yeni[idx] = rng.permutation(yeni[idx])
    d["label"] = yeni
    return d


def main():
    print("[deney] Veri seti yükleniyor...")
    import ml_live
    data = ml_live.prepare_training(ml_live._load_training_data(rebuild=False))
    gun = data["date"].nunique()
    print(f"[deney] {len(data):,} satır · {gun} gün · {data['symbol'].nunique()} sembol")

    sonuc = {
        "computed_at": datetime.datetime.utcnow().isoformat(),
        "n_rows": int(len(data)),
        "n_days": int(gun),
        "seeds": list(SEEDS),
    }

    # ── Referans: gerçek etiketler, gerçek purge ────────────────────────────
    sonuc["baseline"] = _wf(data, "REFERANS (gerçek etiket, gerçek purge)")

    # ── A · Global karıştırma ──────────────────────────────────────────────
    sonuc["global_shuffle"] = [
        _wf(_global_karistir(data, s), f"A · global karıştırma (tohum {s})")
        for s in SEEDS
    ]

    # ── B · Gün içi karıştırma ─────────────────────────────────────────────
    sonuc["within_day_shuffle"] = [
        _wf(_gun_ici_karistir(data, s), f"B · gün içi karıştırma (tohum {s})")
        for s in SEEDS
    ]

    # ── C · Purge sıfırlama (KASITLI sızıntı) ──────────────────────────────
    # _gap_days modül düzeyinde okunuyor; geçici olarak 0 döndürtüp geri alıyoruz.
    orijinal = V._gap_days
    try:
        V._gap_days = lambda: 0
        sonuc["no_purge"] = _wf(data, "C · purge SIFIR (kasıtlı sızıntı)")
    finally:
        V._gap_days = orijinal

    # ── Yargı ───────────────────────────────────────────────────────────────
    def _ort(kayitlar, alan):
        v = [k[alan] for k in kayitlar if k.get(alan) is not None]
        return round(float(np.mean(v)), 4) if v else None

    b_auc  = sonuc["baseline"].get("auc")
    a_auc  = _ort(sonuc["global_shuffle"], "auc")
    bb_auc = _ort(sonuc["within_day_shuffle"], "auc")
    c_auc  = sonuc["no_purge"].get("auc")

    yargi = {}
    # Karıştırma AUC'si 0.50'den belirgin saparsa sızıntı şüphesi. Eşik 0.02:
    # 19.7k OOS örnekte AUC'nin standart hatası ~0.004; 0.02 bunun 5 katı.
    yargi["global_temiz"] = (a_auc is not None and abs(a_auc - 0.5) < 0.02)
    yargi["gun_ici_temiz"] = (bb_auc is not None and abs(bb_auc - 0.5) < 0.02)
    # Purge kaldırılınca skor ARTMALI; artmıyorsa purge zaten iş yapmıyordu.
    yargi["purge_is_goruyor"] = (
        b_auc is not None and c_auc is not None and (c_auc - b_auc) > 0.005
    )
    sonuc["ozet"] = {
        "baseline_auc": b_auc,
        "global_shuffle_auc": a_auc,
        "within_day_shuffle_auc": bb_auc,
        "no_purge_auc": c_auc,
        "purge_etkisi": (round(c_auc - b_auc, 4)
                         if (b_auc is not None and c_auc is not None) else None),
        **yargi,
    }

    OUT_FILE.write_text(json.dumps(sonuc, ensure_ascii=False, indent=2), encoding="utf-8")

    print("\n" + "=" * 66)
    print("  SIZINTI TESTİ SONUCU")
    print("=" * 66)
    print(f"  Referans AUC                  : {b_auc}")
    print(f"  A · global karıştırma AUC     : {a_auc}   (beklenen ≈ 0.500)")
    print(f"  B · gün içi karıştırma AUC    : {bb_auc}   (beklenen ≈ 0.500)")
    print(f"  C · purge sıfır AUC           : {c_auc}   (referanstan YÜKSEK olmalı)")
    print()
    print(f"  Global karıştırma temiz mi    : {'EVET' if yargi['global_temiz'] else 'HAYIR — SIZINTI ŞÜPHESİ'}")
    print(f"  Gün içi karıştırma temiz mi   : {'EVET' if yargi['gun_ici_temiz'] else 'HAYIR — SIZINTI ŞÜPHESİ'}")
    print(f"  Purge gerçekten iş görüyor mu : {'EVET' if yargi['purge_is_goruyor'] else 'HAYIR — purge etkisiz görünüyor'}")
    print(f"\n[deney] Kaydedildi → {OUT_FILE}")


if __name__ == "__main__":
    main()
