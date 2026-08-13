// =============================================================================
// SerInvest — Fiyat Grafiği (lightweight-charts sarmalayıcısı)
//
// Neden bu kütüphane (docs/PLAN_2026-08.md Faz C): Recharts genel amaçlı bir
// SVG grafik kütüphanesi; mum, hacim alt paneli ve crosshair OHLC okuması onda
// elle çizilmek zorundaydı ve 8 grafik aynı anda açıkken SVG düğüm sayısı
// tarayıcıyı yoruyordu. lightweight-charts canvas tabanlı ve finansal grafik
// için tasarlanmış (Apache-2.0, ~45KB gzip, dış ağ çağrısı YOK — veri bizim).
//
// Bu dosya TEK sarmalayıcıdır: hem çoklu ızgara hücresi hem de büyük terminal
// grafiği aynı bileşeni kullanır, yalnız `compact` ve `overlays` değişir.
// İki ayrı grafik uygulaması tutmak, ikisinin zamanla ayrışması demekti.
// =============================================================================
import { useEffect, useRef } from 'react'
import {
  createChart, CandlestickSeries, LineSeries, HistogramSeries, CrosshairMode,
  type IChartApi, type ISeriesApi,
} from 'lightweight-charts'
import { cleanBars, toCandles, toLine, toVolume, type Bar } from '../../lib/bars'

export type { Bar }

export interface Overlay {
  /** Yatay referans çizgisi — AI hedef/stop/analiz fiyatı. */
  price: number
  color: string
  label: string
  dashed?: boolean
}

export interface CrosshairInfo {
  time: number
  o: number | null; h: number | null; l: number | null; c: number | null
  v: number | null
}

interface Props {
  bars: Bar[]
  /** 'candle' = mum, 'line' = kapanış çizgisi (dar hücrede daha okunur). */
  kind?: 'candle' | 'line'
  /**
   * Yoğun ızgara: referans çizgisi ETİKETLERİ gizlenir (yer yok).
   * Eksenleri GİZLEMEZ — eksensiz grafik nerede olduğunu söylemez.
   */
  compact?: boolean
  /** Fiyat ve zaman eksenleri. Varsayılan açık; kapatmak yön duygusunu yok eder. */
  showAxes?: boolean
  showVolume?: boolean
  overlays?: Overlay[]
  /** Fiyatın kaç ondalıkla gösterileceği (FOREX 4, hisse 2). */
  precision?: number
  /** Crosshair hareket ettikçe o barın OHLC'si — başlıkta göstermek için. */
  onCrosshair?: (info: CrosshairInfo | null) => void
  /** Grafikler arası zaman ekseni senkronizasyonu için grup anahtarı. */
  syncGroup?: string
  height?: number | string
}

// ── Grafikler arası crosshair/zaman senkronizasyonu ─────────────────────────
// Çoklu ızgarada bir grafikte zoom yapınca diğerleri aynı aralığa gelsin.
// Basit bir kayıt defteri; grafik sökülünce kendini siler.
const SYNC: Record<string, Set<IChartApi>> = {}

// Geri besleme kilidi MODÜL düzeyinde olmak ZORUNDA.
// 08/2026 hatası: bayrak her grafiğin kendi kapanışındaydı. A grafiği B'ye
// aralık yazınca B'nin kendi dinleyicisi tetikleniyor, B de A/C/D'ye yazıyordu
// → döngü. Sonuç: zaman ekseninin görünür aralığı null kalıyor ve seride 64
// geçerli mum olmasına rağmen HİÇBİR ŞEY çizilmiyordu.
let syncApplying = false

function joinSync(group: string | undefined, chart: IChartApi): () => void {
  if (!group) return () => {}
  ;(SYNC[group] ??= new Set()).add(chart)
  return () => {
    SYNC[group]?.delete(chart)
    if (SYNC[group]?.size === 0) delete SYNC[group]
  }
}

const cssVar = (name: string, fallback: string) => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

