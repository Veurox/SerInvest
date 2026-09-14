// =============================================================================
// SerInvest — Tarayıcı  (route: /tarayici)
// docs/PLAN_2026-08.md Faz F.
//
// Üç ayrı sayfa (AI Tavsiye · Dip Radarı · Temel Analiz) tek yoğun tabloda
// birleşti. Hepsi "hisse tara" işi yapıyordu ve aynı hisseyi üç ayrı yerde
// aramak gerekiyordu; artık her eski sayfa bir HAZIR GÖRÜNÜM (kolon kümesi +
// filtre) olarak duruyor.
//
// Dip taraması bilinçli olarak TEMBEL: sembol başına 1 yıllık grafik indirir,
// pahalıdır. Yalnız o görünüm seçilince ve kullanıcı isteyince çalışır.
// =============================================================================
import { useEffect, useMemo, useState } from 'react'
import { useOutletContext, useSearchParams } from 'react-router-dom'
import type { SharedData } from '../App'
import { DataTable, type Column } from '../components/ui'
import { EvidenceBanner, FundScreener } from '../components/finance'
import { API } from '../lib/api'
import { downloadCsv } from '../lib/format'
import { COMPANY_NAMES } from '../lib/companies'
import { scoreDip, isDipCandidate, type ChartPoint, type DipScore } from '../lib/dipDetector'
import type { PriceData, OracleAnalysis, FundamentalData } from '../lib/types'

type ViewId = 'ai' | 'dip' | 'temel' | 'fon' | 'tum'

const VIEWS: { id: ViewId; label: string; hint: string }[] = [
  { id: 'ai',    label: 'AI Tavsiye',   hint: 'Modelin ALIM dediği hisseler' },
  { id: 'dip',   label: 'Dip Fırsatı',  hint: 'Trend sağlam, geri çekilmiş' },
  { id: 'temel', label: 'Temel Analiz', hint: 'Temel skor, F/K, PD/DD, ROE' },
  // Fonlar AYRI SAYFA değil burada bir görünüm: Faz F'de üç tarama sayfasını
  // tek yerde birleştirme kararı bozulmuyor (docs/PLAN_TEFAS.md §4).
  { id: 'fon',   label: 'Fonlar',       hint: 'TEFAS fonları — akran sırası, eşik farkı' },
  { id: 'tum',   label: 'Tümü',         hint: 'Bütün kolonlar' },
]

interface Row {
  sym: string
  asset: PriceData
  oracle?: OracleAnalysis
  fund?: FundamentalData
  dip?: DipScore
  chgPct: number | null
}

