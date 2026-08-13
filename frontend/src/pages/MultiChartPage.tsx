// =============================================================================
// SerInvest — Çoklu Grafik  (route: /coklu-grafik)
//
// 1/2/4/6/8 hisseyi aynı anda takip etme ızgarası. Bir grafiğe tıklamak o
// sembolün TAM detay panelini açar (App.tsx'teki SymbolDrawer: büyük grafik,
// teknik göstergeler, AI hedef/stop, hacim).
//
// Tasarım: keskin hatlı terminal. Yuvarlatma yok, hücreler arası tek piksel
// ayraç, yoğun başlık. Düzen ve semboller localStorage'da saklanır — kullanıcı
// kurduğu ekranı her açılışta yeniden kurmak zorunda kalmasın.
// =============================================================================
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import type { SharedData } from '../App'
import { ChartTile, type TF } from '../components/multichart/ChartTile'
import { SymbolPicker } from '../components/multichart/SymbolPicker'
import { latestBySymbol } from '../components/terminal'

const LAYOUTS = [1, 2, 4, 6, 8] as const
const TFS: TF[] = ['1H', '1D', '1W', '1M', '3M', '1Y', '5Y']
const TF_LABEL: Record<TF, string> = {
  '1H': '1S', '1D': '1G', '1W': '1H', '1M': '1A', '3M': '3A', '1Y': '1Y', '5Y': '5Y',
}

const LS_SLOTS  = 'si_mc_slots'
const LS_LAYOUT = 'si_mc_layout'
const LS_TF     = 'si_mc_tf'
const LS_KIND   = 'si_mc_kind'

const readLS = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch { return fallback }
}

