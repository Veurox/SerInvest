// =============================================================================
// SerInvest — Bugün  (route: /bugun)
// docs/PLAN_ARAYUZ.md · Yapı 3 "Kontrol odası" · "görsel önde, sayı yanında"
//
// AÇILIŞ SAYFASI. Tek soruyu cevaplar: BUGÜN ALINACAK BİR ŞEY VAR MI?
//
// YAPI 3'ÜN KURALI: EKRANDA MODÜL BAŞLIĞI YOK.
// Eski Terminal'de 11 başlıklı bölge vardı ("AI KARAR MERKEZİ", "DUYARLILIK
// RADARI", "MODEL SAĞLIĞI"…) ve hiçbiri "önce şuraya bak" demiyordu. Burada
// etiket karonun parçası; ayrı bir başlık satırı yok. Karonun kendisi bir
// cümle: etiket + görsel + sayı.
//
// NE BURAYA GELMEDİ (bilerek)
//   • MLOps paneli — modelin yaşı, PSI, örneklem sayısı BAKIM verisidir; alım
//     kararı verirken bakılmaz. Model sayfasına ait. Buradan yalnız karara
//     dokunan tek ölçü kaldı: AL isabeti ve başabaş eşiği.
//   • Duyarlılık radarının varlık bazlı altı satırı — tek bir ruh hali
//     kadranına indi. Karar verirken altı varlığın haber puanı okunmuyor.
//   • İzleme listesi — o bir gezinme aracı, sayfanın içeriği değil.
// =============================================================================
import { useEffect, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import type { SharedData } from '../App'
import { API, ADMIN, adminFetch } from '../lib/api'
import { useConfig } from '../lib/useConfig'
import { ruhHaliHesapla, type AggRow } from '../lib/sentiment'
import { Gauge, DotStrip, Donut, BarWithRef } from '../components/viz'
import { TerimTip } from '../components/ui'

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
  n_live?: number | null
  n_live_days?: number | null
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
  headline?: string
  stance?: { direction: 'YUKARI' | 'YATAY' | 'AŞAĞI'; confidence: string }
  error?: string
}

const yuzde = (v: number | null | undefined, d = 1) =>
  v == null ? '—' : `%${(v * 100).toFixed(d)}`

