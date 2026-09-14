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
import { barAtOrBefore, cleanBars, toCandles, toLine, toVolume, type Bar } from '../../lib/bars'

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
  /**
   * Fare/tekerlek ile kaydırma-yakınlaştırma. Pano ızgarasında KAPALI:
   * 4-8 küçük hücrede tek tek fareyle uğraşmak zahmetliydi ve gövdedeki
   * "detayı aç" tıklamasıyla çakışıyordu (sürükleme bırakılınca tarayıcı
   * click üretir → panel açılırdı). Zaman kontrolü artık tek yerden.
   */
  interactive?: boolean
  /**
   * Dışarıdan dayatılan görünür zaman penceresi (epoch SANİYE).
   * Pano modunda sayfa bunu tüm hücrelere aynı verir — hepsi aynı tarihte kalır.
   */
  visibleRange?: { from: number; to: number } | null
  /**
   * Komşu grafikten gelen crosshair zamanı (epoch SANİYE) — karşılaştırma için
   * bu grafikte de aynı tarihe dikey çizgi çizilir. Faresi bu grafiğin üstünde
   * olan hücreye GÖNDERİLMEZ (kendi gerçek crosshair'i zaten var).
   */
  crosshairAt?: number | null
  /**
   * Yüzde modunda eksen "%" ile biçimlenir (fiyat ondalığı yerine).
   *
   * YALNIZ ETİKETİ DEĞİŞTİRİR — VERİYİ DÖNÜŞTÜRMEZ.
   * Normalizasyon çağıranın işidir: `toPercent(bars)` (lib/bars.ts) ile
   * geçilmiş barlar verin. Atlanırsa grafik ham fiyatı yüzde diye yazar ve
   * bunu SESSİZCE yapar — konsolda hata yok, grafik boş değil, yalnız
   * sayılar yanlış. (14.09.2026'da fon detayında tam olarak bu oldu:
   * 3,039939 ₺ ekranda "+3,04%" göründü, gerçek değişim +%44,99'du.)
   */
  percent?: boolean
  height?: number | string
}

// Grafikler arası senkronizasyon ARTIK BURADA DEĞİL (17.08.2026 yeniden tasarım).
//
// Eskiden her grafik komşularına doğrudan aralık yazıyordu: modül düzeyinde bir
// geri besleme kilidi, "kullanıcı gerçekten zoom yaptı mı" bayrağı ve verisiz
// grafiği atlama kuralı gerekiyordu — üç ayrı hata bu makineden çıkmıştı.
// Yeni model: pencereyi SAYFA tutar, her grafik ona itaat eder. Grafikler
// birbirini hiç tanımaz, dolayısıyla döngü de imkânsızdır.
//
// Ayrıca senkron artık MANTIKSAL ARALIK (bar indeksi) değil ZAMAN üzerinden.
// İndeks tabanlı hizalama, bar sayıları eşitken doğru görünüp farklı olduğunda
// (yeni halka arz, işlem durdurma) grafikleri sessizce FARKLI TARİHLERE
// kaydırıyordu. Tarih hizalaması bar sayısından bağımsızdır.

/**
 * Jeton değerini GRAFİĞİN KENDİ KABINDAN okur, kökten değil.
 *
 * Özel özellikler miras alındığı için kap kökteki değeri zaten görür; ama
 * kapsamlı bir tema (yeni arayüzün `.ui2` bloğu) aynı adı yeniden tanımlarsa
 * grafik de onu alır. Kökten okusaydı yeni sayfada eski paletle çizerdi —
 * aynı ekranda iki farklı yeşil olurdu.
 */
const cssVar = (el: Element, name: string, fallback: string) => {
  const v = getComputedStyle(el).getPropertyValue(name).trim()
  return v || fallback
}

