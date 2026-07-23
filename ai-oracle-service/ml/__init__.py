"""
SerInvest ML — Sıfırdan Sade Model (v3, 06/2026)
=================================================

Kullanıcı kararıyla sıfırdan, sade ve KARARLI bir model. Eski karmaşık katmanlar
(meta-learner, çoklu ufuk, haber/temel/makro füzyonu) BİLİNÇLİ olarak yok.

Tasarım kararları (kilitli):
  • Hedef    : ~2 haftada kazandıran hisse
  • Ufuk     : 10 işlem günü (triple-barrier)
  • Sinyal   : Saf teknik (fiyat + teknik göstergeler + birkaç fiyat-türevi piyasa bağlamı)
  • Evren    : Likit BIST-50
  • Model    : Tek LightGBM, sabit hiperparametre + sabit seed
  • Kararlılık: Şampiyon-rakip — yeni model ancak bağımsız testte eskisini NET geçerse canlıya alınır
  • Doğrulama: Purged + embargo walk-forward (backtest = canlı garantisi)

Modüller:
  config.py     — Tüm sabitler (tek kaynak)
  universe.py   — BIST-50 likit evren + veri kalite filtresi
  features.py   — ~21 saf teknik özellik
  labels.py     — 10 günlük triple-barrier etiket
  model.py      — (Faz 2) tek LightGBM
  validation.py — (Faz 3) purged walk-forward
  champion.py   — (Faz 4) şampiyon-rakip promosyon
"""
