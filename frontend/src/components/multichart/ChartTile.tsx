// =============================================================================
// SerInvest — Çoklu Grafik: tek hücre
//
// Bir sembolün mum grafiği + başlıkta canlı fiyat/değişim ve (varsa) AI kararı.
// Grafik gövdesine tıklamak sembolün TAM detay panelini açar (App.tsx'teki
// SymbolDrawer — büyük grafik, teknik göstergeler, AI hedef/stop).
//
// Başlık iki hâllidir: fare grafiğin üzerindeyken o barın OHLC'sini gösterir
// (borsa terminallerinin standardı), fare çıkınca son fiyata döner. Böylece
// dar hücrede ayrı bir okuma satırına yer harcanmaz.
// =============================================================================
import { useEffect, useMemo, useState } from 'react'
import { API } from '../../lib/api'
import { PriceChart, type Bar, type CrosshairInfo, type Overlay } from '../charts/PriceChart'
import type { OracleAnalysis, PriceData } from '../../lib/types'
import { SymbolPicker } from './SymbolPicker'

export type TF = '1H' | '1D' | '1W' | '1M' | '3M' | '1Y' | '5Y'

interface ChartPayload { symbol: string; points: Bar[]; error?: string }

interface Props {
  symbol: string
  tf: TF
  kind: 'candle' | 'line'
  assets: PriceData[]
  analysis: OracleAnalysis | null
  /** Hücre sayısı — küçük hücrede eksenler ve hacim gizlenir. */
  density: number
  active: boolean
  onActivate: () => void
  onOpenDetail: (symbol: string) => void
  onChangeSymbol: (symbol: string) => void
  onRemove: () => void
}

const num = (d: number) => new Intl.NumberFormat('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d })
const vol = (v: number | null) => {
  if (v == null) return '—'
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`
  return String(Math.round(v))
}

export function ChartTile({
  symbol, tf, kind, assets, analysis, density, active,
  onActivate, onOpenDetail, onChangeSymbol, onRemove,
}: Props) {
  const [bars, setBars] = useState<Bar[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [hover, setHover] = useState<CrosshairInfo | null>(null)

  useEffect(() => {
    let stop = false
    setLoading(true); setErr(null); setHover(null)
    fetch(`${API}/market/${encodeURIComponent(symbol)}/chart?tf=${tf}`)
      .then(r => r.json())
      .then((j: ChartPayload) => {
        if (stop) return
        if (j.error || !j.points?.length) { setErr(j.error || 'veri yok'); setBars([]) }
        else setBars(j.points)
      })
      .catch(e => { if (!stop) setErr(String(e)) })
      .finally(() => { if (!stop) setLoading(false) })
    return () => { stop = true }
  }, [symbol, tf])

  const asset = assets.find(a => a.symbol === symbol)
  const dec = asset?.assetType === 'FOREX' ? 4 : 2
  const fmt = num(dec)

  const first = bars.length ? bars[0].c : null
  const last  = bars.length ? bars[bars.length - 1].c : null
  const chgPct = last != null && first ? ((last - first) / first) * 100 : null
  const up = (chgPct ?? 0) >= 0

  const isBuy = !!analysis && analysis.recommendation.includes('ALIM')

  // Referans çizgileri kimliği her render'da değişmesin diye memo — aksi hâlde
  // PriceChart onları her seferinde söküp yeniden kurardı (görsel titreme).
  const overlays = useMemo<Overlay[]>(() => {
    if (!isBuy) return []
    const out: Overlay[] = []
    if (analysis?.shortTermTarget != null)
      out.push({ price: analysis.shortTermTarget, color: 'var(--profit)', label: 'HEDEF' })
    if (analysis?.shortTermStop != null)
      out.push({ price: analysis.shortTermStop, color: 'var(--loss)', label: 'STOP' })
    return out
  }, [isBuy, analysis?.shortTermTarget, analysis?.shortTermStop])

  // Kullanıcının seçtiği tip AYNEN uygulanır.
  // 08/2026: burada "6+ hücrede otomatik çizgiye düş" kuralı vardı; kullanıcı
  // Mum seçtiği hâlde 8'li düzende çizgi çiziliyordu. Açık bir seçimi sessizce
  // ezmek yanlış — dar hücrede ince mum çizmek borsa terminallerinin normali.
  // `compact` yalnızca EKSENLERİ gizler (yer meselesi), seriyi değiştirmez.
  const compact = density >= 6

  return (
    <div className={`mc-tile${active ? ' mc-tile--active' : ''}`} onMouseDown={onActivate}>
      <div className="mc-tile__head">
        <button className="mc-sym" onClick={e => { e.stopPropagation(); setPicking(v => !v) }}
                title="Sembolü değiştir">
          {symbol}
        </button>

        {hover ? (
          // Crosshair okuması — borsa terminali standardı
          <span className="mc-ohlc">
            <i>A</i>{fmt.format(hover.o ?? 0)}
            <i>Y</i>{fmt.format(hover.h ?? 0)}
            <i>D</i>{fmt.format(hover.l ?? 0)}
            <i>K</i><b>{fmt.format(hover.c ?? 0)}</b>
            {hover.v != null && <><i>H</i>{vol(hover.v)}</>}
          </span>
        ) : (
          <>
            <span className="mc-px">{last != null ? fmt.format(last) : '—'}</span>
            {chgPct != null && (
              // Bu yüzde SEÇİLİ ARALIĞIN değişimi (grafikle tutarlı olsun diye),
              // alışılmış "günlük değişim" DEĞİL — yanındaki etiket bunu söyler.
              <span className="mc-chg" style={{ color: up ? 'var(--profit)' : 'var(--loss)' }}
                    title={`${symbol} · seçili aralık (${tf}) değişimi`}>
                {up ? '+' : ''}{chgPct.toFixed(2)}%
                <span className="mc-chg__tf">{tf}</span>
              </span>
            )}
          </>
        )}

        {analysis && !hover && (
          <span className="mc-badge" style={{
            color: isBuy ? 'var(--profit)' : 'var(--text-muted)',
            borderColor: isBuy ? 'var(--profit-border)' : 'var(--border-default)',
            background: isBuy ? 'var(--profit-bg)' : 'transparent',
          }}>
            {analysis.recommendation}
          </span>
        )}

        <button className="mc-tile__close" onClick={e => { e.stopPropagation(); onRemove() }}
                title="Hücreyi kaldır" aria-label={`${symbol} hücresini kaldır`}>×</button>

        {picking && (
          <SymbolPicker
            assets={assets}
            onPick={s => { onChangeSymbol(s); setPicking(false) }}
            onClose={() => setPicking(false)}
          />
        )}
      </div>

      <div className="mc-tile__body"
           onClick={() => onOpenDetail(symbol)}
           onMouseLeave={() => setHover(null)}
           role="button" tabIndex={0}
           onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenDetail(symbol) } }}
           aria-label={`${symbol} detaylarını aç`}>
        {(loading || err) && (
          <div className="mc-tile__msg">{loading ? 'yükleniyor…' : `veri yok (${err})`}</div>
        )}

        {bars.length > 0 && (
          <PriceChart
            bars={bars}
            kind={kind}
            compact={compact}
            showVolume={density <= 4}
            overlays={overlays}
            precision={dec}
            onCrosshair={setHover}
            syncGroup={`mc-${tf}`}
          />
        )}

        <span className="mc-tile__hint">detay için tıkla</span>
      </div>
    </div>
  )
}
