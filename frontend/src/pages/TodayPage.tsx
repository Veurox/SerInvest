// =============================================================================
// SerInvest — Bugün  (route: /bugun)
// docs/PLAN_ARAYUZ.md · Yapı 2 "Üç soru, sırayla" · "görsel önde, sayı yanında"
//
// AÇILIŞ SAYFASI. Tek soruyu cevaplar: BUGÜN ALINACAK BİR ŞEY VAR MI?
// Sayfa yukarıdan aşağı bir düşünce zinciri:
//     Piyasa bugün nasıl?  →  Model ne diyor?  →  Neye güvenebilirim?
//
// NEDEN BANT, NEDEN KARO IZGARASI DEĞİL (Yapı 3 denendi ve bırakıldı)
//   1. Altı eşit karo, eşit OLMAYAN önemi anlatamıyor. "Bugünün çağrısı"
//      sayfanın cevabı; "kâğıt üstü portföy" bağlam. Izgara ikisine de aynı
//      ağırlığı veriyordu.
//   2. Izgarada okuma sırası yok. Kullanıcının sorusunun ise var.
//   3. En önemlisi: ızgara, eski Terminal'i eleştirirken yazdığımız hatayı
//      tekrarlıyordu — çağrı yukarıdaki karoda, grafiği 400 piksel aşağıda.
//      Karar ile kanıtı ayrılıyordu. Burada ikisi ORTA BANTTA yan yana.
//
// BAŞLIKLAR MODÜL ADI DEĞİL SORU. Eski Terminal'de 11 başlıklı bölge vardı
// ("AI KARAR MERKEZİ", "DUYARLILIK RADARI"…) ve hiçbiri "önce şuraya bak"
// demiyordu. Üç soru hem az hem de yönlendirici.
//
// NE BURAYA GELMEDİ (bilerek)
//   • MLOps panelinin tamamı — modelin yaşı, PSI, örneklem BAKIM verisidir.
//     Model sayfasına ait. Buraya yalnız "güvenebilir miyim" sorusuna dokunan
//     ölçüler geldi.
//   • Duyarlılık radarının varlık bazlı altı satırı — tek kadrana indi.
//   • İzleme listesi — gezinme aracı, sayfanın içeriği değil.
// =============================================================================
import { useEffect, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import type { SharedData } from '../App'
import { API, ADMIN, adminFetch } from '../lib/api'
import { useConfig } from '../lib/useConfig'
import { fmt, yuzde, oranYuzde } from '../lib/format'
import { tazelikDurumu } from '../lib/tazelik'
import { ruhHaliHesapla, type AggRow } from '../lib/sentiment'
import { Gauge, DotStrip, Donut, BarWithRef, PriceBarriers } from '../components/viz'
import { TerimTip } from '../components/ui'
import { AlKarsilastirma, type GetiriKarsilastirma } from '../components/finance/AlKarsilastirma'

// ── Arka uç şekilleri (mevcut Terminal bileşenlerinden birebir) ──────────────
interface AdminStatus {
  wf_accuracy?: number | null
  wf_buy_accuracy?: number | null
  wf_n_predictions?: number | null
  model_age_hours?: number | null
}
interface DriftResp {
  status?: string
  psi?: number | null
  calibration?: { n_evaluated?: number | null; min_required?: number | null }
}
interface PaperSummary {
  positions?: Array<{ symbol: string; unrealized_pct?: number | null }>
  total_return: number
  benchmark_return: number | null
  market_status: string
  market_open: boolean
}
interface Commentary {
  stance?: { direction: 'YUKARI' | 'YATAY' | 'AŞAĞI'; confidence: string }
  error?: string
}

const YON_RENK: Record<string, string> = {
  YUKARI: 'var(--u-up)', 'AŞAĞI': 'var(--u-down)', YATAY: 'var(--u-flat)',
}

export default function TodayPage() {
  const { assets, oracle } = useOutletContext<SharedData>()
  const cfg = useConfig()

  const [agg, setAgg] = useState<AggRow[] | null>(null)
  const [st, setSt] = useState<AdminStatus | null>(null)
  /** AL dediği hisseler vs demedikleri (bkz. AlKarsilastirma). `getiri` adı
      bu sayfada kâğıt portföyün getirisine ait, karışmasın. */
  const [alGetiri, setAlGetiri] = useState<GetiriKarsilastirma | null>(null)
  const [dr, setDr] = useState<DriftResp | null>(null)
  const [paper, setPaper] = useState<PaperSummary | null>(null)
  const [yorum, setYorum] = useState<Commentary | null>(null)

  useEffect(() => {
    let dur = false
    const al = () => {
      fetch(`${API}/signals/aggregate?hours=48`).then(r => r.ok ? r.json() : null)
        .then(d => { if (!dur && d) setAgg(d) }).catch(() => {})
      adminFetch(`${ADMIN}/status`).then(r => r.ok ? r.json() : null)
        .then(d => { if (!dur && d) setSt(d) }).catch(() => {})
      // Özet TÜM günlük üzerinden hesaplanıyor; satır gerekmiyor.
      adminFetch(`${ADMIN}/prediction-log?limit=50`).then(r => r.ok ? r.json() : null)
        .then(d => { if (!dur && d?.summary?.getiri) setAlGetiri(d.summary.getiri) })
        .catch(() => {})
      adminFetch(`${ADMIN}/drift`).then(r => r.ok ? r.json() : null)
        .then(d => { if (!dur && d) setDr(d) }).catch(() => {})
      adminFetch(`${ADMIN}/paper-portfolio`).then(r => r.ok ? r.json() : null)
        .then(d => { if (!dur && d) setPaper(d) }).catch(() => {})
      adminFetch(`${ADMIN}/commentary`).then(r => r.ok ? r.json() : null)
        .then(d => { if (!dur && d && !d.error) setYorum(d) }).catch(() => {})
    }
    al()
    const t = setInterval(al, 120_000)
    return () => { dur = true; clearInterval(t) }
  }, [])

  // ── Türetilenler ──────────────────────────────────────────────────────────

  const ruh = useMemo(() => ruhHaliHesapla(agg ?? []), [agg])

  const sonAnaliz = useMemo(() => {
    const m = new Map<string, typeof oracle[number]>()
    for (const o of oracle) {
      const v = m.get(o.symbol)
      if (!v || (o.analyzedAt ?? '') > (v.analyzedAt ?? '')) m.set(o.symbol, o)
    }
    return m
  }, [oracle])

  const cagrilar = useMemo(() =>
    [...sonAnaliz.values()]
      .filter(o => o.recommendation.includes('ALIM'))
      .sort((a, b) => b.confidence - a.confidence),
    [sonAnaliz])

  const [secili, setSecili] = useState<string | null>(null)
  const sembol = secili ?? cagrilar[0]?.symbol ?? null
  const analiz = sembol ? sonAnaliz.get(sembol) ?? null : null
  const varlik = sembol ? assets.find(a => a.symbol === sembol) ?? null : null

  /** Piyasa genişliği — BIST hisselerinin kaçı günü artıda geçiriyor. */
  const genislik = useMemo(() => {
    const bist = assets.filter(a => a.assetType === 'BIST'
      && a.close != null && a.open != null && a.open !== 0)
    const artida = bist.filter(a => (a.close as number) > (a.open as number)).length
    return { artida, toplam: bist.length }
  }, [assets])

  /** Sinyal dağılımı — halkanın MEŞRU kullanımı: parçanın bütüne oranı. */
  const dagilim = useMemo(() => {
    let al = 0, tut = 0, sat = 0
    for (const o of sonAnaliz.values()) {
      if (o.recommendation.includes('ALIM')) al++
      else if (o.recommendation.includes('SAT')) sat++
      else tut++
    }
    return [
      { ad: 'Alım',  deger: al,  renk: 'var(--u-up)' },
      { ad: 'Tut',   deger: tut, renk: 'var(--u-flat)' },
      { ad: 'Satış', deger: sat, renk: 'var(--u-down)' },
    ]
  }, [sonAnaliz])

  /**
   * Başabaş isabet oranı — hedef/stop mesafelerinden TÜRETİLİR, elle yazılmaz.
   * TP 3×ATR, SL 2×ATR ise dengenin tuttuğu nokta SL/(TP+SL) = %40. İşlem
   * maliyeti bunu biraz yukarı iter; o kısım burada hesaplanamıyor (ATR'nin
   * fiyat karşılığı lazım), bu yüzden etikette "maliyet hariç" yazıyor.
   * Sayı config'ten geliyor ki eşikler değişince ekran sessizce eski kalmasın.
   */
  const basabas = useMemo(() => {
    const { tp_atr_mult: tp, sl_atr_mult: sl } = cfg.model
    return tp + sl > 0 ? (sl / (tp + sl)) * 100 : null
  }, [cfg])

  const tazelik = tazelikDurumu(varlik?.recordedAt, analiz?.analyzedAt)


  const sapmaVar = ['DRIFT', 'ALERT'].includes((dr?.status ?? '').toUpperCase())
  const kalibre = dr?.calibration
  const kalibreOran = kalibre?.min_required
    ? Math.min(100, ((kalibre.n_evaluated ?? 0) / kalibre.min_required) * 100)
    : null
  const modelYasGun = st?.model_age_hours != null
    ? Math.round(st.model_age_hours / 24) : null

  const pozisyonSayisi = paper?.positions?.length ?? null
  const getiri = paper ? paper.total_return * 100 : null
  const kiyas = paper?.benchmark_return != null ? paper.benchmark_return * 100 : null

  const yon = yorum?.stance?.direction ?? null

  return (
    <div className="ui2" style={{ minHeight: '100%', padding: '0 var(--u-s5) var(--u-s5)' }}>

      {/* ══ BANT 1 ══ Piyasa bugün nasıl? ═══════════════════════════════════
          Eski Terminal'de üç ayrı kutuydu: tiker, Duyarlılık Radarı ve Piyasa
          Yorumu. Üçü de aynı soruyu cevaplıyordu; tek banda indiler. */}
      <section className="u-band">
        <div className="u-band__head">
          <h2 className="u-band__q">Piyasa bugün nasıl?</h2>
          {yon && (
            <span style={{ fontSize: 'var(--u-t-lead)', fontWeight: 600,
                           color: YON_RENK[yon] ?? 'var(--u-flat)' }}>
              kısa vade {yon.toLocaleLowerCase('tr-TR')}
            </span>
          )}
          {yorum?.stance?.confidence && (
            <span className="u-sub">{yorum.stance.confidence} güven</span>
          )}
        </div>

        <div className="u-cells">
          <div className="u-cell">
            <span className="u-label">Piyasa ruh hali</span>
            <Gauge deger={ruh.puan} genislik={168} />
            <span className="u-sub u-sub--clamp">
              son 48 saatte {ruh.haberSayisi.toLocaleString('tr-TR')} haber
              {ruh.jeopolitik > 0 && ` · ${ruh.jeopolitik} jeopolitik`}
            </span>
          </div>

          <div className="u-cell">
            <span className="u-label">Piyasa genişliği</span>
            <span className="u-big u-num">
              {genislik.toplam > 0 ? genislik.artida : '—'}
              <span style={{ fontSize: 'var(--u-t-num)', color: 'var(--u-text-3)',
                             fontWeight: 500 }}>/{genislik.toplam || '—'}</span>
            </span>
            <DotStrip artida={genislik.artida} toplam={genislik.toplam}
                      genislik={260} yukseklik={28} />
            <span className="u-sub u-sub--clamp">
              günü artıda geçiren hisseler · her çubuk bir hisse
            </span>
          </div>

          <div className="u-cell">
            <span className="u-label">Model ne öneriyor</span>
            <Donut dilimler={dagilim} boyut={104}
                   ortaUst={String(dagilim.reduce((t, d) => t + d.deger, 0))}
                   ortaAlt="sembol" />
          </div>

          <div className="u-cell">
            <span className="u-label">Kâğıt üstü portföy</span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--u-s3)' }}>
              <span className={`u-big u-num ${getiri == null ? 'u-flat' : getiri >= 0 ? 'u-up' : 'u-down'}`}>
                {yuzde(getiri, 1, true)}
              </span>
              <span className="u-exact">
                {pozisyonSayisi == null ? '' : `${pozisyonSayisi} açık`}
              </span>
            </div>
            <span className="u-sub u-sub--clamp">
              {kiyas != null && getiri != null
                ? <>Endeks aynı dönemde <b className="u-num">{yuzde(kiyas, 1, true)}</b>
                    {' · '}fark <b className={`u-num ${getiri - kiyas >= 0 ? 'u-up' : 'u-down'}`}>
                      {yuzde(getiri - kiyas, 1, true)}</b></>
                : (paper?.market_status ?? 'durum bilinmiyor')}
            </span>
          </div>
        </div>
      </section>

      {/* ══ BANT 2 ══ Model ne diyor? ═══════════════════════════════════════
          Sayfanın asıl işi. Çağrı, gerekçesi ve grafiği YAN YANA — eski
          Terminal'de bu üçü üç ayrı kutuya dağılmıştı. */}
      <section className="u-band" style={{ flexGrow: 1 }}>
        <div className="u-band__head">
          <h2 className="u-band__q">Model ne diyor?</h2>
          <span className="u-sub">
            {cagrilar.length === 0
              ? 'bugün alım çağrısı yok'
              : `${cagrilar.length} alım çağrısı · güvene göre sıralı`}
          </span>
        </div>

        {cagrilar.length === 0 ? (
          <span className="u-sub">
            Model bugün hiçbir sembolde alım demiyor. Bu bir kusur değil —
            filtreler geçilmediğinde çağrı üretilmez.
          </span>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '286px minmax(0, 1fr)',
                        gap: 'var(--u-s5)', alignItems: 'start' }}>

            {/* Çağrı listesi — güven çubuklarıyla, eşik işaretli */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {cagrilar.slice(0, 7).map(c => (
                <button key={c.symbol} onClick={() => setSecili(c.symbol)}
                        className={`u-pick${c.symbol === sembol ? ' u-pick--on' : ''}`}>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
                    <span style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--u-s2)' }}>
                      <b style={{ fontSize: 'var(--u-t-lead)' }}>{c.symbol}</b>
                      <span className="u-sub" style={{ color: 'var(--u-up)' }}>
                        {c.recommendation}
                      </span>
                    </span>
                    <BarWithRef deger={c.confidence * 100} esik={basabas}
                                gosterDeger={false} yukseklik={5} />
                  </span>
                  <span className="u-num u-exact" style={{ alignSelf: 'center' }}>
                    {oranYuzde(c.confidence, 0)}
                  </span>
                </button>
              ))}
              <span className="u-sub" style={{ padding: '6px var(--u-s3) 0' }}>
                Çubuktaki işaret başabaş eşiği ({yuzde(basabas, 0)},
                maliyet hariç). <TerimTip ad="Güven">Güven</TerimTip> doğrulanmış
                bir olasılık değildir.
              </span>
            </div>

            {/* Seçili çağrı: künye + grafik. Karar ile kanıtı aynı yerde. */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--u-s3)',
                          minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--u-s3)',
                            flexWrap: 'wrap' }}>
                <span className="u-hero">{analiz?.symbol ?? '—'}</span>
                {analiz && (
                  <span style={{ fontSize: 'var(--u-t-lead)', fontWeight: 600,
                                 color: 'var(--u-up)' }}>{analiz.recommendation}</span>
                )}
                {varlik?.close != null && (
                  <span className="u-num"
                        style={{ fontSize: 'var(--u-t-num)', fontWeight: 600,
                                 color: tazelik.mesaj ? 'var(--u-text-3)' : undefined }}>
                    {fmt(varlik.close)}
                  </span>
                )}
                {/* Sembol sayfasındaki ile aynı kural: hedef/stop fiyatın
                    yanında duruyor, ikisi farklı ana aitse söylenmeli. */}
                {tazelik.mesaj && (
                  <span className="u-seg" title={tazelik.mesaj}
                        style={{ color: 'var(--u-warn)', borderColor: 'var(--u-warn)',
                                 cursor: 'help' }}>
                    {tazelik.analizdenEski ? 'fiyat analizden eski' : `${tazelik.yasDk} dk önce`}
                  </span>
                )}
                <div style={{ flexGrow: 1 }} />
                <span className="u-sub">
                  <TerimTip ad="Hedef">Hedef</TerimTip>{' '}
                  <b className="u-num u-up">{fmt(analiz?.shortTermTarget ?? null)}</b>
                  {' · '}
                  <TerimTip ad="Stop">Stop</TerimTip>{' '}
                  <b className="u-num u-down">{fmt(analiz?.shortTermStop ?? null)}</b>
                  {' · '}
                  <TerimTip ad="R:R">R:R</TerimTip>{' '}
                  <b className="u-num">{fmt(analiz?.riskRewardRatio ?? null)}</b>
                  {' · '}Boyut{' '}
                  <b className="u-num">
                    {analiz?.positionSizePct != null
                      ? oranYuzde(analiz.positionSizePct, 1) : '—'}
                  </b>
                </span>
              </div>

              {sembol && (
                <PriceBarriers sembol={sembol} analiz={analiz}
                               yukseklik={300}
                               ondalik={varlik?.assetType === 'FOREX' ? 4 : 2} />
              )}
            </div>
          </div>
        )}
      </section>

      {/* ══ BANT 3 ══ Neye güvenebilirim? ═══════════════════════════════════
          MLOps panelinin tamamı DEĞİL: yalnız "bu çağrılara güvenmeli miyim"
          sorusuna dokunan ölçüler. Gerisi Model sayfasında. */}
      <section className="u-band">
        <div className="u-band__head">
          <h2 className="u-band__q">Neye güvenebilirim?</h2>
          <span className="u-sub">ayrıntı Model sayfasında</span>
        </div>

        <div className="u-cells">
          <div className="u-cell" style={{ minHeight: 0 }}>
            {/* "AL isabeti · başabaş" yerine: AL dediği hisseler, demediklerinden
                iyi mi gitti? Eski karşılaştırma modeli olduğundan iyi
                gösteriyordu — bkz. components/finance/AlKarsilastirma. */}
            <span className="u-label">AL çağrısına uymak işe yaradı mı?</span>
            <AlKarsilastirma veri={alGetiri} />
          </div>

          <div className="u-cell" style={{ minHeight: 0 }}>
            <span className="u-label">Kalibrasyon</span>
            <span className="u-big u-num">
              {kalibre?.min_required
                ? `${kalibre.n_evaluated ?? 0}/${kalibre.min_required}`
                : '—'}
            </span>
            <BarWithRef deger={kalibreOran} gosterDeger={false} />
            <span className="u-sub u-sub--clamp">
              Bir tahmin ancak ~20 gün sonra yargılanabiliyor; ilk dürüst okuma
              birkaç hafta sürer.
            </span>
          </div>

          <div className="u-cell" style={{ minHeight: 0 }}>
            <span className="u-label">Model yaşı</span>
            <span className="u-big u-num">
              {modelYasGun == null ? '—' : `${modelYasGun} gün`}
            </span>
            <span className="u-sub u-sub--clamp">
              Terfi kararı için 30 günlük taze veri gerekiyor.
            </span>
          </div>

          <div className="u-cell" style={{ minHeight: 0 }}>
            <span className="u-label">Veri kayması</span>
            <span className={`u-big ${sapmaVar ? 'u-warn' : 'u-flat'}`}
                  style={{ fontSize: 'var(--u-t-num)', fontWeight: 700 }}>
              {dr?.status ? (sapmaVar ? 'Sapma var' : 'Normal') : '—'}
            </span>
            <span className="u-sub u-sub--clamp">
              Canlı veri eğitim verisinden uzaklaşıyorsa uyarır.
              Otomatik eğitimi <b>tetiklemez</b>.
            </span>
          </div>
        </div>
      </section>
    </div>
  )
}
