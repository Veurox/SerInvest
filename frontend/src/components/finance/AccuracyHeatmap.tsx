/**
 * Tahmin doğruluk heatmap'i: sembol × gün matrisi.
 * Her hücre o gün o sembolün tahmin sonucunu gösterir:
 *   - Yeşil: doğru
 *   - Kırmızı: yanlış
 *   - Boş: o gün tahmin yok / olgunlaşmamış / NEUTRAL
 *
 * GitHub contribution graph tarzı.
 */
interface HeatmapRow {
  symbol: string
  predicted: string
  evaluated: boolean
  correct: boolean | null
  timestamp: string
}

interface AccuracyHeatmapProps {
  rows: HeatmapRow[]
  days?: number       // kaç gün geriye
  topN?: number       // en aktif kaç sembolü göster
}

export function AccuracyHeatmap({ rows, days = 30, topN = 15 }: AccuracyHeatmapProps) {
  // Tarih aralığı oluştur (bugünden geriye N gün)
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const dateList: Date[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setUTCDate(d.getUTCDate() - i)
    dateList.push(d)
  }

  // Sembol başına aktivite say (en aktif top N)
  const symActivity = new Map<string, number>()
  for (const r of rows) {
    if (!r.predicted || r.predicted === 'NEUTRAL') continue
    symActivity.set(r.symbol, (symActivity.get(r.symbol) ?? 0) + 1)
  }
  const topSymbols = [...symActivity.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([s]) => s)
    .sort()

  // Lookup: symbol-date -> outcome
  const cellMap = new Map<string, HeatmapRow>()
  for (const r of rows) {
    if (!r.timestamp) continue
    const dateKey = r.timestamp.slice(0, 10)
    const key = `${r.symbol}_${dateKey}`
    cellMap.set(key, r)
  }

  if (topSymbols.length === 0) {
    return null
  }

  const cellSize = 12
  const cellGap  = 2
  const labelWidth = 60

  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4)',
      marginTop: 'var(--space-4)',
      overflowX: 'auto',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 'var(--space-3)', flexWrap: 'wrap', gap: 'var(--space-2)',
      }}>
        <div>
          <div style={{
            fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
            textTransform: 'uppercase', letterSpacing: '0.06em',
            fontWeight: 'var(--fw-bold)',
          }}>Doğruluk Heatmap'i</div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: '2px' }}>
            Son {days} gün × en aktif {topSymbols.length} sembol
          </div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
            <span style={{ width: '10px', height: '10px', background: 'var(--profit)', borderRadius: '2px' }} />
            Doğru
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
            <span style={{ width: '10px', height: '10px', background: 'var(--loss)', borderRadius: '2px' }} />
            Yanlış
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
            <span style={{ width: '10px', height: '10px', background: 'var(--bg-surface-3)', borderRadius: '2px' }} />
            Bekliyor / Yok
          </span>
        </div>
      </div>

      <div style={{ display: 'inline-block' }}>
        {/* Tarih label'ları (üst başlık) */}
        <div style={{ display: 'flex', marginLeft: labelWidth, marginBottom: '4px' }}>
          {dateList.map((d, i) => {
            // Her 5 günde bir tarih göster
            const showLabel = i % 5 === 0
            return (
              <div key={i} style={{
                width: cellSize, marginRight: cellGap,
                fontSize: '9px', color: 'var(--text-disabled)',
                textAlign: 'center', whiteSpace: 'nowrap',
                transform: showLabel ? 'translateX(-50%) rotate(-45deg)' : 'none',
                transformOrigin: 'left top',
                height: showLabel ? '14px' : '0',
              }}>
                {showLabel && d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' })}
              </div>
            )
          })}
        </div>

        {/* Sembol satırları */}
        {topSymbols.map(sym => {
          const symRows = rows.filter(r => r.symbol === sym && r.evaluated)
          const correctCount = symRows.filter(r => r.correct).length
          const accuracy = symRows.length > 0 ? correctCount / symRows.length : 0
          const accColor = accuracy >= 0.55 ? 'var(--profit)' : accuracy < 0.45 ? 'var(--loss)' : 'var(--text-muted)'

          return (
            <div key={sym} style={{ display: 'flex', alignItems: 'center', marginBottom: cellGap }}>
              {/* Sembol etiketi */}
              <div style={{
                width: labelWidth,
                fontSize: 'var(--text-xs)',
                color: 'var(--text-secondary)',
                fontWeight: 'var(--fw-bold)',
                paddingRight: 'var(--space-2)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <span>{sym}</span>
                <span style={{ color: accColor, fontWeight: 'var(--fw-bold)', fontVariantNumeric: 'tabular-nums' }}>
                  %{(accuracy * 100).toFixed(0)}
                </span>
              </div>

              {/* Hücreler */}
              {dateList.map((d, i) => {
                const dateKey = d.toISOString().slice(0, 10)
                const cell = cellMap.get(`${sym}_${dateKey}`)
                let bg = 'var(--bg-surface-3)'
                let title = `${sym} · ${d.toLocaleDateString('tr-TR')} · veri yok`
                if (cell) {
                  if (cell.evaluated && cell.correct === true)  { bg = 'var(--profit)'; title = `${sym} · ${cell.predicted} · ✓ Doğru` }
                  else if (cell.evaluated && cell.correct === false) { bg = 'var(--loss)'; title = `${sym} · ${cell.predicted} · ✗ Yanlış` }
                  else if (!cell.evaluated && cell.predicted !== 'NEUTRAL') { bg = 'var(--warning)'; title = `${sym} · ${cell.predicted} · ⏳ Bekliyor` }
                }
                return (
                  <div key={i} title={title} style={{
                    width: cellSize, height: cellSize, marginRight: cellGap,
                    background: bg, borderRadius: '2px',
                    cursor: 'help',
                  }} />
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
