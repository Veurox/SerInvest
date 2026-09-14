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
// yalnız BU KARARA dokunan ölçüler var — AL isabeti ve başabaş eşiği.
// =============================================================================
import { useEffect, useMemo, useState } from 'react'
import { useOutletContext, useSearchParams } from 'react-router-dom'
import type { SharedData } from '../App'
import { API, ADMIN, adminFetch } from '../lib/api'
import { useConfig } from '../lib/useConfig'
import { ruhHaliHesapla, type AggRow } from '../lib/sentiment'
import { suruculeriTopla } from '../lib/drivers'
import { COMPANY_NAMES } from '../lib/companies'
import { PriceBarriers, BarWithRef, ContribBars, DotStrip } from '../components/viz'
import { TerimTip } from '../components/ui'

interface AdminStatus {
  wf_buy_accuracy?: number | null
  wf_n_predictions?: number | null
}
interface Commentary {
  stance?: { direction: 'YUKARI' | 'YATAY' | 'AŞAĞI'; confidence: string }
  error?: string
}

const sayi = (v: number | null | undefined, d = 2) =>
  v == null ? '—' : v.toLocaleString('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d })

const YON_RENK: Record<string, string> = {
  YUKARI: 'var(--u-up)', 'AŞAĞI': 'var(--u-down)', YATAY: 'var(--u-flat)',
}

export default function SymbolPage() {
  const { assets, oracle, news, fundamentals } = useOutletContext<SharedData>()
  const cfg = useConfig()
  const [sp, setSp] = useSearchParams()

  const [agg, setAgg] = useState<AggRow[] | null>(null)
  const [st, setSt] = useState<AdminStatus | null>(null)
  const [yorum, setYorum] = useState<Commentary | null>(null)
  const [ara, setAra] = useState('')

  useEffect(() => {
    let dur = false
    const al = () => {
      fetch(`${API}/signals/aggregate?hours=48`).then(r => r.ok ? r.json() : null)
        .then(d => { if (!dur && d) setAgg(d) }).catch(() => {})
      adminFetch(`${ADMIN}/status`).then(r => r.ok ? r.json() : null)
        .then(d => { if (!dur && d) setSt(d) }).catch(() => {})
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

  const alIsabet = st?.wf_buy_accuracy != null ? st.wf_buy_accuracy * 100 : null
  const yon = yorum?.stance?.direction ?? null

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

  const alim = !!analiz && analiz.recommendation.includes('ALIM')
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
              <span className="u-num u-exact">%{(c.confidence * 100).toFixed(0)}</span>
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
          <span className="u-num" style={{ fontSize: 'var(--u-t-num)', fontWeight: 600 }}>
            {sayi(varlik?.close, ondalik)}
          </span>
          {degisim != null && (
            <span className={`u-num ${degisim >= 0 ? 'u-up' : 'u-down'}`}
                  style={{ fontSize: 'var(--u-t-body)', fontWeight: 600 }}>
              {degisim >= 0 ? '+' : ''}{degisim.toFixed(2)}%
            </span>
          )}
          {sembol && COMPANY_NAMES[sembol] && (
            <span className="u-sub">{COMPANY_NAMES[sembol]}</span>
          )}
          <div style={{ flexGrow: 1 }} />
          {analiz && (
            <span className="u-sub">
              <TerimTip ad="Hedef">Hedef</TerimTip>{' '}
              <b className="u-num u-up">{sayi(analiz.shortTermTarget, ondalik)}</b>
              {' · '}<TerimTip ad="Stop">Stop</TerimTip>{' '}
              <b className="u-num u-down">{sayi(analiz.shortTermStop, ondalik)}</b>
              {' · '}<TerimTip ad="R:R">R:R</TerimTip>{' '}
              <b className="u-num">{analiz.riskRewardRatio?.toFixed(2) ?? '—'}</b>
              {' · '}Boyut{' '}
              <b className="u-num">
                {analiz.positionSizePct != null
                  ? `%${(analiz.positionSizePct * 100).toFixed(1)}` : '—'}
              </b>
            </span>
          )}
        </div>

        {/* Grafik: sayfanın ana görseli */}
        {sembol && (
          <PriceBarriers sembol={sembol} analiz={analiz} yukseklik={360}
                         ondalik={ondalik} />
        )}

        {/* İki sütun: gerekçe (sol) · güven (sağ) */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 330px',
                      gap: 'var(--u-s5)', alignItems: 'start' }}>

          <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--u-s3)',
                            minWidth: 0 }}>
            <h2 className="u-band__q" style={{ fontSize: 'var(--u-t-lead)' }}>
              Bu karara ne itiyor?
            </h2>
            <ContribBars ogeler={surucular.map(s => ({
              ad: s.ad, deger: s.etki, baslik: s.metin,
            }))} />
            <span className="u-sub">
              Çubuk uzunluğu etkenler ARASINDAKİ göreli ağırlığı gösterir.
              Sayısı çıkarılamayan etken çubuksuz kalır — uydurma bir çubuk
              olmayan bir ölçüm demek olurdu.
            </span>

            {sembolHaber.length > 0 && (
              <>
                <div style={{ height: 1, background: 'var(--u-line)',
                              margin: 'var(--u-s2) 0' }} />
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

          <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--u-s3)',
                            minWidth: 0 }}>
            <h2 className="u-band__q" style={{ fontSize: 'var(--u-t-lead)' }}>
              Bu karara güvenmeli miyim?
            </h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between',
                            alignItems: 'baseline' }}>
                <span className="u-sub">Modelin AL isabeti</span>
                <span className="u-num" style={{ fontWeight: 600 }}>
                  {alIsabet == null ? '—' : `%${alIsabet.toFixed(1)}`}
                </span>
              </div>
              <BarWithRef deger={alIsabet} esik={basabas}
                          esikEtiket="başabaş (maliyet hariç)" gosterDeger={false} />
            </div>

            {analiz && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between',
                              alignItems: 'baseline' }}>
                  <span className="u-sub">
                    Bu çağrının <TerimTip ad="Güven">güveni</TerimTip>
                  </span>
                  <span className="u-num" style={{ fontWeight: 600 }}>
                    %{(analiz.confidence * 100).toFixed(0)}
                  </span>
                </div>
                <BarWithRef deger={analiz.confidence * 100} esik={basabas}
                            gosterDeger={false} />
              </div>
            )}

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
                          genislik={300} yukseklik={14} />
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between',
                            alignItems: 'baseline' }}>
                <span className="u-sub">Haber duyarlılığı</span>
                <span className="u-num" style={{ fontWeight: 600 }}>
                  {ruh.puan ?? '—'} <span className="u-exact">{ruh.etiket.toLocaleLowerCase('tr-TR')}</span>
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
                      {temel.roe == null ? '—' : `%${(temel.roe * 100).toFixed(1)}`}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="u-sub"><TerimTip ad="Temel Skor">Skor</TerimTip></span>
                    <span className="u-num u-exact">{sayi(temel.fundamentalScore, 2)}</span>
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