export default function MultiChartPage() {
  const { assets, oracle, openChart } = useOutletContext<SharedData>()

  const latest = useMemo(() => latestBySymbol(oracle), [oracle])

  const [layout, setLayout] = useState<number>(() => {
    const v = readLS<number>(LS_LAYOUT, 4)
    return (LAYOUTS as readonly number[]).includes(v) ? v : 4
  })
  const [tf, setTf]       = useState<TF>(() => readLS<TF>(LS_TF, '3M'))
  const [kind, setKind]   = useState<'candle' | 'line'>(() => readLS<'candle' | 'line'>(LS_KIND, 'candle'))
  const [slots, setSlots] = useState<string[]>(() => readLS<string[]>(LS_SLOTS, []))
  const [active, setActive] = useState(0)
  const [adding, setAdding] = useState<number | null>(null)

  // Varsayılan doldurma: en güvenli AL sinyalleri, yoksa ilk BIST hisseleri.
  // Yalnızca kayıt yoksa çalışır — kullanıcının kurduğu ekranı ezmez.
  useEffect(() => {
    if (slots.length > 0 || assets.length === 0) return
    const buys = [...latest.values()]
      .filter(o => o.recommendation.includes('ALIM'))
      .sort((a, b) => b.confidence - a.confidence)
      .map(o => o.symbol)
    const bist = assets.filter(a => a.assetType === 'BIST').map(a => a.symbol)
    const seed = [...new Set([...buys, ...bist])].slice(0, 8)
    if (seed.length) setSlots(seed)
  }, [assets, latest, slots.length])

  useEffect(() => { localStorage.setItem(LS_SLOTS, JSON.stringify(slots)) }, [slots])
  useEffect(() => { localStorage.setItem(LS_LAYOUT, JSON.stringify(layout)) }, [layout])
  useEffect(() => { localStorage.setItem(LS_TF, JSON.stringify(tf)) }, [tf])
  useEffect(() => { localStorage.setItem(LS_KIND, JSON.stringify(kind)) }, [kind])

  // ── Klavye (Faz H) — terminal hissi: fare olmadan kullanılabilsin ─────────
  // Bir metin kutusuna yazarken kısayol ÇALIŞMAZ; aksi hâlde sembol ararken
  // "1" yazmak düzeni değiştirirdi.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (e.ctrlKey || e.metaKey || e.altKey) return

      if (e.key >= '1' && e.key <= '8') {
        const n = Number(e.key)
        if ((LAYOUTS as readonly number[]).includes(n)) { e.preventDefault(); setLayout(n) }
        return
      }
      if (e.key === 'c' || e.key === 'C') { setKind(k => (k === 'candle' ? 'line' : 'candle')); return }
      if (e.key === 'ArrowRight') { e.preventDefault(); setActive(a => Math.min(layout - 1, a + 1)); return }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); setActive(a => Math.max(0, a - 1)); return }
      if (e.key === 'Enter') {
        const sym = slots[active]
        if (sym) { e.preventDefault(); openChart(sym) }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [layout, slots, active, openChart])

  const setSlot = useCallback((i: number, symbol: string) => {
    setSlots(prev => {
      const next = [...prev]
      while (next.length <= i) next.push('')
      next[i] = symbol
      return next
    })
  }, [])

  const removeSlot = useCallback((i: number) => {
    setSlots(prev => prev.filter((_, k) => k !== i))
  }, [])

  // Görünen hücreler: düzen kadar; eksikler boş kart olarak çizilir.
  const visible = useMemo(
    () => Array.from({ length: layout }, (_, i) => slots[i] ?? ''),
    [slots, layout],
  )

  return (
    <div className="mc-page">
      <div className="mc-bar">
        <span className="mc-bar__label">Düzen</span>
        <span className="mc-seg" role="group" aria-label="Grafik sayısı">
          {LAYOUTS.map(n => (
            <button key={n} aria-pressed={layout === n} onClick={() => setLayout(n)}
                    title={`${n} grafik`}>{n}</button>
          ))}
        </span>

        <span className="mc-bar__label">Aralık</span>
        <span className="mc-seg" role="group" aria-label="Zaman aralığı">
          {TFS.map(t => (
            <button key={t} aria-pressed={tf === t} onClick={() => setTf(t)}
                    title={t}>{TF_LABEL[t]}</button>
          ))}
        </span>

        <span className="mc-bar__label">Tip</span>
        <span className="mc-seg" role="group" aria-label="Grafik tipi">
          <button aria-pressed={kind === 'candle'} onClick={() => setKind('candle')}
                  title="Mum grafiği">▮ Mum</button>
          <button aria-pressed={kind === 'line'} onClick={() => setKind('line')}
                  title="Kapanış çizgisi">╱ Çizgi</button>
        </span>

        <span style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--text-muted)' }}>
          Başlığa tıkla → sembol · Grafiğe tıkla → detay ·{' '}
          <b style={{ color: 'var(--text-disabled)' }}>1-8</b> düzen ·{' '}
          <b style={{ color: 'var(--text-disabled)' }}>C</b> mum/çizgi ·{' '}
          <b style={{ color: 'var(--text-disabled)' }}>← →</b> hücre ·{' '}
          <b style={{ color: 'var(--text-disabled)' }}>Enter</b> detay
        </span>
      </div>

      <div className="mc-grid" data-n={layout}>
        {visible.map((sym, i) =>
          sym ? (
            <ChartTile
              key={`${i}-${sym}`}
              symbol={sym}
              tf={tf}
              kind={kind}
              assets={assets}
              analysis={latest.get(sym) ?? null}
              density={layout}
              active={active === i}
              onActivate={() => setActive(i)}
              onOpenDetail={openChart}
              onChangeSymbol={s => setSlot(i, s)}
              onRemove={() => removeSlot(i)}
            />
          ) : (
            <div className="mc-empty" key={`empty-${i}`} style={{ position: 'relative' }}>
              {adding === i ? (
                <SymbolPicker
                  assets={assets}
                  onPick={s => { setSlot(i, s); setAdding(null) }}
                  onClose={() => setAdding(null)}
                />
              ) : (
                <button onClick={() => setAdding(i)}>+ SEMBOL EKLE</button>
              )}
            </div>
          ),
        )}
      </div>
    </div>
  )
}
