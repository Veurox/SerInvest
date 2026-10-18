// =============================================================================
// SerInvest — Çoklu Grafik  (route: /coklu-grafik)
//
// PANO + ODAK modeli (17.08.2026 yeniden tasarım, kullanıcı kararı).
//
// Eski model başarısızdı: her hücre bağımsız pan/zoom yapıyordu ve gövdeye
// tıklamak detay panelini açıyordu. Ama grafik kaydırma SÜRÜKLEYEREK yapılır ve
// tarayıcı sürükleme bırakılınca da `click` üretir → her kaydırma denemesi
// paneli açıyordu. Ölçüldü: sürükleme öncesi panel kapalı, sonrası açık.
// Kullanıcının "kaydırması zor" dediği şey aslında İMKÂNSIZDI.
//
// Yeni model:
//   • Izgara bir PANOdur: hücreler yalnız gösterir, fareyle tek tek oynanmaz.
//     4-8 küçük hücrede hassas fare işi doğası gereği zahmetlidir.
//   • Zaman TEK kumandadan yönetilir (aşağıdaki fırça) ve hepsi birlikte kayar.
//     Izgaranın amacı karşılaştırma; karşılaştırma ortak çerçeve ister.
//   • Yakından bakmak için ODAK: çift tık / M ile hücre tam ekran olur, orada
//     tam serbestlik vardır. Esc ile panoya dönülür.
//   • Crosshair senkronu: bir hücrede gezinirken hepsi AYNI TARİHİ okur.
//   • Yüzde modu: hepsi pencerenin başından itibaren % değişime çevrilir —
//     8 farklı fiyat ölçeği karşılaştırmayı imkânsız kılıyordu.
//
// Düzen, semboller ve tercihler localStorage'da saklanır.
// =============================================================================
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import type { SharedData } from '../App'
import { ChartTile, type TF } from '../components/multichart/ChartTile'
import { SymbolPicker } from '../components/multichart/SymbolPicker'
import { TimeBrush, type Win } from '../components/multichart/TimeBrush'
import { latestBySymbol } from '../lib/oracle'

const LAYOUTS = [1, 2, 4, 6, 8] as const
const TFS: TF[] = ['1H', '1D', '1W', '1M', '3M', '1Y', '5Y']
const TF_LABEL: Record<TF, string> = {
  '1H': '1S', '1D': '1G', '1W': '1H', '1M': '1A', '3M': '3A', '1Y': '1Y', '5Y': '5Y',
}

const LS_SLOTS  = 'si_mc_slots'
const LS_LAYOUT = 'si_mc_layout'
const LS_TF     = 'si_mc_tf'
const LS_KIND   = 'si_mc_kind'
const LS_PCT    = 'si_mc_pct'

const FULL: Win = { from: 0, to: 1 }

const readLS = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch { return fallback }
}

const dmy = (sec: number) =>
  new Date(sec * 1000).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: '2-digit' })