const nf = (d = 2) => new Intl.NumberFormat('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d })
const num = (v: number | null | undefined, d = 2) => v == null ? '—' : nf(d).format(v)

// ── Kayıtlı görünümler ───────────────────────────────────────────────────────
// Hazır görünümler (AI/Dip/Temel) sabittir; bunlar KULLANICININ kendi
// kombinasyonu: görünüm + arama + güven eşiği + gizlediği kolonlar.
const LS_VIEWS = 'si_screener_views'

interface SavedView {
  name: string; view: ViewId; q: string; minConf: number; hidden: string[]
}

// Kolon seçicide gizlenmiş kolonların adını göstermek için — kolon listesi
// görünüme göre değiştiği için gizlenen kolonun başlığı o an elde olmuyor.
const COLUMN_LABELS: Record<string, string> = {
  close: 'Fiyat', chg: 'Değişim',
  rec: 'AI Kararı', conf: 'Güven', target: 'Hedef', stop: 'Stop', rr: 'R:R',
  dipScore: 'Dip Skoru', pullback: 'Geri çekilme',
  fundScore: 'Temel Skor',
  pe: 'F/K', pb: 'PD/DD', roe: 'ROE', divy: 'Temettü', rsi: 'RSI',
}

function readSaved(): SavedView[] {
  try {
    const raw = localStorage.getItem(LS_VIEWS)
    const v = raw ? JSON.parse(raw) : []
    return Array.isArray(v) ? v : []
  } catch { return [] }
}

/** Aynı anda en fazla `n` istek — 96 sembolü paralel indirmek tarayıcıyı boğar. */
async function pool<T>(items: T[], fn: (x: T) => Promise<void>, n = 5) {
  const q = [...items]
  await Promise.all(Array.from({ length: n }, async () => {
    while (q.length) { const it = q.shift(); if (it !== undefined) await fn(it) }
  }))
}

export default function ScreenerPage() {
  const { assets, oracle, fundamentals, openChart } = useOutletContext<SharedData>()
  const [sp, setSp] = useSearchParams()
  const view = (VIEWS.some(v => v.id === sp.get('g')) ? sp.get('g') : 'ai') as ViewId
  const setView = (v: ViewId) => setSp(v === 'ai' ? {} : { g: v }, { replace: true })

  const [q, setQ] = useState('')
  const [dips, setDips] = useState<Map<string, DipScore>>(new Map())
  const [scanning, setScanning] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [minConf, setMinConf] = useState(0)          // güven filtresi (0 = kapalı)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [picker, setPicker] = useState(false)
  const [saved, setSaved] = useState<SavedView[]>(() => readSaved())

  // Sembol → en son analiz / temel veri
  const oracleBy = useMemo(() => {
    const m = new Map<string, OracleAnalysis>()
    for (const o of oracle) {
      const prev = m.get(o.symbol)
      if (!prev || (o.analyzedAt ?? '') > (prev.analyzedAt ?? '')) m.set(o.symbol, o)
    }
    return m
  }, [oracle])

  const fundBy = useMemo(
    () => new Map((fundamentals ?? []).map(f => [f.symbol, f])), [fundamentals])

  const rows = useMemo<Row[]>(() => {
    const needle = q.trim().toLocaleUpperCase('tr-TR')
    return assets
      .filter(a => a.assetType === 'BIST')
      .filter(a => !needle || a.symbol.toLocaleUpperCase('tr-TR').includes(needle)
                || (COMPANY_NAMES[a.symbol] ?? '').toLocaleUpperCase('tr-TR').includes(needle))
      .map(a => ({
        sym: a.symbol,
        asset: a,
        oracle: oracleBy.get(a.symbol),
        fund: fundBy.get(a.symbol),
        dip: dips.get(a.symbol),
        chgPct: a.close != null && a.open ? ((a.close - a.open) / a.open) * 100 : null,
      }))
      .filter(r => {
        if (view === 'ai')  return r.oracle?.recommendation.includes('ALIM')
        if (view === 'dip') return (r.dip?.score ?? 0) >= 3
        if (view === 'temel') return !!r.fund
        return true
      })
      // Güven eşiği: modelin ham çıktısı üzerinde. Uyarı şeridi bunun
      // doğrulanmış bir olasılık OLMADIĞINI söylüyor; filtre yine de kullanışlı
      // çünkü listeyi daraltıyor.
      .filter(r => minConf === 0 || (r.oracle?.confidence ?? 0) >= minConf)
  }, [assets, oracleBy, fundBy, dips, view, q, minConf])

  // Dip taraması — yalnız o görünümde ve elle tetiklenince
  const scanDips = async () => {
    const cands = assets.filter(isDipCandidate)
    setScanning(true); setProgress({ done: 0, total: cands.length })
    const found = new Map<string, DipScore>()
    let done = 0
    await pool(cands, async a => {
      try {
        const r = await fetch(`${API}/market/${encodeURIComponent(a.symbol)}/chart?tf=1Y`)
        if (r.ok) {
          const d = await r.json()
          const s = scoreDip((d.points ?? []) as ChartPoint[], a)
          if (s && s.score >= 3) found.set(a.symbol, s)
        }
      } catch { /* sembolü atla */ }
      done++; setProgress({ done, total: cands.length })
    }, 5)
    setDips(found); setScanning(false)
  }

  useEffect(() => { if (view !== 'dip') setProgress({ done: 0, total: 0 }) }, [view])

  // ── Kolonlar ──────────────────────────────────────────────────────────────
  const columns = useMemo<Column<Row>[]>(() => {
    const base: Column<Row>[] = [
      {
        key: 'sym', header: 'Sembol', width: 150,
        sortValue: r => r.sym,
        render: r => (
          <span>
            <b style={{ color: 'var(--text-primary)' }}>{r.sym}</b>
            {COMPANY_NAMES[r.sym] && (
              <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-2xs)', marginLeft: 6 }}>
                {COMPANY_NAMES[r.sym]}
              </span>
            )}
          </span>
        ),
      },
      { key: 'close', header: 'Fiyat', numeric: true, width: 84,
        sortValue: r => r.asset.close ?? null,
        render: r => num(r.asset.close) },
      { key: 'chg', header: 'Değişim', numeric: true, width: 84,
        sortValue: r => r.chgPct,
        render: r => r.chgPct == null ? '—' : (
          <span className={r.chgPct > 0 ? 'dir-up' : r.chgPct < 0 ? 'dir-down' : undefined}>
            {Math.abs(r.chgPct).toFixed(2)}%
          </span>
        ) },
    ]

    const ai: Column<Row>[] = [
      { key: 'rec', header: 'AI Kararı', width: 104, terim: 'AI Kararı',
        sortValue: r => r.oracle?.recommendation ?? '',
        render: r => {
          const rec = r.oracle?.recommendation
          if (!rec) return <span style={{ color: 'var(--text-disabled)' }}>—</span>
          const buy = rec.includes('ALIM')
          return <span style={{ fontSize: 'var(--text-2xs)', fontWeight: 700, padding: '1px 6px',
                                color: buy ? 'var(--profit)' : 'var(--text-muted)',
                                background: buy ? 'var(--profit-bg)' : 'var(--bg-glass)',
                                border: `1px solid ${buy ? 'var(--profit-border)' : 'var(--border-default)'}` }}>
            {rec}</span>
        } },
      { key: 'conf', header: 'Güven', numeric: true, width: 66, terim: 'Güven',
        sortValue: r => r.oracle?.confidence ?? null,
        render: r => r.oracle ? `%${(r.oracle.confidence * 100).toFixed(0)}` : '—' },
      { key: 'target', header: 'Hedef', numeric: true, width: 82, priority: 2, terim: 'Hedef',
        sortValue: r => r.oracle?.shortTermTarget ?? null,
        render: r => num(r.oracle?.shortTermTarget) },
      { key: 'stop', header: 'Stop', numeric: true, width: 82, priority: 2, terim: 'Stop',
        sortValue: r => r.oracle?.shortTermStop ?? null,
        render: r => num(r.oracle?.shortTermStop) },
      { key: 'rr', header: 'R:R', numeric: true, width: 60, priority: 3, terim: 'R:R',
        sortValue: r => r.oracle?.riskRewardRatio ?? null,
        render: r => r.oracle?.riskRewardRatio != null ? r.oracle.riskRewardRatio.toFixed(2) : '—' },
    ]

    const dip: Column<Row>[] = [
      { key: 'dipScore', header: 'Dip Skoru', numeric: true, width: 82, terim: 'Dip Skoru',
        sortValue: r => r.dip?.score ?? null,
        render: r => r.dip
          ? <b style={{ color: r.dip.score >= 4 ? 'var(--profit)' : 'var(--warning)' }}>{r.dip.score}/5</b>
          : '—' },
      { key: 'pullback', header: 'Geri çekilme', numeric: true, width: 96, terim: 'Geri çekilme',
        sortValue: r => r.dip?.pullbackPct ?? null,
        render: r => r.dip ? `%${r.dip.pullbackPct.toFixed(1)}` : '—' },
    ]

    const temel: Column<Row>[] = [
      // Faz F birleşmesinde kaybolmuştu (17.08.2026 kullanıcı sorusu ortaya
      // çıkardı): arka uç 9 metrikten ağırlıklı 0-1 skoru zaten hesaplıyor
      // ama tablo yalnız ham oranları gösteriyordu — "en iyi hangisi?"
      // sorusunun cevabı ekranda yoktu. 0.50 nötrdür: ya gerçekten vasat
      // ya da veri %55 tamamlığın altında (fundamental-service böyle döner).
      { key: 'fundScore', header: 'Temel Skor', numeric: true, width: 88, terim: 'Temel Skor',
        sortValue: r => r.fund?.fundamentalScore ?? null,
        render: r => {
          const s = r.fund?.fundamentalScore
          if (s == null) return '—'
          const color = s >= 0.60 ? 'var(--profit)' : s <= 0.40 ? 'var(--loss)' : 'var(--text-muted)'
          return (
            <b style={{ color }}
               title="9 temel metrikten ağırlıklı skor (F/K, PD/DD, ROE, borç, büyüme, temettü, FAVÖK). 0.50 = nötr — vasat ya da veri yetersiz.">
              {s.toFixed(2)}
            </b>
          )
        } },
      { key: 'pe', header: 'F/K', numeric: true, width: 70, terim: 'F/K',
        sortValue: r => r.fund?.peRatio ?? null, render: r => num(r.fund?.peRatio, 1) },
      { key: 'pb', header: 'PD/DD', numeric: true, width: 70, terim: 'PD/DD',
        sortValue: r => r.fund?.pbRatio ?? null, render: r => num(r.fund?.pbRatio, 2) },
      { key: 'roe', header: 'ROE', numeric: true, width: 70, priority: 2, terim: 'ROE',
        sortValue: r => r.fund?.roe ?? null,
        render: r => r.fund?.roe == null ? '—' : `%${(r.fund.roe * 100).toFixed(1)}` },
      { key: 'divy', header: 'Temettü', numeric: true, width: 78, priority: 3, terim: 'Temettü',
        sortValue: r => r.fund?.dividendYield ?? null,
        render: r => r.fund?.dividendYield == null ? '—' : `%${(r.fund.dividendYield * 100).toFixed(2)}` },
    ]

    const rsi: Column<Row>[] = [
      { key: 'rsi', header: 'RSI', numeric: true, width: 62, priority: 2, terim: 'RSI',
        sortValue: r => r.asset.rsi ?? null,
        render: r => r.asset.rsi == null ? '—' : (
          <span style={{ color: r.asset.rsi > 70 ? 'var(--loss)' : r.asset.rsi < 30 ? 'var(--profit)' : undefined }}>
            {r.asset.rsi.toFixed(0)}
          </span>
        ) },
    ]

    const set = view === 'ai'    ? [...base, ...ai, ...rsi]
              : view === 'dip'   ? [...base, ...dip, ...rsi, ...ai.slice(0, 2)]
              : view === 'temel' ? [...base, ...temel, ...ai.slice(0, 2)]
              : [...base, ...ai, ...dip, ...temel, ...rsi]
    // Sembol kolonu gizlenemez — satırın kimliği o.
    return set.filter(c => c.key === 'sym' || !hidden.has(c.key))
  }, [view, hidden])

  // Kolon seçicinin listesi: görünümün TÜM kolonları (gizlenmişler dahil)
  const allColumns = useMemo(() => {
    const seen = new Map<string, string>()
    for (const c of columns) seen.set(c.key, c.header)
    // Gizlenmiş kolonların başlığını da bilmemiz gerek; sabit bir sözlükten al.
    for (const [k, h] of Object.entries(COLUMN_LABELS)) if (!seen.has(k)) seen.set(k, h)
    return [...seen.entries()]
  }, [columns])

  const exportCsv = () => {
    const cols = columns
    downloadCsv(
      cols.map(c => c.header),
      rows.map(r => cols.map(c => {
        // Kolonun sortValue'su varsa ham değeri yaz — CSV'ye JSX değil sayı gider.
        const v = c.sortValue ? c.sortValue(r) : null
        if (v != null) return v as string | number
        // sortValue yoksa sembol gibi metin kolonudur
        return c.key === 'sym' ? r.sym : ''
      })),
      `tarayici-${view}-${new Date().toISOString().slice(0, 10)}.csv`,
    )
  }

  const saveView = () => {
    const name = prompt('Görünüm adı:')?.trim()
    if (!name) return
    const next = [...saved.filter(v => v.name !== name),
                  { name, view, q, minConf, hidden: [...hidden] }]
    setSaved(next)
    localStorage.setItem(LS_VIEWS, JSON.stringify(next))
  }

  const loadView = (v: SavedView) => {
    setView(v.view); setQ(v.q); setMinConf(v.minConf); setHidden(new Set(v.hidden))
  }

  const deleteView = (name: string) => {
    const next = saved.filter(v => v.name !== name)
    setSaved(next)
    localStorage.setItem(LS_VIEWS, JSON.stringify(next))
  }

  return (
    <div className="ui2" style={{ minHeight: '100%', padding: 'var(--u-s4) var(--u-s5) var(--u-s5)' }}>
      {/* Sayfanın başlığı bir SORU (docs/PLAN_ARAYUZ.md §1). "Tarayıcı" bir
          modül adıydı; "Hangisini alayım?" kullanıcının gerçekten sorduğu şey. */}
      <div className="u-band__head" style={{ marginBottom: 'var(--u-s3)' }}>
        <h1 className="u-band__q">Hangisini alayım?</h1>
        <span className="u-sub">
          {VIEWS.find(v => v.id === view)?.hint}
          {view !== 'fon' && <> · {rows.length} sonuç</>}
        </span>
      </div>

      <div className="mtabs" role="tablist" aria-label="Hazır görünümler">
        {VIEWS.map(v => (
          <button key={v.id} role="tab" aria-selected={view === v.id}
                  onClick={() => setView(v.id)}
                  className={`mtab${view === v.id ? ' mtab--on' : ''}`}>
            {v.label}
            <span className="mtab__q">{v.hint}</span>
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
                    marginBottom: 'var(--space-3)' }}>
        <input value={q} onChange={e => setQ(e.target.value)}
               placeholder={view === 'fon' ? 'Fon kodu veya adı ara…' : 'Sembol veya şirket ara…'}
               style={{ flex: '0 1 260px', padding: '5px 9px', fontSize: 12,
                        color: 'var(--text-primary)', background: 'var(--bg-surface)',
                        border: '1px solid var(--border-default)', outline: 'none' }} />

        {/* Arama dışındaki denetimler hisse tablosuna ait: güven eşiği, kolon
            seçici, dip taraması. Fon tablosunun kendi denetimleri var (dönem,
            kategori) — ikisini karıştırmak çalışmayan düğmeler üretirdi. */}
        {view !== 'fon' && <>
        {view === 'dip' && (
          <button onClick={scanDips} disabled={scanning}
                  style={{ fontSize: 11.5, fontWeight: 700, padding: '5px 12px',
                           cursor: scanning ? 'wait' : 'pointer',
                           border: '1px solid var(--accent-border)',
                           background: 'var(--accent-bg)', color: 'var(--accent)' }}>
            {scanning ? `Taranıyor ${progress.done}/${progress.total}…` : 'Dip taraması başlat'}
          </button>
        )}
        {view === 'dip' && !scanning && dips.size === 0 && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Dip taraması sembol başına 1 yıllık grafik indirir — bu yüzden elle başlatılır.
          </span>
        )}

        {/* Güven eşiği — modelin ham çıktısı üzerinde, listeyi daraltmak için */}
        <span className="mc-bar__label">Min güven</span>
        <span className="mc-seg" role="group" aria-label="Asgari güven">
          {[0, 0.55, 0.6, 0.7].map(c => (
            <button key={c} aria-pressed={minConf === c} onClick={() => setMinConf(c)}>
              {c === 0 ? 'Tümü' : `%${(c * 100).toFixed(0)}`}
            </button>
          ))}
        </span>

        {/* Kolon seçici */}
        <span style={{ position: 'relative' }}>
          <button onClick={() => setPicker(p => !p)} className="scr-btn">
            Kolonlar {hidden.size > 0 && <b>({allColumns.length - hidden.size}/{allColumns.length})</b>}
          </button>
          {picker && (
            <div className="scr-pop" onMouseLeave={() => setPicker(false)}>
              {allColumns.map(([key, label]) => (
                <label key={key} className="scr-pop__row">
                  <input type="checkbox" checked={!hidden.has(key)} disabled={key === 'sym'}
                         onChange={() => setHidden(h => {
                           const n = new Set(h)
                           n.has(key) ? n.delete(key) : n.add(key)
                           return n
                         })} />
                  {label}
                </label>
              ))}
              {hidden.size > 0 && (
                <button className="scr-pop__clear" onClick={() => setHidden(new Set())}>
                  Tümünü göster
                </button>
              )}
            </div>
          )}
        </span>

        <button onClick={exportCsv} className="scr-btn" title={`${rows.length} satır, ${columns.length} kolon`}>
          CSV
        </button>
        <button onClick={saveView} className="scr-btn">Görünümü kaydet</button>

        {saved.length > 0 && (
          <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
            {saved.map(v => (
              <span key={v.name} className="scr-chip">
                <button onClick={() => loadView(v)} title={`${v.view} · ${v.hidden.length} kolon gizli`}>
                  {v.name}
                </button>
                <button onClick={() => deleteView(v.name)} aria-label={`${v.name} görünümünü sil`}>×</button>
              </span>
            ))}
          </span>
        )}
        </>}
      </div>

      {view === 'fon' ? <FundScreener q={q} /> : <>

      {/* Model sıralamasının kanıt durumu — AI kolonları görünürken uyarı şart */}
      {(view === 'ai' || view === 'tum') && <EvidenceBanner />}

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={r => r.sym}
        onRowClick={r => openChart(r.sym)}
        defaultSort={view === 'dip'   ? { key: 'dipScore', dir: 'desc' }
                   : view === 'ai'    ? { key: 'conf', dir: 'desc' }
                   : view === 'temel' ? { key: 'fundScore', dir: 'desc' }
                   : { key: 'sym', dir: 'asc' }}
        maxHeight="calc(100vh - 320px)"
        empty={view === 'dip' && dips.size === 0
          ? 'Henüz tarama yapılmadı — yukarıdaki düğmeye bas.'
          : 'Bu görünümde eşleşen hisse yok.'}
      />
      </>}
    </div>
  )
}
