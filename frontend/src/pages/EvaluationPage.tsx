// =============================================================================
// SerInvest — Hisse Değerlendirme  (route: /degerlendirme)
// ML evrenine dahil olmayan ama merak edilen hisseler için teknik + temel + haber analizi.
// Oracle'dan yararlanır (BIST-50 hisseleri için); diğerleri yalnız teknik inceleme.
// =============================================================================
import { useState, useMemo } from 'react'
import { useOutletContext } from 'react-router-dom'
import { PageHeader, Icon } from '../components/ui'
import { ChartPanel, TechnicalSummary } from '../components/finance'
import { CompanyLogo } from '../components/common/CompanyLogo'
import { fmt, recColor } from '../lib/format'
import { COMPANY_NAMES } from '../lib/companies'
import { API } from '../lib/api'
import type { SharedData } from '../App'

const fmtVol = (v: number | null) => {
  if (v == null) return '—'
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`
  return v.toFixed(0)
}

export default function EvaluationPage() {
  const { assets, oracle, news, fundamentals } = useOutletContext<SharedData>()
  const [selected, setSelected] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const bist = useMemo(
    () => assets.filter(a => a.assetType === 'BIST').sort((a, b) => a.symbol.localeCompare(b.symbol)),
    [assets]
  )
  const commodity = useMemo(
    () => assets.filter(a => a.assetType === 'COMMODITY').sort((a, b) => a.symbol.localeCompare(b.symbol)),
    [assets]
  )

  const filteredBist = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return bist
    return bist.filter(a =>
      a.symbol.toLowerCase().includes(q) ||
      (COMPANY_NAMES[a.symbol] ?? '').toLowerCase().includes(q)
    )
  }, [bist, query])

  const filteredCom = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commodity
    return commodity.filter(a =>
      a.symbol.toLowerCase().includes(q) ||
      (COMPANY_NAMES[a.symbol] ?? '').toLowerCase().includes(q)
    )
  }, [commodity, query])

  const asset    = selected ? assets.find(a => a.symbol === selected) : undefined
  const oracleD  = selected ? oracle.find(o => o.symbol === selected) : undefined
  const fundD    = selected ? fundamentals.find(f => f.symbol === selected) : undefined
  const assetNews = selected ? news.filter(n => n.entity === selected).slice(0, 5) : []
  const isInUniverse = !!oracleD
  const dec = asset?.assetType === 'FOREX' ? 4 : 2

  const change = asset?.close != null && asset?.open != null ? asset.close - asset.open : null
  const changePct = change != null && asset?.open ? (change / asset.open) * 100 : null
  const chgColor = changePct == null ? 'var(--text-muted)' : changePct >= 0 ? 'var(--profit)' : 'var(--loss)'

  const rsiColor = asset?.rsi == null ? 'var(--text-muted)'
    : asset.rsi > 70 ? 'var(--loss)' : asset.rsi < 30 ? 'var(--profit)' : 'var(--text-primary)'

  return (
    <div style={{ paddingTop: 'var(--space-2)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <PageHeader
        icon={<Icon name="search" size={20} />}
        title="Hisse Değerlendirme"
        subtitle="ML evrenine dahil olmayan veya incelemek istediğin herhangi bir hisseyi teknik + temel analiz et"
      />

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 'var(--space-4)', alignItems: 'start' }}>

        {/* ── Sol: sembol listesi ── */}
        <div style={{
          background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-lg)', overflow: 'hidden', position: 'sticky', top: 80,
        }}>
          {/* Arama */}
          <div style={{ padding: 'var(--space-3)', borderBottom: '1px solid var(--border-default)', position: 'relative' }}>
            <span style={{ position: 'absolute', left: 20, top: '50%', transform: 'translateY(-50%)',
              color: 'var(--text-muted)', pointerEvents: 'none' }}>
              <Icon name="search" size={14} />
            </span>
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Hisse ara..."
              style={{
                width: '100%', paddingLeft: 30, paddingRight: 8, paddingTop: 6, paddingBottom: 6,
                background: 'var(--bg-surface-2)', border: '1px solid var(--border-strong)',
                borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)',
                fontSize: 'var(--text-sm)', outline: 'none',
              }}
            />
          </div>

          {/* BIST listesi */}
          <div style={{ maxHeight: 520, overflowY: 'auto' }}>
            {filteredBist.length > 0 && (
              <>
                <div style={{
                  padding: '6px 12px', fontSize: 10, fontWeight: 800,
                  color: 'var(--text-muted)', textTransform: 'uppercase',
                  letterSpacing: '.06em', background: 'var(--bg-surface-2)',
                  borderBottom: '1px solid var(--border-subtle)',
                }}>BIST ({filteredBist.length})</div>
                {filteredBist.map(a => {
                  const pct = a.close != null && a.open != null && a.open > 0
                    ? ((a.close - a.open) / a.open) * 100 : null
                  const inOracle = oracle.some(o => o.symbol === a.symbol)
                  return (
                    <button
                      key={a.symbol}
                      onClick={() => setSelected(a.symbol)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                        padding: '7px 12px', background: selected === a.symbol ? 'var(--accent-bg)' : 'transparent',
                        border: 'none', borderBottom: '1px solid var(--border-subtle)',
                        cursor: 'pointer', textAlign: 'left',
                        borderLeft: `3px solid ${selected === a.symbol ? 'var(--accent)' : 'transparent'}`,
                      }}
                      onMouseEnter={e => { if (selected !== a.symbol) e.currentTarget.style.background = 'var(--bg-surface-2)' }}
                      onMouseLeave={e => { if (selected !== a.symbol) e.currentTarget.style.background = 'transparent' }}
                    >
                      <CompanyLogo symbol={a.symbol} size={24} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: 4,
                          fontSize: 'var(--text-xs)', fontWeight: 800,
                          color: selected === a.symbol ? 'var(--accent)' : 'var(--text-primary)',
                        }}>
                          {a.symbol}
                          {inOracle && (
                            <span style={{ fontSize: 9, background: 'var(--accent-bg)', color: 'var(--accent)',
                              padding: '1px 4px', borderRadius: 3, fontWeight: 700 }}>ML</span>
                          )}
                        </div>
                        {COMPANY_NAMES[a.symbol] && (
                          <div style={{ fontSize: 9, color: 'var(--text-muted)', overflow: 'hidden',
                            textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {COMPANY_NAMES[a.symbol]}
                          </div>
                        )}
                      </div>
                      {pct != null && (
                        <span style={{
                          fontSize: 10, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                          color: pct >= 0 ? 'var(--profit)' : 'var(--loss)',
                        }}>
                          {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
                        </span>
                      )}
                    </button>
                  )
                })}
              </>
            )}

            {/* Emtia listesi */}
            {filteredCom.length > 0 && (
              <>
                <div style={{
                  padding: '6px 12px', fontSize: 10, fontWeight: 800,
                  color: 'var(--text-muted)', textTransform: 'uppercase',
                  letterSpacing: '.06em', background: 'var(--bg-surface-2)',
                  borderBottom: '1px solid var(--border-subtle)',
                }}>EMTİA ({filteredCom.length})</div>
                {filteredCom.map(a => {
                  const pct = a.close != null && a.open != null && a.open > 0
                    ? ((a.close - a.open) / a.open) * 100 : null
                  return (
                    <button
                      key={a.symbol}
                      onClick={() => setSelected(a.symbol)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                        padding: '7px 12px', background: selected === a.symbol ? 'var(--accent-bg)' : 'transparent',
                        border: 'none', borderBottom: '1px solid var(--border-subtle)',
                        cursor: 'pointer', textAlign: 'left',
                        borderLeft: `3px solid ${selected === a.symbol ? 'var(--accent)' : 'transparent'}`,
                      }}
                      onMouseEnter={e => { if (selected !== a.symbol) e.currentTarget.style.background = 'var(--bg-surface-2)' }}
                      onMouseLeave={e => { if (selected !== a.symbol) e.currentTarget.style.background = 'transparent' }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 'var(--text-xs)', fontWeight: 800, color: selected === a.symbol ? 'var(--accent)' : 'var(--text-primary)' }}>
                          {a.symbol}
                        </div>
                        {COMPANY_NAMES[a.symbol] && (
                          <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>{COMPANY_NAMES[a.symbol]}</div>
                        )}
                      </div>
                      {pct != null && (
                        <span style={{ fontSize: 10, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                          color: pct >= 0 ? 'var(--profit)' : 'var(--loss)' }}>
                          {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
                        </span>
                      )}
                    </button>
                  )
                })}
              </>
            )}

            {filteredBist.length === 0 && filteredCom.length === 0 && (
              <div style={{ padding: 'var(--space-5)', textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
                "{query}" ile eşleşen hisse bulunamadı.
              </div>
            )}
          </div>
        </div>

        {/* ── Sağ: analiz paneli ── */}
        {!selected ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            padding: 'var(--space-10)', color: 'var(--text-muted)',
            background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-lg)', minHeight: 400, gap: 'var(--space-3)',
          }}>
            <Icon name="search" size={36} />
            <div style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--fw-bold)', color: 'var(--text-secondary)' }}>
              Bir hisse seç
            </div>
            <div style={{ fontSize: 'var(--text-sm)', textAlign: 'center', maxWidth: 320, lineHeight: 1.6 }}>
              Soldan istediğin hisseyi seç. ML rozeti olan hisseler BIST-50 evreninde olup
              AI tavsiyesi üretilmiş demektir.
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>

            {/* Başlık: sembol + fiyat + ML rozeti */}
            <div style={{
              background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-lg)', padding: 'var(--space-5)',
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
                <CompanyLogo symbol={selected} size={48} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                    <h1 style={{ margin: 0, fontSize: 'var(--text-xl)', fontWeight: 'var(--fw-black)' }}>{selected}</h1>
                    {isInUniverse ? (
                      <span style={{
                        padding: '3px 8px', borderRadius: 'var(--radius-full)',
                        background: 'var(--accent-bg)', color: 'var(--accent)',
                        fontSize: 'var(--text-xs)', fontWeight: 800,
                        border: '1px solid var(--accent-border)',
                      }}>ML Evreni</span>
                    ) : (
                      <span style={{
                        padding: '3px 8px', borderRadius: 'var(--radius-full)',
                        background: 'var(--bg-surface-2)', color: 'var(--text-muted)',
                        fontSize: 'var(--text-xs)', fontWeight: 600,
                        border: '1px solid var(--border-default)',
                      }}>ML Dışı — yalnız teknik</span>
                    )}
                  </div>
                  {COMPANY_NAMES[selected] && (
                    <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginTop: 2 }}>
                      {COMPANY_NAMES[selected]}
                    </div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)', marginTop: 'var(--space-2)' }}>
                    <span style={{ fontSize: 'var(--text-xl)', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                      {fmt(asset?.close ?? null, dec)} ₺
                    </span>
                    {changePct != null && (
                      <span style={{ fontSize: 'var(--text-base)', fontWeight: 700, color: chgColor, fontVariantNumeric: 'tabular-nums' }}>
                        {changePct >= 0 ? '▲ +' : '▼ '}{fmt(change, dec)} ({changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%)
                      </span>
                    )}
                  </div>
                </div>

                {/* Oracle tavsiyesi (varsa) */}
                {oracleD && (() => {
                  const c = recColor(oracleD.recommendation)
                  return (
                    <div style={{
                      padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-md)',
                      background: c.bg, border: `1px solid ${c.border}`,
                      textAlign: 'center', flexShrink: 0,
                    }}>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginBottom: 2 }}>AI Tavsiye</div>
                      <div style={{ fontWeight: 800, color: c.color, fontSize: 'var(--text-base)' }}>{oracleD.recommendation}</div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 2 }}>
                        %{(oracleD.confidence * 100).toFixed(0)} güven
                      </div>
                    </div>
                  )
                })()}
              </div>
            </div>

            {/* Grafik */}
            <ChartPanel
              symbol={selected}
              apiBase={API}
              decimals={dec}
              availableSymbols={bist.map(a => a.symbol)}
            />

            {/* Teknik özet */}
            <TechnicalSummary asset={asset} />

            {/* Teknik göstergeler grid */}
            {asset && (
              <div style={{
                background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)',
              }}>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
                  textTransform: 'uppercase', letterSpacing: '0.06em',
                  fontWeight: 'var(--fw-bold)', marginBottom: 'var(--space-3)' }}>
                  Teknik Göstergeler
                </div>
                <div style={{
                  display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
                  gap: 'var(--space-2)',
                }}>
                  {[
                    { k: 'Açılış', v: fmt(asset.open, dec) },
                    { k: 'Günlük Yüksek', v: fmt(asset.high, dec) },
                    { k: 'Günlük Düşük', v: fmt(asset.low, dec) },
                    { k: 'Hacim', v: fmtVol(asset.volume) },
                    { k: 'RSI (14)', v: asset.rsi?.toFixed(1) ?? '—', color: rsiColor },
                    { k: 'MACD Hist', v: asset.macdHistogram?.toFixed(3) ?? '—',
                      color: asset.macdHistogram == null ? undefined : asset.macdHistogram >= 0 ? 'var(--profit)' : 'var(--loss)' },
                    { k: 'EMA 20', v: fmt(asset.ema20, dec) },
                    { k: 'EMA 50', v: fmt(asset.ema50, dec) },
                    { k: 'EMA 200', v: fmt(asset.ema200, dec),
                      color: asset.close != null && asset.ema200 != null
                        ? (asset.close > asset.ema200 ? 'var(--profit)' : 'var(--loss)') : undefined },
                    { k: 'BB Üst', v: fmt(asset.bbUpper, dec) },
                    { k: 'BB Alt', v: fmt(asset.bbLower, dec) },
                  ].map(({ k, v, color }) => (
                    <div key={k} style={{
                      background: 'var(--bg-surface-2)', borderRadius: 'var(--radius-sm)',
                      padding: 'var(--space-2) var(--space-3)',
                    }}>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 2,
                        textTransform: 'uppercase', letterSpacing: '.04em' }}>{k}</div>
                      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: color ?? 'var(--text-primary)',
                        fontVariantNumeric: 'tabular-nums' }}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Temel analiz (varsa) */}
            {fundD && (
              <div style={{
                background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)',
              }}>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
                  textTransform: 'uppercase', letterSpacing: '0.06em',
                  fontWeight: 'var(--fw-bold)', marginBottom: 'var(--space-3)' }}>
                  Temel Veriler
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 'var(--space-2)' }}>
                  {[
                    { k: 'Sektör', v: fundD.sector ?? '—' },
                    { k: 'F/K', v: fundD.peRatio?.toFixed(1) ?? '—' },
                    { k: 'F/DD', v: fundD.pbRatio?.toFixed(2) ?? '—' },
                    { k: 'Özkaynak Kârlılığı', v: fundD.roe != null ? `%${(fundD.roe * 100).toFixed(1)}` : '—' },
                    { k: 'Temettü Verimi', v: fundD.dividendYield != null ? `%${(fundD.dividendYield * 100).toFixed(2)}` : '—' },
                    { k: 'Piyasa Değeri', v: fundD.marketCap != null ? `${(fundD.marketCap / 1e9).toFixed(2)} mrd ₺` : '—' },
                    { k: 'EBITDA Marjı', v: fundD.ebitdaMargin != null ? `%${(fundD.ebitdaMargin * 100).toFixed(1)}` : '—' },
                    { k: '52H Pozisyon', v: fundD.position52W != null ? `%${(fundD.position52W * 100).toFixed(0)}` : '—' },
                  ].map(({ k, v }) => (
                    <div key={k} style={{
                      background: 'var(--bg-surface-2)', borderRadius: 'var(--radius-sm)',
                      padding: 'var(--space-2) var(--space-3)',
                    }}>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 2,
                        textTransform: 'uppercase', letterSpacing: '.04em' }}>{k}</div>
                      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--text-primary)',
                        fontVariantNumeric: 'tabular-nums' }}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Haberler */}
            {assetNews.length > 0 && (
              <div style={{
                background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)',
              }}>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
                  textTransform: 'uppercase', letterSpacing: '0.06em',
                  fontWeight: 'var(--fw-bold)', marginBottom: 'var(--space-3)' }}>
                  Son Haberler
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                  {assetNews.map(n => {
                    const c = n.sentimentScore > 0.1 ? 'var(--profit)'
                      : n.sentimentScore < -0.1 ? 'var(--loss)' : 'var(--text-muted)'
                    return (
                      <a key={n.id} href={n.url} target="_blank" rel="noreferrer" style={{
                        display: 'block', textDecoration: 'none', color: 'inherit',
                        padding: 'var(--space-2) var(--space-3)',
                        background: 'var(--bg-surface-2)', borderRadius: 'var(--radius-sm)',
                        borderLeft: `3px solid ${c}`,
                      }}>
                        <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>
                          {n.headline}
                        </div>
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                          {new Date(n.createdAt).toLocaleString('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                          {' · '}
                          <span style={{ color: c, fontWeight: 700 }}>{n.sentimentLabel}</span>
                        </div>
                      </a>
                    )
                  })}
                </div>
              </div>
            )}

            {/* ML dışı uyarı */}
            {!isInUniverse && (
              <div style={{
                background: 'rgba(251,191,36,.06)', border: '1px solid rgba(251,191,36,.2)',
                borderRadius: 'var(--radius-md)', padding: 'var(--space-3) var(--space-4)',
                fontSize: 'var(--text-xs)', color: 'var(--text-muted)', lineHeight: 1.6,
              }}>
                <strong style={{ color: 'var(--warning)' }}>ML Evreni Dışı</strong> — Bu sembol BIST-50 filtresi dışında olduğu için
                ML modeli tarafından eğitilmemiştir. Yalnız teknik göstergeler mevcut.
                Modele dahil etmek için AI Oracle eğitimine BIST-50 kapsamını genişlet.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
