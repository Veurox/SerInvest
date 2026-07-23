// =============================================================================
// SerInvest — Tahmin Geçmişi Sekmesi
// Geçmiş tahminler tablosu + doğruluk ısı haritası + sıralama/filtre.
// =============================================================================
import { useEffect, useState } from 'react'
import { ADMIN, adminFetch } from '../lib/api'
import { EmptyState, PageHeader, KPI, Icon } from '../components/ui'
import { AccuracyHeatmap } from '../components/finance'
import type { PredRow, PredSummary } from '../lib/types'
import { downloadCsv } from '../lib/format'

type SortKey = 'timestamp' | 'symbol' | 'predicted' | 'confidence' | 'close' | 'evaluated' | 'return'
type SortDir = 'asc' | 'desc'

export function HistoryTab() {
  const [data, setData]       = useState<{ rows: PredRow[]; summary: PredSummary } | null>(null)
  const [loading, setLoading] = useState(false)
  const [filterSym, setFilterSym] = useState<string>('')
  const [filterRec, setFilterRec] = useState<string>('')   // BUY / SELL / NEUTRAL / ''
  const [sortKey, setSortKey]   = useState<SortKey>('timestamp')
  const [sortDir, setSortDir]   = useState<SortDir>('desc')
  const [error, setError]     = useState('')

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const fetchData = async (sym: string = '') => {
    setLoading(true)
    setError('')
    try {
      const url = sym
        ? `${ADMIN}/prediction-log?symbol=${encodeURIComponent(sym)}&limit=500`
        : `${ADMIN}/prediction-log?limit=500`
      const r = await adminFetch(url)
      if (r.status === 401) {
        setError('Admin API anahtarı gerekli — Yönetim sekmesinden girin')
        setData(null)
      } else if (r.ok) {
        setData(await r.json())
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData(''); const t = setInterval(() => fetchData(filterSym), 30_000); return () => clearInterval(t) }, [filterSym])

  // Tüm sembolleri rows'tan çıkar (dropdown için)
  const allSymbols = data?.rows
    ? Array.from(new Set(data.rows.map(r => r.symbol))).sort()
    : []

  // Filtre + Sıralama uygulanmış rows
  const sortedFilteredRows = (() => {
    if (!data?.rows) return []
    let rows = data.rows
    if (filterRec) rows = rows.filter(r => r.predicted === filterRec)
    // sembol filter zaten backend'de uygulandı (filterSym → fetchData)

    const dir = sortDir === 'asc' ? 1 : -1
    const sorted = [...rows].sort((a, b) => {
      let av: any, bv: any
      switch (sortKey) {
        case 'timestamp':
        case 'symbol':
        case 'predicted':
          av = a[sortKey] ?? ''; bv = b[sortKey] ?? ''
          return String(av).localeCompare(String(bv)) * dir
        case 'confidence':
        case 'close':
          av = a[sortKey] ?? 0; bv = b[sortKey] ?? 0
          return (av - bv) * dir
        case 'evaluated':
          // bekliyor < yanlış < doğru sıralaması
          const score = (r: PredRow) => !r.evaluated ? 0 : r.correct ? 2 : 1
          return (score(a) - score(b)) * dir
        case 'return':
          av = parseFloat(a.return || '0'); bv = parseFloat(b.return || '0')
          return (av - bv) * dir
      }
      return 0
    })
    return sorted
  })()

  return (
    <div style={{ paddingTop: 'var(--space-2)' }}>
      <PageHeader
        icon={<Icon name="history" size={20} />}
        title="Tahmin Geçmişi"
        subtitle={<>ml v3 · 10 işlem-günü sonucu · long-only · {data?.rows.length ?? 0} kayıt <span className="tech-tag" style={{ marginLeft: 6 }}>● saf teknik</span></>}
        right={
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            {data && data.rows.length > 0 && (
              <button className="fpill" title="CSV olarak indir"
                onClick={() => downloadCsv(
                  ['Tarih', 'Sembol', 'Tahmin', 'Güven', 'Fiyat', 'Sonuç', 'Getiri', 'Doğru'],
                  (data?.rows ?? []).map(r => [
                    r.timestamp, r.symbol, r.predicted,
                    `${(r.confidence * 100).toFixed(1)}%`,
                    r.close, r.actual, r.return,
                    r.correct == null ? '—' : r.correct ? 'Evet' : 'Hayır',
                  ]),
                  `serinvest_tahminler_${new Date().toISOString().slice(0, 10)}.csv`
                )}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Icon name="download" size={12} /> CSV
              </button>
            )}
            <button className="fpill" onClick={() => fetchData(filterSym)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon name="refresh" size={13} /> Yenile</button>
          </div>
        }
      />
      <div style={{ marginBottom: '1.25rem' }}>
        {/* Filtre Kutusu */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.75rem', alignItems: 'center',
          padding: '.75rem 1rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px' }}>
          <span style={{ fontSize: '.7rem', color: 'var(--text-muted)', textTransform: 'uppercase',
            letterSpacing: '.06em', fontWeight: 700 }}>Filtreler</span>

          <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center' }}>
            <label style={{ fontSize: '.78rem', color: 'var(--text-muted)' }}>Sembol:</label>
            <select
              value={filterSym}
              onChange={e => setFilterSym(e.target.value)}
              style={{ background: 'var(--surface-2, #0f172a)', border: '1px solid var(--border)', color: 'var(--text)',
                borderRadius: '6px', padding: '.4rem .7rem', fontSize: '.85rem', minWidth: '140px' }}
            >
              <option value="">Tümü</option>
              {allSymbols.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center' }}>
            <label style={{ fontSize: '.78rem', color: 'var(--text-muted)' }}>Karar:</label>
            <div style={{ display: 'flex', gap: '.25rem' }}>
              {[
                { v: '',        label: 'Tümü', c: '#94a3b8' },
                { v: 'BUY',     label: 'AL',   c: '#22c55e' },
                { v: 'NEUTRAL', label: 'NÖTR', c: '#94a3b8' },
              ].map(opt => (
                <button
                  key={opt.v}
                  onClick={() => setFilterRec(opt.v)}
                  style={{
                    padding: '.3rem .65rem',
                    borderRadius: '6px', fontSize: '.72rem', fontWeight: 700, cursor: 'pointer',
                    background: filterRec === opt.v ? opt.c + '33' : 'transparent',
                    color: filterRec === opt.v ? opt.c : 'var(--text-muted)',
                    border: `1px solid ${filterRec === opt.v ? opt.c + '66' : 'var(--border)'}`,
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {(filterSym || filterRec) && (
            <button
              onClick={() => { setFilterSym(''); setFilterRec('') }}
              style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)',
                borderRadius: '6px', padding: '.3rem .65rem', fontSize: '.72rem', cursor: 'pointer' }}
            >
              ✕ Temizle
            </button>
          )}
        </div>
      </div>

      {error && (
        <div style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', color: 'var(--loss)',
          padding: '.75rem 1rem', borderRadius: '8px', marginBottom: '1rem', fontSize: '.85rem' }}>
          {error}
        </div>
      )}

      {loading && !data && (
        <div className="loading"><div className="spinner" /><span>Yükleniyor...</span></div>
      )}

      {data && (
        <>
          {/* Özet KPI'lar */}
          <div className="kpi-strip">
            <KPI label="Toplam Tahmin" value={data.summary.total} tone="neutral" icon="Σ" />
            <KPI label="Değerlendirildi" value={data.summary.evaluated} sub={`${data.summary.pending} bekliyor`} tone="info" icon="✓" />
            <KPI label="AL İsabeti (10g)"
              value={data.summary.accuracy != null ? `%${(data.summary.accuracy * 100).toFixed(1)}` : '—'}
              sub={data.summary.directional != null ? `${data.summary.correct}/${data.summary.directional} yönsel` : undefined}
              tone={data.summary.accuracy == null ? 'neutral' : data.summary.accuracy >= 0.5 ? 'profit' : 'warning'}
              icon={<Icon name="target" size={14} />} />
            <KPI label="AL Sinyali"
              value={data.summary.buy_n ?? 0}
              sub={data.summary.neutral_outcomes != null ? `${data.summary.neutral_outcomes} kararsız sonuç` : undefined}
              tone="accent" icon="▲" />
          </div>

          {/* Heatmap (sembol × gün doğruluk grid'i) */}
          {data.rows.length > 0 && (
            <AccuracyHeatmap rows={data.rows} days={30} topN={15} />
          )}

          {/* Tablo */}
          <div style={{
            background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)', overflow: 'hidden',
            marginTop: 'var(--space-4)',
          }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-default)', background: 'var(--bg-glass)' }}>
                    {([
                      { label: 'Tarih',     key: 'timestamp' },
                      { label: 'Sembol',    key: 'symbol' },
                      { label: 'Karar',     key: 'predicted' },
                      { label: 'Güven',     key: 'confidence' },
                      { label: 'Fiyat',     key: 'close' },
                      { label: 'Sonuç (10g)', key: 'evaluated' },
                      { label: 'Getiri',    key: 'return' },
                    ] as { label: string; key: SortKey }[]).map(h => {
                      const isActive = sortKey === h.key
                      const arrow = !isActive ? '⇅' : sortDir === 'asc' ? '▲' : '▼'
                      const isRight = ['Getiri','Güven','Fiyat'].includes(h.label)
                      return (
                        <th key={h.key}
                          onClick={() => handleSort(h.key)}
                          style={{ padding: '.65rem .8rem',
                            textAlign: isRight ? 'right' : 'left',
                            color: isActive ? 'var(--text)' : 'var(--text-muted)',
                            fontWeight: 700, fontSize: '.65rem',
                            textTransform: 'uppercase', letterSpacing: '.05em', whiteSpace: 'nowrap',
                            cursor: 'pointer', userSelect: 'none',
                            background: isActive ? 'rgba(251,191,36,.08)' : 'transparent',
                          }}>
                          {h.label}
                          <span style={{ marginLeft: '.35rem', fontSize: '.65rem',
                            color: isActive ? '#fbbf24' : 'var(--text-muted)', opacity: isActive ? 1 : 0.4 }}>
                            {arrow}
                          </span>
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {sortedFilteredRows.map((row, i) => {
                    const ts = new Date((row.timestamp ?? '') + (row.timestamp?.endsWith('Z') ? '' : 'Z'))
                    const dateStr = isNaN(ts.getTime()) ? row.timestamp : ts.toLocaleDateString('tr-TR', { day:'2-digit', month:'short', year:'2-digit' })
                    const predColor = row.predicted === 'BUY' ? '#22c55e' : row.predicted === 'SELL' ? '#ef4444' : '#94a3b8'
                    const rowBg = !row.evaluated ? 'transparent'
                      : row.correct ? 'rgba(34,197,94,.04)' : 'rgba(239,68,68,.04)'
                    const resultColor = !row.evaluated ? '#64748b' : row.correct ? '#22c55e' : '#ef4444'
                    const resultLabel = !row.evaluated ? 'Bekliyor' : row.correct ? 'Doğru' : 'Yanlış'
                    const retVal = row.return ? parseFloat(row.return) : null
                    const retColor = retVal == null ? '#94a3b8' : retVal > 0 ? '#22c55e' : retVal < 0 ? '#ef4444' : '#94a3b8'
                    const retStr = retVal != null ? `${retVal > 0 ? '+' : ''}${(retVal * 100).toFixed(2)}%` : '—'

                    return (
                      <tr key={i} style={{ borderBottom: '1px solid var(--tint-2)', background: rowBg }}>
                        <td style={{ padding: '.5rem .8rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                          {dateStr}
                        </td>
                        <td style={{ padding: '.5rem .8rem', fontWeight: 700 }}>{row.symbol}</td>
                        <td style={{ padding: '.5rem .8rem' }}>
                          <span style={{ padding: '.15rem .5rem', borderRadius: '5px', fontWeight: 700,
                            background: predColor + '22', color: predColor, border: `1px solid ${predColor}44`,
                            fontSize: '.7rem' }}>
                            {row.predicted}
                          </span>
                        </td>
                        <td style={{ padding: '.5rem .8rem', textAlign: 'right', fontWeight: 600,
                          color: row.confidence > 0.7 ? '#22c55e' : row.confidence > 0.55 ? '#fbbf24' : '#94a3b8' }}>
                          %{(row.confidence * 100).toFixed(0)}
                        </td>
                        <td style={{ padding: '.5rem .8rem', textAlign: 'right', color: 'var(--text-muted)' }}>
                          {row.close ? row.close.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                        </td>
                        <td style={{ padding: '.5rem .8rem', color: resultColor, fontWeight: 600, fontSize: '.72rem' }}>
                          {resultLabel}
                        </td>
                        <td style={{ padding: '.5rem .8rem', textAlign: 'right', fontWeight: 700, color: retColor }}>
                          {retStr}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {sortedFilteredRows.length === 0 && (
                filterSym || filterRec ? (
                  <EmptyState
                    icon={<Icon name="search" size={28} />}
                    title="Filtre eşleşmedi"
                    message={`${filterSym || 'Tümü'}${filterSym && filterRec ? ' + ' : ''}${filterRec || ''} için kayıt yok. Filtreyi değiştirip tekrar dene.`}
                    size="sm"
                  />
                ) : (
                  <EmptyState
                    icon={<Icon name="history" size={28} />}
                    title="Henüz tahmin kaydı yok"
                    message="Sistem her gün otomatik analiz üretir. İlk tahminler birkaç döngü sonra burada görünecek."
                    size="sm"
                  />
                )
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

