// =============================================================================
// SerInvest — Zaman Fırçası (çoklu grafiğin tek zaman kumandası)
//
// Neden var (17.08.2026): pano modunda hücrelerde tek tek pan/zoom yok. Zamanı
// buradan yönetiyoruz — 8 grafik birden aynı pencerede kalıyor. Kullanıcının
// şikâyeti "kontrol etmesi kaydırması zor"du; sorun küçük hücrede fareyle
// yapılan hassas işti, çözüm o işi TEK ve BÜYÜK bir kumandaya taşımak.
//
// Değerler kesir (0..1): sayfa bunları gerçek tarihe çevirir. Fırça tarihi
// bilmez — böylece sembol/aralık değişince yeniden hesaplanmaz, pencere korunur.
// =============================================================================
import { useCallback, useEffect, useRef } from 'react'

export interface Win { from: number; to: number }   // 0..1 kesirler

interface Props {
  win: Win
  onChange: (w: Win) => void
  /** Pencerenin karşılık geldiği tarih metni — kullanıcı ne gördüğünü bilsin. */
  label?: string
  disabled?: boolean
}

const MIN_W = 0.02   // pencere bundan dar olamaz (tek muma sıkışmayı önler)
const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

export function TimeBrush({ win, onChange, label, disabled }: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  // Sürükleme durumu ref'te: mousemove her piksel için state güncellemesin.
  const drag = useRef<{ mode: 'move' | 'from' | 'to'; x0: number; w0: Win } | null>(null)

  const frac = useCallback((clientX: number) => {
    const el = trackRef.current
    if (!el) return 0
    const r = el.getBoundingClientRect()
    return clamp01((clientX - r.left) / Math.max(1, r.width))
  }, [])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = drag.current
      if (!d) return
      const el = trackRef.current
      if (!el) return
      const dx = (e.clientX - d.x0) / Math.max(1, el.getBoundingClientRect().width)

      if (d.mode === 'move') {
        const w = d.w0.to - d.w0.from
        let from = clamp01(d.w0.from + dx)
        if (from + w > 1) from = 1 - w
        onChange({ from, to: from + w })
      } else if (d.mode === 'from') {
        const from = Math.min(clamp01(d.w0.from + dx), d.w0.to - MIN_W)
        onChange({ from: Math.max(0, from), to: d.w0.to })
      } else {
        const to = Math.max(clamp01(d.w0.to + dx), d.w0.from + MIN_W)
        onChange({ from: d.w0.from, to: Math.min(1, to) })
      }
    }
    const onUp = () => { drag.current = null }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [onChange])

  const start = (mode: 'move' | 'from' | 'to') => (e: React.MouseEvent) => {
    if (disabled) return
    e.preventDefault(); e.stopPropagation()
    drag.current = { mode, x0: e.clientX, w0: win }
  }

  // Boş alana tıklamak pencereyi oraya TAŞIR (genişliği korur) — büyük bir
  // sıçrama için sürüklemeye gerek kalmasın.
  const onTrackDown = (e: React.MouseEvent) => {
    if (disabled) return
    const f = frac(e.clientX)
    const w = win.to - win.from
    let from = clamp01(f - w / 2)
    if (from + w > 1) from = 1 - w
    onChange({ from, to: from + w })
    drag.current = { mode: 'move', x0: e.clientX, w0: { from, to: from + w } }
  }

  const pct = (v: number) => `${(v * 100).toFixed(3)}%`

  return (
    <div className={`brush${disabled ? ' brush--off' : ''}`}>
      <div className="brush__track" ref={trackRef} onMouseDown={onTrackDown}
           role="slider" aria-label="Zaman penceresi"
           aria-valuemin={0} aria-valuemax={100}
           aria-valuenow={Math.round(((win.from + win.to) / 2) * 100)}
           aria-valuetext={label}>
        <div className="brush__win"
             style={{ left: pct(win.from), width: pct(Math.max(0, win.to - win.from)) }}
             onMouseDown={start('move')}>
          <span className="brush__grip" onMouseDown={start('from')} aria-hidden />
          <span className="brush__grip brush__grip--r" onMouseDown={start('to')} aria-hidden />
        </div>
      </div>
      {label && <span className="brush__label">{label}</span>}
    </div>
  )
}
