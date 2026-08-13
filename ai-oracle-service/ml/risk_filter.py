"""
SerInvest — Risk Filtresi (Faz A)
==================================
NE YAPTIĞI VE NE YAPMADIĞI — önce bu:

Bu filtre modelin tahmin gücünü ARTIRMAZ. Model gün içinde hisse sıralayamıyor
(Spearman −0.0073, t = −0.78, 485 bağımsız gün — docs/MODEL_KANIT.md §2) ve
bu filtre onu düzeltmiyor. Yaptığı tek şey, modelin ürettiği "hepsine AL"
listesinden ölçümle KÖTÜ olduğunu gösterebildiğimiz kısmı elemek.

Neden bu iki ölçüt (docs/MODEL_KANIT.md §6, ml/experiment_lowvol.py):
  aylık dengelenen portföyler, işlem maliyeti dâhil, 37 dönem
    eşit ağırlık (taban)      Sharpe 0.96
    en düşük oynaklık %20     Sharpe 1.11    ← kanıtlanmadı (SE 0.23)
    en YÜKSEK oynaklık %20    Sharpe 0.58    ← belirgin KÖTÜ
    52h zirveden en uzak %20  Sharpe 0.51    ← belirgin KÖTÜ
Yani "iyiyi seç" kanıtlanamıyor, "kötüden kaçın" kanıtlanabiliyor.
Filtre tam olarak ikincisini yapar.

Kural ÖNCEDEN yazıldı ve sonradan ayarlanmayacak (docs/PLAN_2026-08.md §A0):
    skor    = rank_pct(-atr_pct) + rank_pct(price_vs_52w_high)   # gün-içi kesitsel
    seçilen = skoru en yüksek RISK_FILTER_TOP_PCT

Karar tarihi 2027-02-12. O gün ölçüm ne derse o yapılır; erteleme yok.
"""
import math

from ml.config import RISK_FILTER_MIN_SYMBOLS, RISK_FILTER_TOP_PCT

# Skoru oluşturan özellikler ve yönleri.
# −1 = küçük olan iyi (düşük oynaklık), +1 = büyük olan iyi (zirveye yakınlık).
CRITERIA: dict[str, int] = {
    "atr_pct": -1,
    "price_vs_52w_high": +1,
}


def _finite(v) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _rank_pct(values: dict[str, float]) -> dict[str, float]:
    """
    Gün-içi yüzdelik sıra (0..1). Beraberlikte ORTALAMA sıra verilir — aksi
    hâlde aynı değere sahip semboller sözlük sırasına göre keyfi biçimde
    birbirinden ayrılırdı.
    """
    n = len(values)
    if n == 0:
        return {}
    if n == 1:
        return {next(iter(values)): 0.5}

    ordered = sorted(values.items(), key=lambda kv: kv[1])
    out: dict[str, float] = {}
    i = 0
    while i < n:
        j = i
        while j + 1 < n and ordered[j + 1][1] == ordered[i][1]:
            j += 1
        avg_rank = (i + j) / 2.0
        for k in range(i, j + 1):
            out[ordered[k][0]] = avg_rank / (n - 1)
        i = j + 1
    return out


def score(raw_feats: dict[str, dict]) -> dict[str, float]:
    """
    Sembol → risk skoru (yüksek = tercih edilir).

    Bir sembol ölçütlerden BİRİNİ bile taşımıyorsa skorlanmaz: eksik veriyi
    ortalamayla doldurmak, veri gelmeyen sembolü sessizce ortalama riskli
    saymak demektir. Skorlanamayan sembol filtreden geçemez (elenir).
    """
    per_criterion: dict[str, dict[str, float]] = {}
    for feat in CRITERIA:
        vals = {}
        for sym, f in raw_feats.items():
            v = _finite((f or {}).get(feat))
            if v is not None:
                vals[sym] = v
        per_criterion[feat] = _rank_pct(vals)

    complete = set(raw_feats)
    for feat in CRITERIA:
        complete &= set(per_criterion[feat])

    return {
        sym: sum(sign * per_criterion[feat][sym] for feat, sign in CRITERIA.items())
        for sym in complete
    }


def select(raw_feats: dict[str, dict],
           top_pct: float = RISK_FILTER_TOP_PCT) -> set[str] | None:
    """
    Filtreden GEÇEN semboller. None dönerse filtre uygulanmaz (evren çok küçük).

    None ile boş küme arasındaki fark önemli: None "ölçemedim, karışma",
    boş küme "ölçtüm, hiçbiri geçmedi" demektir. İkisini karıştırmak, veri
    kesintisinde tüm sinyalleri sessizce susturur.
    """
    if len(raw_feats) < RISK_FILTER_MIN_SYMBOLS:
        return None

    scores = score(raw_feats)
    if len(scores) < RISK_FILTER_MIN_SYMBOLS:
        return None

    k = max(1, int(round(len(scores) * top_pct)))
    ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
    return {sym for sym, _ in ranked[:k]}


def explain(raw_feats: dict[str, dict], sym: str) -> dict:
    """Tek sembolün neden geçtiği/elendiği — arayüzde şeffaflık için."""
    scores = score(raw_feats)
    passed = select(raw_feats)
    s = scores.get(sym)
    if s is None:
        return {"symbol": sym, "scored": False,
                "reason": "risk ölçütleri için veri eksik"}
    ranked = sorted(scores.values(), reverse=True)
    better = sum(1 for v in ranked if v > s)
    return {
        "symbol": sym,
        "scored": True,
        "score": round(s, 4),
        "rank": better + 1,
        "of": len(scores),
        "passed": passed is not None and sym in passed,
        "atr_pct": _finite((raw_feats.get(sym) or {}).get("atr_pct")),
        "price_vs_52w_high": _finite((raw_feats.get(sym) or {}).get("price_vs_52w_high")),
    }