export function PriceChart({
  bars, kind = 'candle', compact = false, showAxes = true, showVolume = true,
  overlays = [], precision = 2, onCrosshair, syncGroup, height = '100%',
}: Props) {
  const boxRef    = useRef<HTMLDivElement>(null)
  const chartRef  = useRef<IChartApi | null>(null)
  const mainRef   = useRef<ISeriesApi<'Candlestick'> | ISeriesApi<'Line'> | null>(null)
  const volRef    = useRef<ISeriesApi<'Histogram'> | null>(null)
  const overlayRefs = useRef<ISeriesApi<'Line'>[]>([])
  // Callback'i ref'te tutuyoruz: her render'da yeni fonksiyon gelse bile
  // grafik yeniden kurulmasın (kurulum pahalı ve görsel zıplama yaratır).
  const cbRef = useRef(onCrosshair)
  cbRef.current = onCrosshair

  // Kullanıcı bu grafikte gerçekten zoom/pan yaptı mı?
  // 08/2026 hatası: senkronizasyon HER aralık değişimini yayıyordu —
  // programatik fitContent dahil. Grafik yeniden kurulurken kabı henüz
  // genişlik almamış oluyor, o anda hesaplanan bozuk aralık diğerlerine de
  // dayatılıyor ve altı grafik birden tek muma sıkışıyordu.
  // Artık yalnız KULLANICI kaynaklı değişim yayılır; makine kendi kendine
  // yaptığı sığdırmayı komşularına empoze etmez.
  const userZoomedRef = useRef(false)

  // ── Kurulum: yalnız görsel yapı değişince ─────────────────────────────────
  useEffect(() => {
    const box = boxRef.current
    if (!box) return

    const text   = cssVar('--text-muted', '#8b94a7')
    const border = cssVar('--border-subtle', '#252b36')
    const up     = cssVar('--profit', '#059669')
    const down   = cssVar('--loss', '#dc2626')

    const chart = createChart(box, {
      layout: {
        background: { color: 'transparent' },
        textColor: text,
        fontSize: compact ? 9 : 11,
        fontFamily: cssVar('--t-mono', 'ui-monospace, monospace'),
        attributionLogo: false,          // kütüphane rozeti — kendi arayüzümüz
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: border, style: 1 },
      },
      rightPriceScale: {
        borderColor: border,
        visible: showAxes,
        scaleMargins: { top: 0.08, bottom: showVolume ? 0.26 : 0.08 },
      },
      timeScale: {
        borderColor: border,
        visible: showAxes,
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: text, width: 1, style: 2, labelBackgroundColor: cssVar('--bg-surface-3', '#1c222c') },
        horzLine: { color: text, width: 1, style: 2, labelBackgroundColor: cssVar('--bg-surface-3', '#1c222c') },
      },
      handleScale: { axisPressedMouseMove: { time: true, price: false } },
      autoSize: true,
    })
    chartRef.current = chart

    const priceFormat = { type: 'price' as const, precision, minMove: 1 / 10 ** precision }

    mainRef.current = kind === 'candle'
      ? chart.addSeries(CandlestickSeries, {
          upColor: up, downColor: down,
          borderUpColor: up, borderDownColor: down,
          wickUpColor: up, wickDownColor: down,
          priceFormat,
        })
      : chart.addSeries(LineSeries, {
          color: cssVar('--info', '#2563eb'),
          lineWidth: 2,
          priceLineVisible: false,
          priceFormat,
        })

    if (showVolume && !compact) {
      volRef.current = chart.addSeries(HistogramSeries, {
        priceFormat: { type: 'volume' },
        priceScaleId: 'vol',
        color: border,
      })
      chart.priceScale('vol').applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },   // alt %20'lik şeritte
        visible: false,
      })
    }

    // Crosshair okuması — başlıkta OHLC göstermek için
    chart.subscribeCrosshairMove(param => {
      const cb = cbRef.current
      if (!cb) return
      if (!param.time || !mainRef.current) { cb(null); return }
      const d = param.seriesData.get(mainRef.current) as any
      if (!d) { cb(null); return }
      const vd = volRef.current ? (param.seriesData.get(volRef.current) as any) : null
      cb({
        time: (param.time as number) * 1000,
        o: d.open ?? null, h: d.high ?? null, l: d.low ?? null,
        c: d.close ?? d.value ?? null,
        v: vd?.value ?? null,
      })
    })

    // Teşhis sondası — grafik nesnesini DOM'a bağlar ki tarayıcı konsolundan
    // "seri veriyi aldı mı, kaç bar var" sorulabilsin. Boyama gizli sekmede
    // yapılamadığı için tek doğrulama yolu bu.
    ;(box as unknown as Record<string, unknown>).__chart = chart
    ;(box as unknown as Record<string, unknown>).__main = mainRef.current

    const leaveSync = joinSync(syncGroup, chart)
    // Zaman aralığı senkronizasyonu. Kilit modül düzeyinde (yukarıdaki nota bak):
    // yayılım sırasında hiçbir grafiğin dinleyicisi yeni yayılım başlatamaz.
    // Ayrıca yalnız VERİSİ OLAN grafiklere yazılır — veri gelmemiş grafiğe
    // aralık dayatmak zaman eksenini geçersiz duruma sokuyordu.
    const onRange = () => {
      if (syncApplying || !syncGroup) return
      if (!userZoomedRef.current) return   // programatik sığdırma yayılmaz
      const range = chart.timeScale().getVisibleLogicalRange()
      if (!range) return
      syncApplying = true
      try {
        for (const other of SYNC[syncGroup] ?? []) {
          if (other === chart) continue
          try {
            if (other.timeScale().getVisibleLogicalRange() == null) continue   // henüz verisiz
            other.timeScale().setVisibleLogicalRange(range)
          } catch { /* sökülmüş olabilir */ }
        }
      } finally {
        syncApplying = false
      }
    }
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange)

    // Kullanıcı gerçekten zoom/pan yaptı mı? Yalnız bu olaylardan sonra
    // senkronizasyon yayılır ve otomatik yeniden sığdırma durur.
    const markUser = () => { userZoomedRef.current = true }
    box.addEventListener('wheel', markUser, { passive: true })
    box.addEventListener('mousedown', markUser)
    box.addEventListener('touchstart', markUser, { passive: true })

    // Kap boyutu oturana kadar yeniden sığdır.
    // Asıl kusur buydu: grafik yeniden kurulurken kap henüz genişlik almamış
    // oluyor, o anda yapılan fitContent tek mumluk bir aralık üretiyordu.
    // ResizeObserver gerçek genişlik gelince tekrar sığdırıyor — kullanıcı
    // kendi zoom'unu yapmadıysa. Yaptıysa onun seçimine dokunulmaz.
    const ro = new ResizeObserver(() => {
      if (userZoomedRef.current) return
      const el = boxRef.current
      if (!el || el.clientWidth < 40) return
      try { chart.timeScale().fitContent() } catch { /* sökülmüş olabilir */ }
    })
    ro.observe(box)

    return () => {
      ro.disconnect()
      box.removeEventListener('wheel', markUser)
      box.removeEventListener('mousedown', markUser)
      box.removeEventListener('touchstart', markUser)
      leaveSync()
      chart.remove()
      chartRef.current = null
      mainRef.current = null
      volRef.current = null
      overlayRefs.current = []
    }
  }, [kind, compact, showAxes, showVolume, precision, syncGroup])

  // ── Veri ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const main = mainRef.current
    if (!main || bars.length === 0) return

    // Dönüşüm kuralları lib/bars.ts'te — saniyeye çevirme, sıralama,
    // tekilleştirme. Bozulursa grafik SESSİZCE boş çizilir, o yüzden ayrı.
    const clean = cleanBars(bars)
    if (clean.length === 0) return

    if (kind === 'candle') {
      ;(main as ISeriesApi<'Candlestick'>).setData(toCandles(clean) as never)
    } else {
      ;(main as ISeriesApi<'Line'>).setData(toLine(clean) as never)
    }

    if (volRef.current) {
      volRef.current.setData(toVolume(
        clean,
        cssVar('--profit-bg', 'rgba(5,150,105,.25)'),
        cssVar('--loss-bg', 'rgba(220,38,38,.25)'),
      ) as never)
    }

    // Yeni veri = yeni sembol veya yeni zaman aralığı → kullanıcının önceki
    // zoom'u artık geçerli değil; sıfırla ki tam dönem görünsün.
    userZoomedRef.current = false
    chartRef.current?.timeScale().fitContent()
    // Bağımlılıklar kurulum efektiyle AYNI olmak zorunda: kurulum yeniden
    // çalıştığında (düzen değişince compact/showVolume değişir) grafik sıfırdan
    // kurulur; veri efekti tetiklenmezse yeni grafik BOŞ kalırdı.
  }, [bars, kind, compact, showAxes, showVolume, precision, syncGroup])

  // ── Referans çizgileri (AI hedef/stop) ───────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current
    const main = mainRef.current
    if (!chart || !main) return

    for (const s of overlayRefs.current) { try { chart.removeSeries(s) } catch { /* zaten sökülmüş */ } }
    overlayRefs.current = []

    if (!overlays.length) return
    const lines = overlays.map(o =>
      main.createPriceLine({
        price: o.price,
        color: o.color,
        lineWidth: 1,
        lineStyle: o.dashed === false ? 0 : 2,
        axisLabelVisible: !compact,
        title: compact ? '' : o.label,
      }),
    )
    return () => { for (const l of lines) { try { main.removePriceLine(l) } catch { /* sökülmüş */ } } }
    // Kurulum efektiyle aynı bağımlılıklar — yukarıdaki nota bak.
  }, [overlays, compact, kind, showAxes, showVolume, precision, syncGroup])

  return <div ref={boxRef} style={{ width: '100%', height }} />
}