export default function TodayPage() {
  const { assets, oracle, openChart } = useOutletContext<SharedData>()
  const cfg = useConfig()

  const [agg, setAgg] = useState<AggRow[] | null>(null)
  const [st, setSt] = useState<AdminStatus | null>(null)
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

  /** Sembol başına en son analiz. */
  const sonAnaliz = useMemo(() => {
    const m = new Map<string, typeof oracle[number]>()
    for (const o of oracle) {
      const v = m.get(o.symbol)
      if (!v || (o.analyzedAt ?? '') > (v.analyzedAt ?? '')) m.set(o.symbol, o)
    }
    return m
  }, [oracle])

  /** Bugünün AL çağrıları, güvene göre. */
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

  /** Sinyal dağılımı — halka grafiğin MEŞRU kullanımı: parçanın bütüne oranı. */
  const dagilim = useMemo(() => {
    let al = 0, tut = 0, sat = 0
    for (const o of sonAnaliz.values()) {
      if (o.recommendation.includes('ALIM')) al++
      else if (o.recommendation.includes('SAT')) sat++
      else tut++
    }
    return [
      { ad: 'Alım', deger: al,  renk: 'var(--u-up)' },
      { ad: 'Tut',  deger: tut, renk: 'var(--u-flat)' },
      { ad: 'Satış', deger: sat, renk: 'var(--u-down)' },
    ]
  }, [sonAnaliz])

  /**
   * Başabaş isabet oranı — hedef/stop mesafelerinden TÜRETİLİR, elle yazılmaz.
   * TP 3×ATR, SL 2×ATR ise kazanç/kayıp dengesinin tuttuğu nokta
   * SL/(TP+SL) = %40'tır. İşlem maliyeti bunu bir miktar yukarı iter; o
   * kısım burada hesaplanamıyor (ATR'nin fiyat karşılığı lazım), bu yüzden
   * etikette "maliyet hariç" yazıyor. Sayı config'ten geliyor ki eşikler
   * değişince burası sessizce eski kalmasın.
   */
  const basabas = useMemo(() => {
    const { tp_atr_mult: tp, sl_atr_mult: sl } = cfg.model
    return tp + sl > 0 ? (sl / (tp + sl)) * 100 : null
  }, [cfg])

  const alIsabet = st?.wf_buy_accuracy != null ? st.wf_buy_accuracy * 100 : null
  const psiDurum = (dr?.status ?? '').toUpperCase()
  const sapmaVar = psiDurum === 'DRIFT' || psiDurum === 'ALERT'
  const kalibre = dr?.calibration

  /** Kâr/zarar serisi henüz uç noktada yok — uydurmuyoruz, tek sayı gösteriyoruz. */
  const pozisyonSayisi = paper?.positions?.length ?? null
  const getiri = paper ? paper.total_return * 100 : null
  const kiyas = paper?.benchmark_return != null ? paper.benchmark_return * 100 : null

  const yon = yorum?.stance?.direction ?? null

  return (
    <div className="ui2" style={{ minHeight: '100%', padding: 'var(--u-s5)' }}>

      {/* Karo ızgarası — Yapı 3'ün gövdesi. Başlık satırı YOK, karolar EŞİT.
          Eşit yükseklik tasarımın kendisi: tırtıklı satırlar "altı gösterge"
          hissini bozup "yan yana dizilmiş farklı kutular"a çeviriyordu. */}
      <div className="u-grid6">

        {/* 1 · Bugünün çağrısı — sayfanın cevabı. Boyutla öne çıkar. */}
        <div className="u-tile u-tile--primary">
          <span className="u-label">Bugünün çağrısı</span>
          <div className="u-tile__body">
            {cagrilar.length === 0 ? (
              <span className="u-hero u-flat">Yok</span>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--u-s3)' }}>
                  <span className="u-hero">{cagrilar[0].symbol}</span>
                  <span style={{ fontSize: 'var(--u-t-lead)', fontWeight: 600, color: 'var(--u-up)' }}>
                    {cagrilar[0].recommendation}
                  </span>
                </div>
                <BarWithRef
                  deger={cagrilar[0].confidence * 100}
                  esik={basabas}
                  esikEtiket="başabaş (maliyet hariç)"
                />
              </>
            )}
          </div>
          <span className="u-sub u-sub--clamp">
            {cagrilar.length === 0
              ? 'Model bugün hiçbir sembolde alım demiyor.'
              : <>{cagrilar.length > 1 ? `${cagrilar.length - 1} çağrı daha · ` : ''}
                  <TerimTip ad="Güven">güven</TerimTip> doğrulanmış bir olasılık değildir</>}
          </span>
        </div>

        {/* 2 · Piyasa ruh hali — kadran */}
        <div className="u-tile">
          <span className="u-label">Piyasa ruh hali</span>
          <div className="u-tile__body" style={{ alignItems: 'center' }}>
            <Gauge deger={ruh.puan} genislik={176} />
          </div>
          <span className="u-sub u-sub--clamp" style={{ textAlign: 'center' }}>
            son 48 saatte {ruh.haberSayisi.toLocaleString('tr-TR')} haber
            {ruh.jeopolitik > 0 && ` · ${ruh.jeopolitik} jeopolitik`}
          </span>
        </div>

        {/* 3 · Piyasa genişliği — nokta şeridi, her nokta bir hisse */}
        <div className="u-tile">
          <span className="u-label">Piyasa genişliği</span>
          <div className="u-tile__body">
            <span className="u-big u-num">
              {genislik.toplam > 0 ? genislik.artida : '—'}
              <span style={{ fontSize: 'var(--u-t-num)', color: 'var(--u-text-3)',
                             fontWeight: 500 }}>/{genislik.toplam || '—'}</span>
            </span>
            <DotStrip artida={genislik.artida} toplam={genislik.toplam}
                      genislik={280} yukseklik={30} />
          </div>
          <span className="u-sub u-sub--clamp">günü artıda geçiren hisseler · her çubuk bir hisse</span>
        </div>

        {/* 4 · Sinyal dağılımı — halkanın meşru kullanımı (parça/bütün) */}
        <div className="u-tile">
          <span className="u-label">Model ne diyor</span>
          <div className="u-tile__body">
            <Donut
              dilimler={dagilim}
              boyut={104}
              ortaUst={String(dagilim.reduce((t, d) => t + d.deger, 0))}
              ortaAlt="sembol"
            />
          </div>
          <span className="u-sub u-sub--clamp">analiz edilen sembollerin karar dağılımı</span>
        </div>

        {/* 5 · Açık pozisyon */}
        <div className="u-tile">
          <span className="u-label">Kâğıt üstü portföy</span>
          <div className="u-tile__body">
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--u-s3)' }}>
              <span className={`u-big u-num ${getiri == null ? 'u-flat' : getiri >= 0 ? 'u-up' : 'u-down'}`}>
                {getiri == null ? '—' : `${getiri >= 0 ? '+' : ''}%${getiri.toFixed(1)}`}
              </span>
              <span className="u-exact">
                {pozisyonSayisi == null ? '' : `${pozisyonSayisi} açık pozisyon`}
              </span>
            </div>
          </div>
          <span className="u-sub u-sub--clamp">
            {kiyas != null && getiri != null
              ? <>Endeks aynı dönemde <b className="u-num">{kiyas >= 0 ? '+' : ''}%{kiyas.toFixed(1)}</b>
                  {' · '}fark <b className={`u-num ${getiri - kiyas >= 0 ? 'u-up' : 'u-down'}`}>
                    {getiri - kiyas >= 0 ? '+' : ''}%{(getiri - kiyas).toFixed(1)}</b></>
              : (paper?.market_status ?? 'durum bilinmiyor')}
          </span>
        </div>

        {/* 6 · Modele güven — MLOps'un tamamı değil, yalnız karara dokunan ölçü */}
        <div className="u-tile">
          <span className="u-label">Modele güvenilir mi</span>
          <div className="u-tile__body">
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--u-s2)' }}>
              <span className="u-big u-num">{alIsabet == null ? '—' : `%${alIsabet.toFixed(1)}`}</span>
              <span className="u-exact">AL isabeti</span>
            </div>
            <BarWithRef deger={alIsabet} esik={basabas}
                        esikEtiket="başabaş (maliyet hariç)" gosterDeger={false} />
          </div>
          <span className="u-sub u-sub--clamp">
            {sapmaVar && <b className="u-warn">Veri sapması var</b>}
            {sapmaVar && ' · '}
            {kalibre?.min_required
              ? `Kalibrasyon ${kalibre.n_evaluated ?? 0}/${kalibre.min_required} — dürüst okuma birkaç hafta sonra`
              : 'Kalibrasyon birikiyor'}
          </span>
        </div>
      </div>

      {/* ── Seçili çağrı: grafik + ayrıntı ─────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 340px',
                    gap: 'var(--u-s4)', marginTop: 'var(--u-s4)' }}>

        <div className="u-tile" style={{ minHeight: 340 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--u-s3)',
                        flexWrap: 'wrap' }}>
            {cagrilar.slice(0, 6).map(c => (
              <button key={c.symbol} onClick={() => setSecili(c.symbol)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer',
                               padding: '2px 0', font: 'inherit',
                               color: c.symbol === sembol ? 'var(--u-text)' : 'var(--u-text-3)',
                               fontWeight: c.symbol === sembol ? 600 : 400,
                               boxShadow: c.symbol === sembol
                                 ? 'inset 0 -2px 0 var(--u-accent)' : 'none' }}>
                {c.symbol}
              </button>
            ))}
            <div style={{ flexGrow: 1 }} />
            {varlik?.close != null && (
              <span className="u-num" style={{ fontSize: 'var(--u-t-num)', fontWeight: 600 }}>
                {varlik.close.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
              </span>
            )}
          </div>

          <div style={{ flexGrow: 1, display: 'flex', alignItems: 'center',
                        justifyContent: 'center', color: 'var(--u-text-4)',
                        fontSize: 'var(--u-t-small)', minHeight: 240 }}>
            {sembol
              ? <button onClick={() => openChart(sembol)}
                        style={{ background: 'none', border: '1px dashed var(--u-line-strong)',
                                 borderRadius: 'var(--u-r-md)', color: 'var(--u-text-3)',
                                 padding: 'var(--u-s5)', cursor: 'pointer', font: 'inherit' }}>
                  {sembol} grafiğini aç — bariyerli grafik bu sayfaya gömülecek
                </button>
              : 'Gösterilecek çağrı yok'}
          </div>
        </div>

        <div className="u-tile">
          {analiz ? (
            <>
              <span className="u-label">{analiz.symbol} · ayrıntı</span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))',
                            gap: 'var(--u-s3)', paddingTop: 2 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <span className="u-exact"><TerimTip ad="Hedef">Hedef</TerimTip></span>
                  <span className="u-num u-up" style={{ fontSize: 'var(--u-t-lead)', fontWeight: 600 }}>
                    {analiz.shortTermTarget?.toFixed(2) ?? '—'}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <span className="u-exact"><TerimTip ad="Stop">Stop</TerimTip></span>
                  <span className="u-num u-down" style={{ fontSize: 'var(--u-t-lead)', fontWeight: 600 }}>
                    {analiz.shortTermStop?.toFixed(2) ?? '—'}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <span className="u-exact"><TerimTip ad="R:R">R:R</TerimTip></span>
                  <span className="u-num" style={{ fontSize: 'var(--u-t-lead)', fontWeight: 600 }}>
                    {analiz.riskRewardRatio?.toFixed(2) ?? '—'}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <span className="u-exact">Boyut</span>
                  <span className="u-num" style={{ fontSize: 'var(--u-t-lead)', fontWeight: 600 }}>
                    {analiz.positionSizePct != null ? `%${(analiz.positionSizePct * 100).toFixed(1)}` : '—'}
                  </span>
                </div>
              </div>

              <div style={{ height: 1, background: 'var(--u-line)', margin: 'var(--u-s2) 0' }} />

              <span className="u-label">Piyasa bağlamı</span>
              <span className="u-sub">
                {yon
                  ? <>Kısa vade <b className={yon === 'YUKARI' ? 'u-up' : yon === 'AŞAĞI' ? 'u-down' : 'u-flat'}>
                      {yon.toLowerCase()}
                    </b>{yorum?.stance?.confidence ? ` (${yorum.stance.confidence})` : ''}.</>
                  : 'Piyasa yorumu henüz üretilmedi.'}
                {' '}Genişlik {genislik.artida}/{genislik.toplam},
                {' '}ruh hali {ruh.puan ?? '—'} ({ruh.etiket.toLocaleLowerCase('tr-TR')}).
              </span>

              <div style={{ flexGrow: 1 }} />
              <span className="u-sub" style={{ color: 'var(--u-text-4)' }}>
                WF örneklem {st?.wf_n_predictions?.toLocaleString('tr-TR') ?? '—'} ·
                {' '}yön doğruluğu {yuzde(st?.wf_accuracy)}
              </span>
            </>
          ) : (
            <span className="u-sub">Seçili çağrı yok.</span>
          )}
        </div>
      </div>
    </div>
  )
}