export function PriceChart({
  bars, kind = 'candle', compact = false, showAxes = true, showVolume = true,
  overlays = [], precision = 2, onCrosshair, interactive = true,
  visibleRange = null, crosshairAt = null, percent = false, height = '100%',
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

  // Temizlenmiş barlar ref'te: crosshair senkronunda o tarihin fiyatını
  // bulmak için gerekiyor (setCrosshairPosition fiyat ister).
  const cleanRef = useRef<ReturnType<typeof cleanBars>>([])
  // Dışarıdan pencere dayatılıyor mu? ResizeObserver'ın sığdırma yapıp
  // sayfanın penceresini ezmemesi için kurulum efektinden okunur.
  const rangeRef = useRef<{ from: number; to: number } | null>(visibleRange)
  rangeRef.current = visibleRange

  // ── Kurulum: yalnız görsel yapı değişince ─────────────────────────────────
  useEffect(() => {
    const box = boxRef.current
    if (!box) return

    const text   = cssVar(box, '--text-muted', '#8b94a7')
    const border = cssVar(box, '--border-subtle', '#252b36')
    const up     = cssVar(box, '--profit', '#059669')
    const down   = cssVar(box, '--loss', '#dc2626')

    const chart = createChart(box, {
      layout: {
        background: { color: 'transparent' },
        textColor: text,
        fontSize: compact ? 9 : 11,
        fontFamily: cssVar(box, '--t-mono', 'ui-monospace, monospace'),
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
        vertLine: { color: text, width: 1, style: 2, labelBackgroundColor: cssVar(box, '--bg-surface-3', '#1c222c') },
        horzLine: { color: text, width: 1, style: 2, labelBackgroundColor: cssVar(box, '--bg-surface-3', '#1c222c') },
      },
      handleScroll: interactive,
      handleScale: interactive
        ? { axisPressedMouseMove: { time: true, price: false } }
        : false,
      autoSize: true,
    })
    chartRef.current = chart

    // Eksen ve imleç etiketi Türkçe biçimde: ondalık virgül, yüzde işareti
    // sayının önünde (uygulamanın geri kalanıyla aynı dil — lib/format.ts).
    // Kütüphanenin kendi 'price' biçimi nokta kullanıyor, o yüzden ikisi de
    // özel biçimlendirici.
    const trSayi = (v: number, b: number) =>
      v.toLocaleString('tr-TR', { minimumFractionDigits: b, maximumFractionDigits: b })
    const priceFormat = percent
      ? { type: 'custom' as const, minMove: 0.01,
          formatter: (v: number) =>
            `${v < 0 ? '-' : v > 0 ? '+' : ''}%${trSayi(Math.abs(v), 2)}` }
      : { type: 'custom' as const, minMove: 1 / 10 ** precision,
          formatter: (v: number) => trSayi(v, precision) }

    mainRef.current = kind === 'candle'
      ? chart.addSeries(CandlestickSeries, {
          upColor: up, downColor: down,
          borderUpColor: up, borderDownColor: down,
          wickUpColor: up, wickDownColor: down,
          priceFormat,
        })
      : chart.addSeries(LineSeries, {
          color: cssVar(box, '--info', '#2563eb'),
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

    // Kap boyutu oturana kadar yeniden sığdır.
    // Asıl kusur buydu: grafik yeniden kurulurken kap henüz genişlik almamış
    // oluyor, o anda yapılan fitContent tek mumluk bir aralık üretiyordu.
    // ResizeObserver gerçek genişlik gelince tekrar sığdırıyor.
    // Dışarıdan pencere dayatılıyorsa (pano modu) sığdırma YAPILMAZ — sayfanın
    // penceresini ezerdi.
    const ro = new ResizeObserver(() => {
      if (rangeRef.current) return
      const el = boxRef.current
      if (!el || el.clientWidth < 40) return
      try { chart.timeScale().fitContent() } catch { /* sökülmüş olabilir */ }
    })
    ro.observe(box)

    return () => {
      ro.disconnect()
      chart.remove()
      chartRef.current = null
      mainRef.current = null
      volRef.current = null
      overlayRefs.current = []
    }
  }, [kind, compact, showAxes, showVolume, precision, interactive, percent])

  // ── Veri ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const main = mainRef.current
    if (!main || bars.length === 0) return

    // Dönüşüm kuralları lib/bars.ts'te — saniyeye çevirme, sıralama,
    // tekilleştirme. Bozulursa grafik SESSİZCE boş çizilir, o yüzden ayrı.
    const clean = cleanBars(bars)
    if (clean.length === 0) return
    cleanRef.current = clean

    if (kind === 'candle') {
      ;(main as ISeriesApi<'Candlestick'>).setData(toCandles(clean) as never)
    } else {
      ;(main as ISeriesApi<'Line'>).setData(toLine(clean) as never)
    }

    if (volRef.current) {
      // Renkler yine KABIN kendisinden okunuyor (kapsamlı tema için);
      // bu efektte `box` yok, ref üzerinden alınıyor.
      const kap = boxRef.current
      volRef.current.setData(toVolume(
        clean,
        kap ? cssVar(kap, '--profit-bg', 'rgba(5,150,105,.25)') : 'rgba(5,150,105,.25)',
        kap ? cssVar(kap, '--loss-bg', 'rgba(220,38,38,.25)') : 'rgba(220,38,38,.25)',
      ) as never)
    }

    // Yeni veri geldi: dışarıdan pencere dayatılmıyorsa tam dönemi göster.
    // Dayatılıyorsa aşağıdaki pencere efekti zaten doğru aralığı uygular —
    // burada fitContent çağırmak bir kare boyunca yanlış aralık gösterirdi.
    if (!rangeRef.current) chartRef.current?.timeScale().fitContent()
    // Bağımlılıklar kurulum efektiyle AYNI olmak zorunda: kurulum yeniden
    // çalıştığında (düzen değişince compact/showVolume değişir) grafik sıfırdan
    // kurulur; veri efekti tetiklenmezse yeni grafik BOŞ kalırdı.
  }, [bars, kind, compact, showAxes, showVolume, precision, interactive, percent])

  // ── Dışarıdan dayatılan zaman penceresi (pano modu) ──────────────────────
  // Sayfa tüm hücrelere AYNI zaman aralığını verir. Zaman üzerinden hizalama,
  // bar sayıları farklı olsa bile (yeni halka arz, işlem durdurma) grafikleri
  // aynı tarihte tutar — indeks tabanlı eski senkronun sessiz kusuru buydu.
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    if (!visibleRange) return
    try {
      chart.timeScale().setVisibleRange({
        from: visibleRange.from as never, to: visibleRange.to as never,
      })
    } catch { /* aralık bu serinin verisiyle kesişmiyor olabilir */ }
  }, [visibleRange, bars, kind, compact, showAxes, showVolume, precision, interactive, percent])

  // ── Komşudan gelen crosshair (karşılaştırma) ─────────────────────────────
  // Fare bir hücrenin üstündeyken diğerlerinde de AYNI TARİHE dikey çizgi
  // çizilir; "o gün bunlar ne yapıyordu" tek bakışta okunur.
  useEffect(() => {
    const chart = chartRef.current
    const main = mainRef.current
    if (!chart || !main) return
    if (crosshairAt == null) { try { chart.clearCrosshairPosition() } catch { /**/ } return }

    // O tarihteki (veya en yakın önceki) barın kapanışı — çizgiyi konumlamak için.
    const hit = barAtOrBefore(cleanRef.current, crosshairAt, b => b.s)
    if (!hit) return
    try { chart.setCrosshairPosition(hit.c, hit.s as never, main) } catch { /**/ }
  }, [crosshairAt, bars, kind, compact, showAxes, showVolume, precision, interactive, percent])

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
  }, [overlays, compact, kind, showAxes, showVolume, precision, interactive, percent])

  return <div ref={boxRef} style={{ width: '100%', height }} />
}
