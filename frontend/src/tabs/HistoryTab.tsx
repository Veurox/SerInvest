// =============================================================================
// SerInvest — Tahmin Geçmişi Sekmesi
// Geçmiş tahminler tablosu + doğruluk ısı haritası + sıralama/filtre.
// =============================================================================
import { useEffect, useState } from 'react'
import { ADMIN, adminFetch } from '../lib/api'
import { EmptyState, PageHeader, KPI, Icon, DataTable } from '../components/ui'
import { AccuracyHeatmap, PredictionLifecycle, PredictionResults } from '../components/finance'
import type { PredRow, PredSummary } from '../lib/types'
import { downloadCsv } from '../lib/format'

export function HistoryTab() {
  const [data, setData]       = useState<{ rows: PredRow[]; summary: PredSummary } | null>(null)
  const [loading, setLoading] = useState(false)
  const [filterSym, setFilterSym] = useState<string>('')
  const [filterRec, setFilterRec] = useState<string>('')   // BUY / SELL / NEUTRAL / ''
  const [filterDay, setFilterDay] = useState<string>('')   // takvimden seçilen gün (YYYY-MM-DD)
  const [error, setError]     = useState('')
  // Sıralama artık DataTable'ın işi (Faz D4) — burada elle tutulan
  // sortKey/sortDir/handleSort kaldırıldı.

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
  // Filtre uygulanmış satırlar; sıralamayı DataTable yapar.
  const filteredRows = (() => {
    if (!data?.rows) return []
    let rows = data.rows
    if (filterRec) rows = rows.filter(r => r.predicted === filterRec)
    if (filterDay) rows = rows.filter(r => r.timestamp.slice(0, 10) === filterDay)
    // sembol filtresi backend'de uygulandı (filterSym → fetchData)
    return rows
  })()

  return (
    <div className="ui2" style={{ minHeight: '100%', padding: 'var(--u-s4) var(--u-s5) var(--u-s5)' }}>
      {/* Model sayfasının "doğruluk" tarafı — çağrılar tuttu mu
          (docs/PLAN_ARAYUZ.md §1: Model = DOĞRULUK, Portföy = PARA). */}
      <PageHeader
        title="Çağrılar tuttu mu?"
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

          {/* Yaşam döngüsü: boru hattı + olgunlaşma hattı + ay takvimi.
              Takvimden gün seçilince aşağıdaki tablo o güne filtrelenir. */}
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <PredictionLifecycle onPickDay={d => setFilterDay(p => (p === d ? '' : d))} />
          </div>

          {/* Sonuçlanan tahminler — "hangisi ne oldu, 10 gün sonra ne değerdi" */}
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <PredictionResults rows={data.rows} />
          </div>

          {/* Takvim gün filtresi aktifse görünür rozet — "tablo neden kısaldı?" */}
          {filterDay && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, marginBottom: 'var(--space-3)',
              padding: '6px 11px', borderRadius: 4, fontSize: 12.5,
              background: 'var(--accent-bg)', border: '1px solid var(--accent-border)', color: 'var(--accent)',
            }}>
              <span>Takvimden seçildi: <b>{filterDay}</b> — tablo bu güne filtrelendi</span>
              <button onClick={() => setFilterDay('')}
                style={{ marginLeft: 'auto', fontSize: 12, cursor: 'pointer', borderRadius: 3,
                         border: '1px solid var(--accent-border)', background: 'transparent',
                         color: 'var(--accent)', padding: '2px 9px' }}>
                Filtreyi kaldır ✕
              </button>
            </div>
          )}

          {/* Heatmap (sembol × gün doğruluk grid'i) */}
          {data.rows.length > 0 && (
            <AccuracyHeatmap rows={data.rows} days={30} topN={15} />
          )}

          {/* Tablo — DataTable (Faz D4). Eskiden elle yazılmış <table> vardı ve
              sabit hex renkler (#22c55e, #fbbf24, #ef4444) kullanıyordu; tema
              sistemini baypas ediyor, açık temada kontrastı ölçülmemiş renkler
              çıkıyordu. Sıralama da artık bileşenin işi. */}
          <div style={{ marginTop: 'var(--space-4)' }}>
            <DataTable
              rows={filteredRows}
              rowKey={r => `${r.timestamp}-${r.symbol}`}
              defaultSort={{ key: 'timestamp', dir: 'desc' }}
              maxHeight="60vh"
              empty={filterSym || filterRec ? (
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
              )}
              columns={[
                {
                  key: 'timestamp', header: 'Tarih', width: 92,
                  sortValue: r => r.timestamp ?? '',
                  render: r => {
                    const ts = new Date((r.timestamp ?? '') + (r.timestamp?.endsWith('Z') ? '' : 'Z'))
                    return <span style={{ color: 'var(--text-muted)' }}>
                      {isNaN(ts.getTime()) ? r.timestamp
                        : ts.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: '2-digit' })}
                    </span>
                  },
                },
                {
                  key: 'symbol', header: 'Sembol', width: 78,
                  sortValue: r => r.symbol ?? '',
                  render: r => <b style={{ color: 'var(--text-primary)' }}>{r.symbol}</b>,
                },
                {
                  key: 'predicted', header: 'Karar', width: 86,
                  sortValue: r => r.predicted ?? '',
                  render: r => {
                    const c = r.predicted === 'BUY' ? 'var(--profit)'
                            : r.predicted === 'SELL' ? 'var(--loss)' : 'var(--text-muted)'
                    const bg = r.predicted === 'BUY' ? 'var(--profit-bg)'
                            : r.predicted === 'SELL' ? 'var(--loss-bg)' : 'var(--bg-glass)'
                    const bd = r.predicted === 'BUY' ? 'var(--profit-border)'
                            : r.predicted === 'SELL' ? 'var(--loss-border)' : 'var(--border-default)'
                    return <span style={{ padding: '1px 6px', fontWeight: 700, fontSize: 'var(--text-2xs)',
                                          color: c, background: bg, border: `1px solid ${bd}` }}>{r.predicted}</span>
                  },
                },
                {
                  key: 'confidence', header: 'Güven', numeric: true, width: 66,
                  title: 'Modelin ham çıktısı — doğrulanmış bir olasılık değil',
                  sortValue: r => r.confidence ?? 0,
                  render: r => <>%{(r.confidence * 100).toFixed(0)}</>,
                },
                {
                  key: 'close', header: 'Fiyat', numeric: true, width: 84, priority: 2,
                  sortValue: r => r.close ?? 0,
                  render: r => r.close
                    ? r.close.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                    : '—',
                },
                {
                  key: 'evaluated', header: 'Sonuç (10g)', width: 92,
                  sortValue: r => (!r.evaluated ? 0 : r.correct ? 2 : 1),
                  render: r => {
                    const c = !r.evaluated ? 'var(--text-muted)' : r.correct ? 'var(--profit)' : 'var(--loss)'
                    return <span style={{ color: c, fontWeight: 600 }}>
                      {!r.evaluated ? 'Bekliyor' : r.correct ? 'Doğru' : 'Yanlış'}
                    </span>
                  },
                },
                {
                  key: 'return', header: 'Getiri', numeric: true, width: 84,
                  // Değerlendirilmemiş satır 0 DEĞİL, "değer yok"tur. 0 sayarsak
                  // sıralamada gerçek getirilerin ortasına serpilir ve kolon
                  // okunamaz hale gelir; null dönünce DataTable onları dibe atar.
                  sortValue: r => (r.return ? parseFloat(r.return) : null),
                  render: r => {
                    const v = r.return ? parseFloat(r.return) : null
                    if (v == null) return '—'
                    // Yön renge EK OLARAK glifle veriliyor (theme.css .dir-up/.dir-down)
                    return <span className={v > 0 ? 'dir-up' : v < 0 ? 'dir-down' : undefined}
                                 style={{ fontWeight: 700, color: v === 0 ? 'var(--text-muted)' : undefined }}>
                      {Math.abs(v * 100).toFixed(2)}%
                    </span>
                  },
                },
              ]}
            />
          </div>
        </>
      )}
    </div>
  )
}

