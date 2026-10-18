// =============================================================================
// SerInvest — Göstergelerin anlık durumu (tavsiye DEĞİL)
//
// NEDEN YENİDEN YAZILDI (18.10.2026)
// Bu bileşen "Investing.com tarzı" bir AL/NÖTR/SAT göstergesiydi: dokuz basit
// kuralı sayıp "ALIM" ya da "SATIŞ" hükmü veriyordu. İki sorunu vardı:
//   • Doğrulanmamış İKİNCİ bir tavsiyeydi. Hemen üstünde modelin kararı
//     duruyor; rejim kapısı yüzünden model "Tut" derken bu kutu "ALIM"
//     diyebiliyordu. Ekranda tek bir tavsiye kaynağı olmalı.
//   • Kurallar birbiriyle çelişiyordu: RSI düşükse "AL" (dipten dönüş
//     varsayımı) ama fiyat ortalamanın altındaysa "SAT" (trend varsayımı).
//     Sayıp çoğunluğa bakmak iki zıt felsefeyi toplamaktı.
// Artık yalnız DURUMU anlatır: trend göstergeleri yukarı/aşağı, salınım
// göstergeleri hangi bölgede. Hüküm yok.
// =============================================================================
import type { PriceData } from '../../lib/types'
import { TerimTip } from '../ui/TerimTip'

type Yon = 'yukarı' | 'aşağı' | 'yatay'

interface Trend { label: string; yon: Yon }
interface Salinim { label: string; durum: string }

function trendler(a: PriceData): Trend[] {
  const { close: c, open: o, macdHistogram, ema9, ema20, ema50, ema200 } = a
  const t: Trend[] = []
  const kiyas = (label: string, x: number | null, y: number | null) => {
    if (x == null || y == null) return
    t.push({ label, yon: x > y ? 'yukarı' : x < y ? 'aşağı' : 'yatay' })
  }
  kiyas('EMA 9', c, ema9)
  kiyas('EMA 20', c, ema20)
  kiyas('EMA 50', c, ema50)
  kiyas('EMA 200', c, ema200)
  kiyas('EMA 20/50', ema20, ema50)
  if (macdHistogram != null) {
    t.push({ label: 'MACD', yon: macdHistogram > 0 ? 'yukarı' : macdHistogram < 0 ? 'aşağı' : 'yatay' })
  }
  if (c != null && o != null && o > 0) {
    const chg = (c - o) / o
    t.push({ label: 'Gün Yönü', yon: chg > 0.003 ? 'yukarı' : chg < -0.003 ? 'aşağı' : 'yatay' })
  }
  return t
}

function salinimlar(a: PriceData): Salinim[] {
  const { close: c, rsi, bbUpper, bbLower } = a
  const s: Salinim[] = []
  if (rsi != null) {
    s.push({ label: 'RSI(14)',
             durum: rsi < 30 ? 'aşırı satım bölgesi' : rsi > 70 ? 'aşırı alım bölgesi' : 'orta bölge' })
  }
  if (bbUpper != null && bbLower != null && c != null && bbUpper > bbLower) {
    const pos = (c - bbLower) / (bbUpper - bbLower)
    s.push({ label: 'Bollinger',
             durum: pos < 0.2 ? 'alt banda yakın' : pos > 0.8 ? 'üst banda yakın' : 'bant ortasında' })
  }
  return s
}

const renk = (y: Yon) =>
  y === 'yukarı' ? 'var(--profit)' : y === 'aşağı' ? 'var(--loss)' : 'var(--text-muted)'

export function TechnicalSummary({ asset }: { asset: PriceData | undefined }) {
  if (!asset) return null

  const t = trendler(asset)
  const s = salinimlar(asset)
  if (t.length === 0 && s.length === 0) return null

  const yukari = t.filter(x => x.yon === 'yukarı').length
  const asagi = t.filter(x => x.yon === 'aşağı').length
  const toplam = t.length
  const ozet = toplam === 0 ? null
    : yukari / toplam >= 0.7 ? 'trend göstergelerinin çoğu yukarı'
    : asagi / toplam >= 0.7 ? 'trend göstergelerinin çoğu aşağı'
    : 'trend göstergeleri karışık'

  return (
    <div style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-md)', padding: 'var(--space-4)', marginTop: 'var(--space-4)',
    }}>
      <div style={{
        fontSize: 'var(--text-xs)', color: 'var(--text-muted)', textTransform: 'uppercase',
        letterSpacing: '0.06em', fontWeight: 'var(--fw-bold)', marginBottom: 'var(--space-2)',
      }}>
        Göstergelerin anlık durumu
      </div>

      {toplam > 0 && (
        <div style={{ marginBottom: 'var(--space-3)' }}>
          <div style={{ height: 6, borderRadius: 3, background: 'var(--bg-surface-3)',
                        position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0,
                          width: `${(yukari / toplam) * 100}%`, background: 'var(--profit)', borderRadius: 3 }} />
            <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0,
                          width: `${(asagi / toplam) * 100}%`, background: 'var(--loss)', borderRadius: 3 }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--space-1)',
                        fontSize: 10, color: 'var(--text-muted)' }}>
            <span>{yukari} yukarı</span>
            <span style={{ color: 'var(--text-secondary)' }}>{ozet}</span>
            <span>{asagi} aşağı</span>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 10px' }}>
        {t.map(x => (
          <div key={x.label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10 }}>
            <span style={{ color: 'var(--text-muted)' }}><TerimTip ad={x.label} />:</span>
            <span style={{ color: renk(x.yon), fontWeight: 700 }}>{x.yon}</span>
          </div>
        ))}
        {s.map(x => (
          <div key={x.label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10 }}>
            <span style={{ color: 'var(--text-muted)' }}><TerimTip ad={x.label} />:</span>
            <span style={{ color: 'var(--text-secondary)', fontWeight: 700 }}>{x.durum}</span>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 'var(--space-3)', fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.5 }}>
        Bu bir tavsiye değil, göstergelerin bugünkü durumu. Al/tut kararı yukarıdaki
        model kararıdır.
      </div>
    </div>
  )
}