export default function MultiChartPage() {
  const { assets, oracle, openChart } = useOutletContext<SharedData>()

  const latest = useMemo(() => latestBySymbol(oracle), [oracle])

  const [layout, setLayout] = useState<number>(() => {
    const v = readLS<number>(LS_LAYOUT, 4)
    return (LAYOUTS as readonly number[]).includes(v) ? v : 4
  })
  const [tf, setTf]       = useState<TF>(() => readLS<TF>(LS_TF, '3M'))
  const [kind, setKind]   = useState<'candle' | 'line'>(() => readLS<'candle' | 'line'>(LS_KIND, 'candle'))
  const [percent, setPercent] = useState<boolean>(() => readLS<boolean>(LS_PCT, false))
  const [slots, setSlots] = useState<string[]>(() => readLS<string[]>(LS_SLOTS, []))
  const [active, setActive] = useState(0)
  const [adding, setAdding] = useState<number | null>(null)

  // Ortak zaman penceresi — kesir (0..1). Aralık değişince tam açılır.
  const [win, setWin] = useState<Win>(FULL)
  // Hücrelerin bildirdiği zaman aralıkları: ortak pencere bunların BİRLEŞİMİ
  // üzerinden hesaplanır. Bar SAYISI değil TARİH kullanılır — yeni halka arz
  // olmuş bir sembolün barı az olsa da hizalama bozulmaz.
  const [spans, setSpans] = useState<Record<string, { from: number; to: number }>>({})
  // Crosshair senkronu: hangi hücrede, hangi tarihte.
  const [hoverTime, setHoverTime] = useState<number | null>(null)
  const [hoverSrc, setHoverSrc]   = useState<number | null>(null)
  // Odak modu: tam ekran incelenen hücrenin indeksi.
  const [focus, setFocus] = useState<number | null>(null)

  // Varsayılan doldurma: en güvenli AL sinyalleri, yoksa ilk BIST hisseleri.
  // Yalnızca kayıt yoksa çalışır — kullanıcının kurduğu ekranı ezmez.
  // Render sırasında (efektte değil): boş ızgara bir kare bile çizilmez.
  if (slots.length === 0 && assets.length > 0) {
    const buys = [...latest.values()]
      .filter(o => o.recommendation.includes('ALIM'))
      .sort((a, b) => b.confidence - a.confidence)
      .map(o => o.symbol)
    const bist = assets.filter(a => a.assetType === 'BIST').map(a => a.symbol)
    const seed = [...new Set([...buys, ...bist])].slice(0, 8)
    if (seed.length) setSlots(seed)
  }

  useEffect(() => { localStorage.setItem(LS_SLOTS, JSON.stringify(slots)) }, [slots])
  useEffect(() => { localStorage.setItem(LS_LAYOUT, JSON.stringify(layout)) }, [layout])
  useEffect(() => { localStorage.setItem(LS_TF, JSON.stringify(tf)) }, [tf])
  useEffect(() => { localStorage.setItem(LS_KIND, JSON.stringify(kind)) }, [kind])
  useEffect(() => { localStorage.setItem(LS_PCT, JSON.stringify(percent)) }, [percent])

  // Aralık değişince pencere tam açılır: 3A'dan 1Y'ye geçince eski dar pencere
  // artık başka bir döneme denk gelir ve kullanıcı nereye baktığını şaşırır.
  // Önceki aralıkla render sırasında karşılaştırılır (efekt bir kare geç kalırdı).
  const [oncekiTf, setOncekiTf] = useState(tf)
  if (tf !== oncekiTf) {
    setOncekiTf(tf)
    setWin(FULL)
    setSpans({})
  }

  const onSpan = useCallback((symbol: string, sp: { from: number; to: number } | null) => {
    setSpans(prev => {
      if (!sp) {
        if (!(symbol in prev)) return prev
        const next = { ...prev }
        delete next[symbol]
        return next
      }
      const old = prev[symbol]
      if (old && old.from === sp.from && old.to === sp.to) return prev
      return { ...prev, [symbol]: sp }
    })
  }, [])

  // Tüm hücrelerin kapsadığı toplam zaman aralığı.
  const span = useMemo(() => {
    const vals = Object.values(spans)
    if (vals.length === 0) return null
    return {
      from: Math.min(...vals.map(v => v.from)),
      to:   Math.max(...vals.map(v => v.to)),
    }
  }, [spans])

  // Kesir pencereyi gerçek tarihe çevir. Pencere tamsa null gönderilir —
  // grafikler kendi fitContent'ini yapar (tek mumluk aralık riski yok).
  const visibleRange = useMemo(() => {
    if (!span) return null
    if (win.from <= 0 && win.to >= 1) return null
    const total = span.to - span.from
    if (total <= 0) return null
    return {
      from: Math.round(span.from + win.from * total),
      to:   Math.round(span.from + win.to * total),
    }
  }, [span, win])

  const brushLabel = useMemo(() => {
    if (!span) return ''
    const total = span.to - span.from
    return `${dmy(span.from + win.from * total)} → ${dmy(span.from + win.to * total)}`
  }, [span, win])

  // ── Klavye — fare olmadan kullanılabilsin ────────────────────────────────
  // ← → artık ZAMAN kaydırır (kullanıcının asıl şikâyeti buydu); hücre gezme
  // Shift ile yapılır. Bir metin kutusuna yazarken kısayol ÇALIŞMAZ.
  const panBy = useCallback((d: number) => {
    setWin(w => {
      const width = w.to - w.from
      const from = Math.max(0, Math.min(1 - width, w.from + d * width))
      return { from, to: from + width }
    })
  }, [])

  const zoomBy = useCallback((f: number) => {
    setWin(w => {
      const mid = (w.from + w.to) / 2
      const width = Math.max(0.02, Math.min(1, (w.to - w.from) * f))
      let from = Math.max(0, mid - width / 2)
      if (from + width > 1) from = 1 - width
      return { from, to: from + width }
    })
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (e.ctrlKey || e.metaKey || e.altKey) return

      if (e.key === 'Escape' && focus != null) { e.preventDefault(); setFocus(null); return }
      if (focus != null) return          // odakta grafiğin kendi kontrolleri geçerli

      if (e.key >= '1' && e.key <= '8') {
        const n = Number(e.key)
        if ((LAYOUTS as readonly number[]).includes(n)) { e.preventDefault(); setLayout(n) }
        return
      }
      if (e.key === 'c' || e.key === 'C') { setKind(k => (k === 'candle' ? 'line' : 'candle')); return }
      if (e.key === 'p' || e.key === 'P') { setPercent(v => !v); return }
      if (e.key === 'm' || e.key === 'M') { if (slots[active]) setFocus(active); return }
      if (e.key === 'f' || e.key === 'F') { setWin(FULL); return }
      if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomBy(0.7); return }
      if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomBy(1 / 0.7); return }
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        if (e.shiftKey) setActive(a => Math.min(layout - 1, a + 1))
        else panBy(0.25)
        return
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        if (e.shiftKey) setActive(a => Math.max(0, a - 1))
        else panBy(-0.25)
        return
      }
      if (e.key === 'Enter') {
        const sym = slots[active]
        if (sym) { e.preventDefault(); openChart(sym) }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [layout, slots, active, openChart, focus, panBy, zoomBy])

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

  const focusSym = focus != null ? slots[focus] : null

  return (
    <div className="mc-page ui2">
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

        <span className="mc-bar__label">Ölçek</span>
        <span className="mc-seg" role="group" aria-label="Fiyat ölçeği">
          <button aria-pressed={!percent} onClick={() => setPercent(false)}
                  title="Her hisse kendi fiyat ölçeğinde">₺ Fiyat</button>
          <button aria-pressed={percent} onClick={() => setPercent(true)}
                  title="Hepsi pencerenin başından itibaren % değişim — karşılaştırma için">
            % Değişim
          </button>
        </span>

        <span className="mc-bar__hint">
          Çift tık → <b>odak</b> · <b>M</b> odak · <b>Esc</b> çık ·{' '}
          <b>← →</b> zaman · <b>+ −</b> yakınlık · <b>F</b> tümü ·{' '}
          <b>Shift+← →</b> hücre · <b>P</b> yüzde · <b>1-8</b> düzen
        </span>
      </div>

      {/* Tek zaman kumandası — pencereyi sürükle, bütün grafikler birlikte kayar. */}
      <div className="mc-brushbar">
        <button className="mc-brushbar__btn" onClick={() => panBy(-0.25)} title="Geri kaydır (←)">◀</button>
        <TimeBrush win={win} onChange={setWin} label={brushLabel} disabled={!span} />
        <button className="mc-brushbar__btn" onClick={() => panBy(0.25)} title="İleri kaydır (→)">▶</button>
        <button className="mc-brushbar__btn" onClick={() => zoomBy(0.7)} title="Yakınlaştır (+)">+</button>
        <button className="mc-brushbar__btn" onClick={() => zoomBy(1 / 0.7)} title="Uzaklaştır (−)">−</button>
        <button className="mc-brushbar__btn" onClick={() => setWin(FULL)}
                title="Tüm aralık (F)" disabled={win.from <= 0 && win.to >= 1}>Tümü</button>
      </div>

      {focusSym ? (
        // ── ODAK: tek hücre tam ekran, TAM serbestlik ──────────────────────
        // Pano hücreleri kasten kontrolsüzdür; inceleme buraya taşındı.
        <div className="mc-focus">
          <div className="mc-focus__bar">
            <button onClick={() => setFocus(null)} title="Panoya dön (Esc)">← Pano</button>
            <b>{focusSym}</b>
            <span>odak — burada serbestçe kaydır ve yakınlaştır</span>
            <button style={{ marginLeft: 'auto' }} onClick={() => openChart(focusSym)}>
              Detay paneli
            </button>
          </div>
          <div className="mc-focus__body">
            <ChartTile
              key={`focus-${focusSym}-${tf}`}
              symbol={focusSym}
              tf={tf}
              kind={kind}
              assets={assets}
              analysis={latest.get(focusSym) ?? null}
              density={1}
              active
              onActivate={() => {}}
              onOpenDetail={openChart}
              onChangeSymbol={s => { if (focus != null) setSlot(focus, s) }}
              onRemove={() => { if (focus != null) removeSlot(focus); setFocus(null) }}
              interactive
              percent={percent}
              onFocus={() => setFocus(null)}
            />
          </div>
        </div>
      ) : (
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
                interactive={false}
                visibleRange={visibleRange}
                percent={percent}
                crosshairAt={hoverSrc === i ? null : hoverTime}
                onSpan={onSpan}
                onHoverTime={t => { setHoverTime(t); setHoverSrc(t == null ? null : i) }}
                onFocus={() => setFocus(i)}
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
      )}
    </div>
  )
}
