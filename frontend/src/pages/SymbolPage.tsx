// =============================================================================
// SerInvest — Sembol  (route: /sembol)
// docs/PLAN_ARAYUZ.md · Yapı 1 "Tek karar, tüm kanıt"
//
// Tek soruyu cevaplar: BU SEMBOLDE NE OLUYOR?
//
// YAPI 1'İN KURALI: KARAR SATIRI BAŞLIĞIN KENDİSİ.
// Üstünde "AI KARAR MERKEZİ" yazmıyor — "TSKB · ALIM · ₺11,49" zaten ne
// olduğunu söylüyor. Sayfada yalnız iki başlık var, ikisi de soru:
// "Bu karara ne itiyor?" ve "Bu karara güvenmeli miyim?"
//
// İZLEME LİSTESİ MODÜL DEĞİL ANAHTAR. Solda başlıksız bir sütun; ne olduğu
// bakınca belli. Eski Terminal'de kendi başlığı olan bir kutuydu.
//
// NE BURAYA GELMEDİ: MLOps panelinin tamamı (Model sayfasında). Burada
// yalnız BU KARARA dokunan ölçüler var — AL çağrısına uymanın işe yarayıp
// yaramadığı ve bu hissedeki sicil.
// =============================================================================
import { useEffect, useMemo, useState } from 'react'
import { useOutletContext, useSearchParams } from 'react-router-dom'
import type { SharedData } from '../App'
import { API, ADMIN, adminFetch } from '../lib/api'
import { useConfig } from '../lib/useConfig'
import { fmt, yuzde, oranYuzde } from '../lib/format'
import { ruhHaliHesapla, type AggRow } from '../lib/sentiment'
import { suruculeriTopla, listeCoz } from '../lib/drivers'
import { seviyeleriTopla, uzaklikYuzde, type Seviye } from '../lib/levels'
import { tazelikDurumu } from '../lib/tazelik'
import type { Bar } from '../lib/bars'
import { COMPANY_NAMES } from '../lib/companies'
import { PriceBarriers, BarWithRef, ContribBars, DotStrip, OutcomeStrip,
         IntervalBar } from '../components/viz'
import { sicilCikar, sicilYorumu, SONUC_AD,
         type SicilSatiri, type Sonuc } from '../lib/sicil'
import { TerimTip } from '../components/ui'
import { AlKarsilastirma, type GetiriKarsilastirma } from '../components/finance/AlKarsilastirma'

interface Commentary {
  stance?: { direction: 'YUKARI' | 'YATAY' | 'AŞAĞI'; confidence: string }
  error?: string
}

/** Yerel kısaltma — biçim merkezden geliyor (lib/format). */
const sayi = (v: number | null | undefined, d = 2) => fmt(v ?? null, d)

/** "2026-07-08" → "08.07" — Türkçe okuma sırası gün.ay. */
const gunAy = (g: string | null) =>
  g ? `${g.slice(8, 10)}.${g.slice(5, 7)}` : '—'

const YON_RENK: Record<string, string> = {
  YUKARI: 'var(--u-up)', 'AŞAĞI': 'var(--u-down)', YATAY: 'var(--u-flat)',
}

export default function SymbolPage() {
  const { assets, oracle, news, fundamentals } = useOutletContext<SharedData>()
  const cfg = useConfig()
  const [sp, setSp] = useSearchParams()

  const [agg, setAgg] = useState<AggRow[] | null>(null)
  /** Bu hissenin tahmin günlüğü — modelin buradaki sicili. */
  const [sicilHam, setSicilHam] = useState<SicilSatiri[] | null>(null)
  /** Modelin BÜTÜN hisselerdeki gerçekleşmiş AL isabeti — karşılaştırma tabanı.
      Sembol değişince yeniden çekilmiyor; evrensel bir sayı. */
  const [genelIsabet, setGenelIsabet] = useState<number | null>(null)
  /** AL dediği hisseler vs demedikleri — gerçekleşen getiri (bkz. AlKarsilastirma). */
  const [getiri, setGetiri] = useState<GetiriKarsilastirma | null>(null)
  const [yorum, setYorum] = useState<Commentary | null>(null)
  const [ara, setAra] = useState('')
  /** Grafikten gelen barlar — seviyeler bunlardan hesaplanıyor.
      PriceBarriers zaten çekiyor; ikinci kez istemeye gerek yok. */
  const [barlar, setBarlar] = useState<Bar[]>([])
  /**
   * Grafiğe çizilecek seviyeler — HEPSİ değil, SEÇİLENLER.
   * İlk yazımda tek bir "hepsini çiz" düğmesi vardı; on üç kesikli çizgi
   * grafiği okunmaz hâle getiriyordu ve asıl olan (hedef/stop) kayboluyordu.
   * Satıra tıklayınca o seviye çiziliyor.
   */
  const [secilenSeviyeler, setSecilenSeviyeler] = useState<Set<string>>(new Set())
  const seviyeSec = (anahtar: string) => setSecilenSeviyeler(k => {
    const y = new Set(k)
    if (y.has(anahtar)) y.delete(anahtar)
    else y.add(anahtar)
    return y
  })

  useEffect(() => {
    let dur = false
    const al = () => {
      fetch(`${API}/signals/aggregate?hours=48`).then(r => r.ok ? r.json() : null)
        .then(d => { if (!dur && d) setAgg(d) }).catch(() => {})

      // Genel isabet: özet TÜM günlük üzerinden hesaplanıyor, dönen satırlar
      // gerekmiyor — o yüzden limit en düşükte.
      adminFetch(`${ADMIN}/prediction-log?limit=50`)
        .then(r => (r.ok ? r.json() : null))
        .then(d => {
          if (!dur && d?.summary?.buy_accuracy != null) {
            setGenelIsabet(d.summary.buy_accuracy * 100)
          }
          if (!dur && d?.summary?.getiri) setGetiri(d.summary.getiri)
        }).catch(() => {})
      adminFetch(`${ADMIN}/commentary`).then(r => r.ok ? r.json() : null)
        .then(d => { if (!dur && d && !d.error) setYorum(d) }).catch(() => {})
    }
    al()
    const t = setInterval(al, 180_000)
    return () => { dur = true; clearInterval(t) }
  }, [])

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

  /** Seçili sembol URL'de tutuluyor: bağlantı paylaşılabilir, geri tuşu çalışır. */
  const sembol = sp.get('s') ?? cagrilar[0]?.symbol ?? assets[0]?.symbol ?? null
  const setSembol = (s: string) => setSp({ s }, { replace: true })

  const analiz = sembol ? sonAnaliz.get(sembol) ?? null : null
  const varlik = sembol ? assets.find(a => a.symbol === sembol) ?? null : null
  const temel  = sembol ? fundamentals.find(f => f.symbol === sembol) ?? null : null

  const surucular = useMemo(
    () => analiz ? suruculeriTopla(analiz.keyDrivers, analiz.risks).slice(0, 6) : [],
    [analiz])

  const ruh = useMemo(() => ruhHaliHesapla(agg ?? []), [agg])

  const genislik = useMemo(() => {
    const bist = assets.filter(a => a.assetType === 'BIST'
      && a.close != null && a.open != null && a.open !== 0)
    return {
      artida: bist.filter(a => (a.close as number) > (a.open as number)).length,
      toplam: bist.length,
    }
  }, [assets])

  const basabas = useMemo(() => {
    const { tp_atr_mult: tp, sl_atr_mult: sl } = cfg.model
    return tp + sl > 0 ? (sl / (tp + sl)) * 100 : null
  }, [cfg])


  const sicil = useMemo(() => sicilCikar(sicilHam ?? []), [sicilHam])
  // sicilYorumu ORAN (0–1) bekliyor; genelIsabet yüzde tutuluyor çünkü
  // IntervalBar ve ekrandaki bütün eşikler yüzde ölçeğinde.
  const sicilNot = useMemo(
    () => sicilYorumu(sicil, cfg.model.horizon_days,
                      genelIsabet != null ? genelIsabet / 100 : null),
    [sicil, cfg.model.horizon_days, genelIsabet])
  // Sicil: sembol değişince yeniden çekilir.
  useEffect(() => {
    if (!sembol) { setSicilHam(null); return }
    let dur = false
    setSicilHam(null)
    adminFetch(`${ADMIN}/prediction-log?symbol=${encodeURIComponent(sembol)}&limit=500`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!dur) setSicilHam(d?.rows ?? []) })
      .catch(() => { if (!dur) setSicilHam([]) })
    return () => { dur = true }
  }, [sembol])

  /**
   * Ekrandaki fiyat ile analizin baktığı fiyat aynı ana mı ait?
   *
   * İkisi AYRI servisten geliyor (market-data / oracle) ve açılışta iki
   * dakika ayrışabiliyorlar. Ayrışmayı gizlemek yerine söylüyoruz — bu
   * sayfada hedef ve stop fiyatın hemen yanında duruyor, hangi fiyattan
   * hesaplandıkları belirsiz kalırsa sayılar birbiriyle çelişik okunuyor.
   */
  const tazelik = useMemo(
    () => tazelikDurumu(varlik?.recordedAt, analiz?.analyzedAt),
    [varlik?.recordedAt, analiz?.analyzedAt])

  const alim = !!analiz && analiz.recommendation.includes('ALIM')
  const yon = yorum?.stance?.direction ?? null

  /** İzlenecekler ve riskler tek listede — ikisi de "neye dikkat"in parçası. */
  const izlenecekler = useMemo(() => analiz
    ? [...listeCoz(analiz.watchPoints), ...listeCoz(analiz.risks)].slice(0, 6)
    : [], [analiz])

  /**
   * Teknik skorun evrendeki yeri. Tek başına "0,79" iyi mi kötü mü belli
   * değil; medyan eşik olarak çizilince anlam kazanıyor (BarWithRef'in
   * varlık sebebi bu).
   */
  const teknikMedyan = useMemo(() => {
    const v = [...sonAnaliz.values()]
      .map(o => o.technicalScore)
      .filter((x): x is number => x != null && Number.isFinite(x))
      .sort((a, b) => a - b)
    if (v.length === 0) return null
    const o = Math.floor(v.length / 2)
    const m = v.length % 2 ? v[o] : (v[o - 1] + v[o]) / 2
    return m * 100
  }, [sonAnaliz])

  /**
   * Fiyat seviyeleri — "destek/direnç" değil, TANIMI OLAN seviyeler.
   * Gösterge değerleri arka uçtan geliyor; yeniden hesaplanmıyor ki
   * ekrandaki sayı ile modelin kullandığı sayı aynı kalsın.
   */
  const seviyeler = useMemo<Seviye[]>(() => seviyeleriTopla({
    barlar,
    ema20: varlik?.ema20, ema50: varlik?.ema50, ema200: varlik?.ema200,
    bbUst: varlik?.bbUpper, bbOrta: varlik?.bbMiddle, bbAlt: varlik?.bbLower,
    hedef: alim ? analiz?.shortTermTarget : null,
    stop: alim ? analiz?.shortTermStop : null,
  }).sort((a, b) => b.fiyat - a.fiyat), [barlar, varlik, analiz, alim])

  /** Sol sütun: önce çağrılar, sonra kalan semboller. Arama ikisini de süzer. */
  const liste = useMemo(() => {
    const q = ara.trim().toLocaleUpperCase('tr-TR')
    const uyar = (s: string) => !q
      || s.toLocaleUpperCase('tr-TR').includes(q)
      || (COMPANY_NAMES[s] ?? '').toLocaleUpperCase('tr-TR').includes(q)
    const cagriKod = new Set(cagrilar.map(c => c.symbol))
    return {
      cagrilar: cagrilar.filter(c => uyar(c.symbol)),
      digerleri: assets.filter(a => !cagriKod.has(a.symbol) && uyar(a.symbol)),
    }
  }, [assets, cagrilar, ara])

  const sembolHaber = useMemo(
    () => sembol ? news.filter(n => n.entity === sembol).slice(0, 4) : [],
    [news, sembol])

  const degisim = varlik?.close != null && varlik?.open
    ? ((varlik.close - varlik.open) / varlik.open) * 100 : null

  const ondalik = varlik?.assetType === 'FOREX' ? 4 : 2

  return (
    <div className="ui2" style={{ minHeight: '100%', display: 'grid',
                                  gridTemplateColumns: '186px minmax(0, 1fr)',
                                  gap: 0, alignItems: 'stretch' }}>

      {/* ── SOL: sembol anahtarı. Başlık YOK — ne olduğu bakınca belli. ── */}
      <aside style={{ borderRight: '1px solid var(--u-line)', padding: 'var(--u-s4) 0',
                      display: 'flex', flexDirection: 'column', gap: 'var(--u-s2)',
                      minWidth: 0 }}>
        <input value={ara} onChange={e => setAra(e.target.value)}
               placeholder="Sembol ara…"
               style={{ margin: '0 var(--u-s3)', padding: '5px 8px',
                        fontSize: 'var(--u-t-small)', font: 'inherit',
                        fontFamily: 'var(--u-sans)',
                        color: 'var(--u-text)', background: 'var(--u-panel)',
                        border: '1px solid var(--u-line)',
                        borderRadius: 'var(--u-r-sm)', outline: 'none' }} />

        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {liste.cagrilar.map(c => (
            <button key={c.symbol} onClick={() => setSembol(c.symbol)}
                    className={`u-pick${c.symbol === sembol ? ' u-pick--on' : ''}`}>
              <span style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
                <b style={{ fontSize: 'var(--u-t-body)' }}>{c.symbol}</b>
                <span className="u-sub" style={{ color: 'var(--u-up)' }}>alım</span>
              </span>
              <span className="u-num u-exact">{oranYuzde(c.confidence, 0)}</span>
            </button>
          ))}

          {liste.cagrilar.length > 0 && liste.digerleri.length > 0 && (
            <div style={{ height: 1, background: 'var(--u-line)',
                          margin: 'var(--u-s2) var(--u-s3)' }} />
          )}

          {liste.digerleri.slice(0, 40).map(a => (
            <button key={a.symbol} onClick={() => setSembol(a.symbol)}
                    className={`u-pick${a.symbol === sembol ? ' u-pick--on' : ''}`}>
              <span className="u-sub" style={{ color: 'var(--u-text-2)' }}>{a.symbol}</span>
              <span className="u-num u-exact">{sayi(a.close, a.assetType === 'FOREX' ? 4 : 2)}</span>
            </button>
          ))}
        </div>
      </aside>

      {/* ── SAĞ: karar ve kanıtı ─────────────────────────────────────────── */}
      <div style={{ padding: 'var(--u-s4) var(--u-s5) var(--u-s5)', minWidth: 0,
                    display: 'flex', flexDirection: 'column', gap: 'var(--u-s4)' }}>

        {/* Karar satırı — sayfanın başlığı bu. Üstünde modül adı yok. */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--u-s3)',
                      flexWrap: 'wrap' }}>
          <span className="u-hero">{sembol ?? '—'}</span>
          {analiz && (
            <span style={{ fontSize: 'var(--u-t-lead)', fontWeight: 600,
                           color: alim ? 'var(--u-up)'
                                 : analiz.recommendation.includes('SAT') ? 'var(--u-down)'
                                 : 'var(--u-flat)' }}>
              <TerimTip ad="AI Kararı">{analiz.recommendation}</TerimTip>
            </span>
          )}
          <span className="u-num"
                style={{ fontSize: 'var(--u-t-num)', fontWeight: 600,
                         // Fiyat şüpheliyse SAYININ KENDİSİ soluklaşıyor:
                         // uyarıyı sayfanın altına yazmak, gözün zaten
                         // okuduğu sayıyı düzeltmiyor.
                         color: tazelik.mesaj ? 'var(--u-text-3)' : undefined }}>
            {sayi(varlik?.close, ondalik)}
          </span>
          {tazelik.mesaj && (
            <span className="u-seg" style={{ color: 'var(--u-warn)',
                                             borderColor: 'var(--u-warn)',
                                             cursor: 'help' }}
                  title={tazelik.mesaj}>
              {tazelik.analizdenEski ? 'fiyat analizden eski' : `${tazelik.yasDk} dk önce`}
            </span>
          )}
          {degisim != null && (
            <span className={`u-num ${degisim >= 0 ? 'u-up' : 'u-down'}`}
                  style={{ fontSize: 'var(--u-t-body)', fontWeight: 600 }}>
              {yuzde(degisim, 2, true)}
            </span>
          )}
          {sembol && COMPANY_NAMES[sembol] && (
            <span className="u-sub">{COMPANY_NAMES[sembol]}</span>
          )}
          <div style={{ flexGrow: 1 }} />

          {/* Hedef/stop/boyut YALNIZ ALIM kararında.
              Grafiğin altındaki not zaten bu kuralı söylüyor ("Bu karar ALIM
              değil — hedef/stop çizilmez"), ama başlık onu çiğniyordu: NÖTR
              bir çağrıda da "Hedef — · Stop — · R:R — · Boyut %0,0" yazıyordu.
              Uygulanamayan bir sayıyı boş göstermek, göstermemekten kötü:
              okuyan "veri gelmemiş" sanıyor, oysa böyle bir sayı YOK.

              Burada AYRICA bir açıklama yazılmıyor: grafiğin altındaki not
              aynı şeyi zaten söylüyor ve eksikliğin hissedildiği yere daha
              yakın duruyor. İkisi birden, azaltmaya çalıştığımız tekrardı. */}
          {alim && (
            <span className="u-sub">
              <TerimTip ad="Hedef">Hedef</TerimTip>{' '}
              <b className="u-num u-up">{sayi(analiz?.shortTermTarget, ondalik)}</b>
              {' · '}<TerimTip ad="Stop">Stop</TerimTip>{' '}
              <b className="u-num u-down">{sayi(analiz?.shortTermStop, ondalik)}</b>
              {' · '}<TerimTip ad="R:R">R:R</TerimTip>{' '}
              <b className="u-num">{fmt(analiz?.riskRewardRatio ?? null)}</b>
              {' · '}Boyut{' '}
              <b className="u-num">{oranYuzde(analiz?.positionSizePct, 1)}</b>
            </span>
          )}
        </div>

        {/* Fiyat analizden eskiyse bunu SAYFA GÖVDESİNDE söylüyoruz.
            Başlıktaki rozet göze çarpıyor ama hedef/stop'un HANGİ fiyattan
            hesaplandığını söylemiyor — asıl kafa karıştıran buydu: hedef,
            ekrandaki fiyatın altında görünebiliyordu. */}
        {tazelik.analizdenEski && analiz?.priceAtAnalysis != null && (
          <div style={{ display: 'flex', gap: 'var(--u-s2)', alignItems: 'baseline',
                        flexWrap: 'wrap', padding: 'var(--u-s2) var(--u-s3)',
                        borderRadius: 'var(--u-r-md)',
                        background: 'var(--u-warn-bg)',
                        fontSize: 'var(--u-t-small)', color: 'var(--u-text-2)' }}>
            <b style={{ color: 'var(--u-warn)' }}>Fiyat verisi henüz güncellenmedi.</b>
            <span>
              Ekranda <b className="u-num">{sayi(varlik?.close, ondalik)}</b> yazıyor;
              model <b className="u-num">{sayi(analiz.priceAtAnalysis, ondalik)}</b>{' '}
              üzerinden hesapladı. Hedef ve stop ikincisine göre — aradaki fark
              birkaç dakika içinde kapanır.
            </span>
          </div>
        )}

        {/* Grafik: sayfanın ana görseli. Tanımlı seviyeler İSTEĞE BAĞLI
            çiziliyor — hepsi birden açıkken grafik çizgi ormanına dönüyor
            ve asıl olan (hedef/stop) kayboluyor. */}
        {sembol && (
          <PriceBarriers sembol={sembol} analiz={analiz} yukseklik={360}
                         ondalik={ondalik} onBarlar={setBarlar}
                         ekSeviyeler={seviyeler
                           .filter(x => x.tur !== 'model' && secilenSeviyeler.has(x.anahtar))
                           .map(x => ({ ad: x.ad, fiyat: x.fiyat }))} />
        )}

        {/* Üç sütun: gerekçe · seviyeler ve göstergeler · güven */}
        <div style={{ display: 'grid',
                      gridTemplateColumns: 'minmax(0, 1.15fr) minmax(0, 1fr) 300px',
                      gap: 'var(--u-s5)', alignItems: 'start' }}>

          {/* ── 1 · GEREKÇE ─────────────────────────────────────────────── */}
          <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--u-s3)',
                            minWidth: 0 }}>
            <h2 className="u-band__q" style={{ fontSize: 'var(--u-t-lead)' }}>
              Bu karara ne itiyor?
            </h2>

            {/* Modelin kendi gerekçesi — arka uçta zaten üretiliyordu, ekranda
                yoktu. Harici LLM YOK: bu metin deterministik şablon sentezi
                (commentary.py'nin ilk satırındaki proje ilkesi). Şablon
                uyduramaz; bir dil modeli olmayan bir seviye icat edebilirdi. */}
            {analiz?.reasoning && (
              <p style={{ margin: 0, fontSize: 'var(--u-t-body)',
                          color: 'var(--u-text-2)', lineHeight: 'var(--u-lh-base)' }}>
                {analiz.reasoning}
              </p>
            )}

            <ContribBars ogeler={surucular.map(x => ({
              ad: x.ad, deger: x.etki, baslik: x.metin,
            }))} />
            <span className="u-sub" style={{ color: 'var(--u-text-4)' }}>
              Çubuk uzunluğu etkenler ARASINDAKİ göreli ağırlık. Sayısı
              çıkarılamayan etken çubuksuz kalır.
            </span>

            {izlenecekler.length > 0 && (
              <>
                <div style={{ height: 1, background: 'var(--u-line)' }} />
                <span className="u-label">Neye dikkat</span>
                <ul style={{ margin: 0, paddingLeft: 16, display: 'flex',
                             flexDirection: 'column', gap: 5 }}>
                  {izlenecekler.map((t, i) => (
                    <li key={i} style={{ fontSize: 'var(--u-t-small)',
                                         color: 'var(--u-text-2)',
                                         lineHeight: 'var(--u-lh-base)' }}>{t}</li>
                  ))}
                </ul>
              </>
            )}

            {sembolHaber.length > 0 && (
              <>
                <div style={{ height: 1, background: 'var(--u-line)' }} />
                <span className="u-label">Bu sembolün haberleri</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--u-s2)' }}>
                  {sembolHaber.map((n, i) => (
                    <div key={i} style={{ display: 'flex', gap: 'var(--u-s2)',
                                          alignItems: 'baseline', minWidth: 0 }}>
                      <span style={{ width: 6, height: 6, borderRadius: 999, flexShrink: 0,
                                     marginTop: 1,
                                     background: (n.sentimentScore ?? 0) > 0.05 ? 'var(--u-up)'
                                       : (n.sentimentScore ?? 0) < -0.05 ? 'var(--u-down)'
                                       : 'var(--u-flat)' }} />
                      <span style={{ fontSize: 'var(--u-t-small)', color: 'var(--u-text-2)',
                                     lineHeight: 'var(--u-lh-base)' }}>{n.headline}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>

          {/* ── 2 · SEVİYELER VE GÖSTERGELER ────────────────────────────── */}
          <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--u-s3)',
                            minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--u-s2)' }}>
              <h2 className="u-band__q" style={{ fontSize: 'var(--u-t-lead)' }}>
                Fiyat seviyeleri
              </h2>
              <div style={{ flexGrow: 1 }} />
              {secilenSeviyeler.size > 0 && (
                <button className="u-seg" onClick={() => setSecilenSeviyeler(new Set())}>
                  Temizle ({secilenSeviyeler.size})
                </button>
              )}
            </div>

            {/* "Destek/direnç" DEĞİL. Her seviyenin tanımı var ve üstüne
                gelince yazıyor. Tanımı olmayan seviye süstür. */}
            <span className="u-sub" style={{ color: 'var(--u-text-4)' }}>
              Bunlar “fiyat buraya gelince döner” iddiası değil; tanımı belli
              fiyatlar. Tanımını görmek için üstüne gel, grafiğe çizmek için tıkla.
            </span>

            {seviyeler.length === 0 ? (
              <span className="u-sub">Grafik verisi yüklenince hesaplanacak.</span>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {seviyeler.map(sv => {
                  const u = uzaklikYuzde(sv.fiyat, varlik?.close)
                  return (
                    <div key={sv.anahtar} title={sv.tanim}
                         role={sv.tur === 'model' ? undefined : 'button'}
                         tabIndex={sv.tur === 'model' ? undefined : 0}
                         onClick={sv.tur === 'model' ? undefined : () => seviyeSec(sv.anahtar)}
                         onKeyDown={sv.tur === 'model' ? undefined : e => {
                           if (e.key === 'Enter' || e.key === ' ') {
                             e.preventDefault(); seviyeSec(sv.anahtar)
                           }
                         }}
                         style={{ display: 'grid',
                                  gridTemplateColumns: 'minmax(0,1fr) 78px 62px',
                                  gap: 'var(--u-s2)', alignItems: 'baseline',
                                  padding: '4px 6px', marginLeft: -6,
                                  cursor: sv.tur === 'model' ? 'default' : 'pointer',
                                  borderRadius: 'var(--u-r-sm)',
                                  background: secilenSeviyeler.has(sv.anahtar)
                                    ? 'var(--u-panel-2)' : 'none',
                                  boxShadow: secilenSeviyeler.has(sv.anahtar)
                                    ? 'inset 2px 0 0 var(--u-accent)' : 'none',
                                  borderBottom: '1px solid var(--u-line)' }}>
                      <span style={{ fontSize: 'var(--u-t-small)',
                                     color: sv.tur === 'model' ? 'var(--u-text)' : 'var(--u-text-2)',
                                     fontWeight: sv.tur === 'model' ? 600 : 400,
                                     whiteSpace: 'nowrap', overflow: 'hidden',
                                     textOverflow: 'ellipsis' }}>{sv.ad}</span>
                      <span className="u-num" style={{ fontSize: 'var(--u-t-small)',
                                                       textAlign: 'right' }}>
                        {sayi(sv.fiyat, ondalik)}
                      </span>
                      <span className={`u-num ${u == null ? '' : u > 0 ? 'u-up' : 'u-down'}`}
                            style={{ fontSize: 'var(--u-t-micro)', textAlign: 'right' }}>
                        {yuzde(u, 1, true)}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}

            <div style={{ height: 1, background: 'var(--u-line)' }} />
            <span className="u-label">Teknik göstergeler</span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))',
                          gap: 'var(--u-s2) var(--u-s4)' }}>
              {([
                ['RSI (14)', varlik?.rsi, 1],
                ['MACD Hist', varlik?.macdHistogram, 3],
                ['EMA 20', varlik?.ema20, ondalik],
                ['EMA 50', varlik?.ema50, ondalik],
                ['EMA 200', varlik?.ema200, ondalik],
                ['BB Üst', varlik?.bbUpper, ondalik],
                ['BB Orta', varlik?.bbMiddle, ondalik],
                ['BB Alt', varlik?.bbLower, ondalik],
              ] as Array<[string, number | null | undefined, number]>).map(([ad, v, d]) => (
                <div key={ad} style={{ display: 'flex', justifyContent: 'space-between',
                                       alignItems: 'baseline', gap: 6 }}>
                  <span className="u-sub"><TerimTip ad={ad} /></span>
                  <span className="u-num u-exact">{sayi(v, d)}</span>
                </div>
              ))}
            </div>
          </section>

          {/* ── 3 · GÜVEN ──────────────────────────────────────────────── */}
          <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--u-s3)',
                            minWidth: 0 }}>
            <h2 className="u-band__q" style={{ fontSize: 'var(--u-t-lead)' }}>
              Bu karara güvenmeli miyim?
            </h2>

            {/* ── MODELİN BU HİSSEDEKİ SİCİLİ ──────────────────────────────
                Sayfadaki en somut güven ölçüsü: modelin genel isabeti bir
                ortalama, bu ise bu hissede olan bitenin kendisi.

                ÖNCE OLGU, SONRA ORAN. Kaç çağrı, kaçı hedefe, kaçı stopa —
                bunlar tartışılmaz. Oran ise az sayıda ve ÜST ÜSTE BİNEN
                gözlemden çıkıyor; o yüzden yanında güven aralığıyla ve ne
                söyleyip söyleyemeyeceği yazılı olarak duruyor. */}
            {sicilHam != null && sicil.cagri > 0 && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between',
                              alignItems: 'baseline', gap: 'var(--u-s2)' }}>
                  <span className="u-label">Model bu hissede ne yaptı?</span>
                  <span className="u-exact" style={{ fontSize: 'var(--u-t-micro)' }}>
                    {gunAy(sicil.ilkGun)} – {gunAy(sicil.sonGun)}
                  </span>
                </div>

                <span className="u-sub">
                  <b style={{ color: 'var(--u-text)' }}>{sicil.cagri} kez AL dedi.</b>
                  {sicil.bekleyen > 0 && ` ${sicil.bekleyen} tanesinin sonucu henüz belli değil.`}
                </span>

                <OutcomeStrip sayilar={{
                  hedef: sicil.hedefe, stop: sicil.stopa,
                  ortada: sicil.ortada, bekliyor: sicil.bekleyen,
                } as Record<Sonuc, number>} />

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px var(--u-s3)' }}>
                  {([['hedef', sicil.hedefe], ['stop', sicil.stopa],
                     ['ortada', sicil.ortada], ['bekliyor', sicil.bekleyen]] as
                     Array<[Sonuc, number]>)
                    .filter(([, n]) => n > 0)
                    .map(([k, n]) => (
                      <span key={k} style={{ display: 'inline-flex', alignItems: 'center',
                                             gap: 5, fontSize: 'var(--u-t-micro)',
                                             color: 'var(--u-text-3)' }}>
                        <i style={{ width: 7, height: 7, borderRadius: 2, flexShrink: 0,
                                    background: k === 'hedef' ? 'var(--u-up)'
                                              : k === 'stop' ? 'var(--u-down)'
                                              : k === 'ortada' ? 'var(--u-flat)'
                                              : 'var(--viz-track)' }} />
                        <b className="u-num" style={{ color: 'var(--u-text-2)' }}>{n}</b>
                        {SONUC_AD[k]}
                      </span>
                    ))}
                </div>

                {sicil.isabet != null && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5,
                                marginTop: 2 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between',
                                  alignItems: 'baseline' }}>
                      <span className="u-sub">Bu hissede isabet</span>
                      <span className="u-num" style={{ fontWeight: 600 }}>
                        {oranYuzde(sicil.isabet, 1)}
                        <span className="u-exact" style={{ marginLeft: 5 }}>
                          ({sicil.hedefe}/{sicil.yonlu})
                        </span>
                      </span>
                    </div>
                    <IntervalBar deger={sicil.isabet * 100}
                                 alt={sicilNot.alt * 100} ust={sicilNot.ust * 100}
                                 referans={genelIsabet}
                                 referansEtiket="modelin bütün hisselerdeki isabeti" />
                    <span className="u-exact" style={{ fontSize: 'var(--u-t-micro)' }}>
                      Bant: %95 güven aralığı ({oranYuzde(sicilNot.alt, 0)}–{oranYuzde(sicilNot.ust, 0)})
                      {genelIsabet != null && ' · kesik çizgi: modelin genel isabeti'}
                    </span>
                  </div>
                )}

                {sicilNot.metin && (
                  <span className="u-sub" style={{
                    color: sicilNot.ayirt ? 'var(--u-text-2)' : 'var(--u-text-4)',
                  }}>
                    {sicilNot.metin}
                  </span>
                )}

                <div style={{ height: 1, background: 'var(--u-line)' }} />
              </>
            )}

            {/* "AL isabeti · başabaş" yerine: AL dediği hisseler, demediklerinden
                iyi mi gitti? Eski karşılaştırma modeli olduğundan iyi
                gösteriyordu — bkz. components/finance/AlKarsilastirma. */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span className="u-label">AL çağrısına uymak işe yaradı mı?</span>
              <AlKarsilastirma veri={getiri} />
            </div>

            {analiz && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between',
                              alignItems: 'baseline' }}>
                  <span className="u-sub">
                    Bu çağrının <TerimTip ad="Güven">güveni</TerimTip>
                  </span>
                  <span className="u-num" style={{ fontWeight: 600 }}>
                    {oranYuzde(analiz.confidence, 0)}
                  </span>
                </div>
                <BarWithRef deger={analiz.confidence * 100} esik={basabas}
                            gosterDeger={false} />
              </div>
            )}

            {/* SKORLAR — yalnız GERÇEKTEN ÖLÇÜLENLER.
                Oracle'ın newsScore/macroScore/fundamentalScore alanları 50
                sembolün 50'sinde de tam 0,500: yer tutucu, ölçüm değil.
                Modelin kendi gerekçesi de söylüyor: "saf teknik sinyal —
                haber/temel/makro karışımı yok". Yan yana koysaydık her
                hissede aynı sayı görünür, kullanıcı "bu hissenin haber skoru
                nötr" diye okurdu. Temel skor BAŞKA kaynaktan
                (fundamental-service) geliyor ve gerçek — o gösteriliyor. */}
            <div style={{ height: 1, background: 'var(--u-line)' }} />
            <span className="u-label">Skorlar</span>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between',
                            alignItems: 'baseline' }}>
                <span className="u-sub">Teknik skor</span>
                <span className="u-num" style={{ fontWeight: 600 }}>
                  {fmt(analiz?.technicalScore ?? null)}
                </span>
              </div>
              <BarWithRef deger={analiz?.technicalScore != null ? analiz.technicalScore * 100 : null}
                          esik={teknikMedyan} esikEtiket="evren medyanı"
                          gosterDeger={false} birim="" />
            </div>

            {temel && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between',
                              alignItems: 'baseline' }}>
                  <span className="u-sub"><TerimTip ad="Temel Skor">Temel skor</TerimTip></span>
                  <span className="u-num" style={{ fontWeight: 600 }}>
                    {sayi(temel.fundamentalScore, 2)}
                  </span>
                </div>
                <BarWithRef deger={temel.fundamentalScore * 100} esik={50}
                            esikEtiket="nötr" gosterDeger={false} birim="" />
              </div>
            )}

            <span className="u-sub" style={{ color: 'var(--u-text-4)' }}>
              Modelin haber ve makro skorları ÖLÇÜLMÜYOR (saf teknik model),
              o yüzden burada yok. Haber tarafı aşağıdaki duyarlılık satırından.
            </span>

            <div style={{ height: 1, background: 'var(--u-line)' }} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--u-s3)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between',
                            alignItems: 'baseline' }}>
                <span className="u-sub">Kısa vade</span>
                <span style={{ fontWeight: 600, fontSize: 'var(--u-t-small)',
                               color: yon ? YON_RENK[yon] : 'var(--u-text-4)' }}>
                  {yon ? yon.toLocaleLowerCase('tr-TR') : '—'}
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between',
                              alignItems: 'baseline' }}>
                  <span className="u-sub">Piyasa genişliği</span>
                  <span className="u-num u-exact">
                    {genislik.artida}/{genislik.toplam}
                  </span>
                </div>
                <DotStrip artida={genislik.artida} toplam={genislik.toplam}
                          genislik={272} yukseklik={14} />
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between',
                            alignItems: 'baseline' }}>
                <span className="u-sub">Haber duyarlılığı</span>
                <span className="u-num" style={{ fontWeight: 600 }}>
                  {ruh.puan ?? '—'}{' '}
                  <span className="u-exact">{ruh.etiket.toLocaleLowerCase('tr-TR')}</span>
                </span>
              </div>
            </div>

            {temel && (
              <>
                <div style={{ height: 1, background: 'var(--u-line)' }} />
                <span className="u-label">Temel veriler</span>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))',
                              gap: 'var(--u-s2) var(--u-s4)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="u-sub"><TerimTip ad="F/K">F/K</TerimTip></span>
                    <span className="u-num u-exact">{sayi(temel.peRatio, 1)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="u-sub"><TerimTip ad="PD/DD">PD/DD</TerimTip></span>
                    <span className="u-num u-exact">{sayi(temel.pbRatio, 2)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="u-sub"><TerimTip ad="ROE">ROE</TerimTip></span>
                    <span className="u-num u-exact">
                      {oranYuzde(temel.roe, 1)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="u-sub"><TerimTip ad="Temettü">Temettü</TerimTip></span>
                    <span className="u-num u-exact">
                      {/* Yüzde biriminde geliyor — bkz. ScreenerPage notu. */}
                      {yuzde(temel.dividendYield, 2)}
                    </span>
                  </div>
                </div>
              </>
            )}

            <div style={{ height: 1, background: 'var(--u-line)' }} />
            <span className="u-sub" style={{ color: 'var(--u-text-4)' }}>
              Modelin bakım göstergeleri (yaş, veri sapması, örneklem) burada
              değil Model sayfasında — alım kararı verirken bakılmaz.
            </span>
          </section>
        </div>
      </div>
    </div>
  )
}
