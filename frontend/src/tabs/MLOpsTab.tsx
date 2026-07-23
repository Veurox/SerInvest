// =============================================================================
// SerInvest — ML Ops Konsolu (ml v3)
// Canlı syslog terminali + Champion model durumu + dürüst walk-forward doğrulaması.
// Saf teknik, 10g triple-barrier, long-only. Late-fusion/meta-learner YOK.
// =============================================================================
import { useCallback, useEffect, useState } from 'react'
import { ADMIN, API, adminFetch } from '../lib/api'
import { PageHeader, KPI, Icon } from '../components/ui'
import type { SysLog } from '../lib/types'

interface ChampionMeta {
  trained_at?: string; n_rows?: number; up_pct?: number
  date_min?: string; date_max?: string; horizon?: number
  buy_threshold?: number; tp_atr_mult?: number; sl_atr_mult?: number
  top_features?: { name: string; pct: number }[]
  promoted_from_challenger?: boolean
}
interface WFInfo {
  completed_at?: string; n_symbols?: number; n_steps?: number; n_predictions?: number
  overall_accuracy?: number; buy_precision?: number; breakeven_precision?: number
  auc?: number | null; base_rate?: number; lift?: number | null; mean_fold_lift?: number | null
  buy_coverage?: number; expected_R_per_trade?: number | null; expected_R_baseline?: number | null
  profitable?: boolean
  cost_sensitivity?: { cost_pct: number; breakeven_precision: number; expected_R: number | null; profitable: boolean }[]
  step_stats?: { fold?: number; acc?: number; base_rate?: number; buy_precision?: number | null; lift?: number | null }[]
}
interface LiveEra {
  al_signals?: number; al_evaluated?: number; al_correct?: number
  al_precision?: number | null; evaluated_all?: number
  base_rate?: number | null; lift?: number | null; profitable?: boolean | null
}
interface LiveAcc {
  overall?: number | null; total_evaluated?: number; total_correct?: number
  last_eval?: string; breakeven?: number; al_signals?: number
  base_rate?: number | null; lift?: number | null; evaluated_all?: number
  champion_since?: string | null; champion?: LiveEra | null
}
interface TrainingInfo {
  walkforward?: WFInfo; live_accuracy?: LiveAcc; champion?: ChampionMeta
  training_csv?: { total_rows?: number; label_balance?: { up_pct?: number }; modified_at?: string }
}

export function MLOpsTab() {
  const [logs, setLogs] = useState<SysLog[]>([])
  const [logFilter, setLogFilter] = useState<string>('ALL')
  const [, setTick] = useState(0)
  const [info, setInfo] = useState<TrainingInfo | null>(null)

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch(`${API}/oracle/syslogs`)
      if (res.ok) { const d = await res.json(); setLogs(d.logs || []) }
    } catch {}
  }, [])

  const fetchInfo = useCallback(async () => {
    try {
      const r = await adminFetch(`${ADMIN}/training-info`)
      if (r.ok) setInfo(await r.json())
    } catch {}
  }, [])

  useEffect(() => {
    fetchLogs(); fetchInfo()
    const t1 = setInterval(fetchLogs, 5000)
    const t2 = setInterval(() => setTick(n => n + 1), 30000)
    const t3 = setInterval(fetchInfo, 60000)
    return () => { clearInterval(t1); clearInterval(t2); clearInterval(t3) }
  }, [fetchLogs, fetchInfo])

  const toUtc = (ts: string) => new Date(ts.endsWith('Z') ? ts : ts + 'Z')
  const fmtLogTime = (ts: string) => {
    const d = toUtc(ts), now = new Date()
    const time = d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    return d.toDateString() === now.toDateString() ? time
      : `${d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' })} ${time}`
  }
  const relTime = (ts: string) => {
    const mins = Math.floor((Date.now() - toUtc(ts).getTime()) / 60000)
    if (mins < 1) return 'şimdi'; if (mins < 60) return `${mins}dk önce`
    const h = Math.floor(mins / 60); return h < 24 ? `${h}sa önce` : `${Math.floor(h / 24)}g önce`
  }
  const levelMeta = (level: string) => {
    if (level === 'SUCCESS')    return { color: '#22c55e', bg: 'rgba(34,197,94,.12)',  icon: '✓', short: 'OK' }
    if (level === 'TRAINING')   return { color: 'var(--accent)', bg: 'rgba(251,191,36,.12)', icon: '⟳', short: 'EĞİT' }
    if (level === 'EVALUATION') return { color: '#38bdf8', bg: 'rgba(56,189,248,.12)',  icon: '◎', short: 'EVAL' }
    if (level === 'WARN')       return { color: '#f97316', bg: 'rgba(249,115,22,.12)',  icon: '!', short: 'WARN' }
    if (level === 'ERROR')      return { color: '#ef4444', bg: 'rgba(239,68,68,.12)',   icon: '✕', short: 'ERR' }
    return                             { color: '#94a3b8', bg: 'rgba(148,163,184,.08)', icon: '·', short: 'INF' }
  }

  const FILTER_LEVELS = ['ALL', 'SUCCESS', 'TRAINING', 'EVALUATION', 'WARN', 'ERROR']
  const filteredLogs = logFilter === 'ALL' ? logs : logs.filter(l => l.level === logFilter)

  const champ = info?.champion
  const wf = info?.walkforward
  const live = info?.live_accuracy
  // Şampiyon dönemi öncelikli — eski modelin sinyalleri yeni metriği kirletmesin
  const era = live?.champion && (live.champion.evaluated_all ?? 0) > 0 ? live.champion : null
  const alPrec = era ? (era.al_precision ?? null) : (live?.overall ?? null)
  const liveBase = era ? (era.base_rate ?? null) : (live?.base_rate ?? null)
  const liveLift = era ? (era.lift ?? null) : (live?.lift ?? null)
  const liveSub = alPrec != null && liveBase != null && liveLift != null
    ? `taban %${(liveBase * 100).toFixed(1)} · lift ${liveLift >= 0 ? '+' : ''}${(liveLift * 100).toFixed(1)}p`
    : live?.champion
      ? `yeni şampiyon · ${live.champion.al_signals ?? 0} sinyal · 10g olgunlaşma bekliyor`
      : live?.total_evaluated
        ? `${live.total_correct}/${live.total_evaluated} değerlendirildi`
        : 'henüz değerlendirme yok'
  const breakeven = live?.breakeven ?? wf?.breakeven_precision ?? null

  const pctTone = (v: number | null | undefined, be: number | null | undefined) =>
    v == null ? 'neutral' : (be != null && v >= be) ? 'profit' : 'warning'

  return (
    <div style={{ paddingTop: 'var(--space-2)' }}>
      <PageHeader
        icon={<Icon name="mlops" size={20} />}
        title="ML Ops Konsolu"
        subtitle={<>Champion model · saf teknik · 10g triple-barrier · korumalı öğrenme <span className="tech-tag" style={{ marginLeft: 6 }}>● saf teknik</span></>}
      />

      {/* Canlı metrikler */}
      <div className="kpi-strip">
        <KPI label="Canlı AL İsabeti (10g)"
          value={alPrec != null ? `%${(alPrec * 100).toFixed(1)}` : '—'}
          sub={liveSub}
          tone={pctTone(alPrec, breakeven)} icon={<Icon name="target" size={14} />} />
        <KPI label="Kâr Eşiği (precision)"
          value={breakeven != null ? `%${(breakeven * 100).toFixed(1)}` : '—'}
          sub="bunun üstü = kârlı" tone="info" icon={<Icon name="sliders" size={14} />} />
        <KPI label="WF Yön Doğruluğu"
          value={wf?.overall_accuracy != null ? `%${(wf.overall_accuracy * 100).toFixed(1)}` : '—'}
          sub={wf?.n_predictions ? `${wf.n_predictions.toLocaleString('tr-TR')} OOS tahmin` : 'walk-forward bekliyor'}
          tone="neutral" icon={<Icon name="trending-up" size={14} />} />
        <KPI label="WF AL Precision"
          value={wf?.buy_precision != null ? `%${(wf.buy_precision * 100).toFixed(1)}` : '—'}
          sub={wf?.n_steps ? `${wf.n_steps} adım` : undefined}
          tone={pctTone(wf?.buy_precision, wf?.breakeven_precision)} icon={<Icon name="check" size={14} />} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 300px', gap: 'var(--space-4)', alignItems: 'start', marginBottom: 'var(--space-5)' }}>
        {/* Terminal */}
        <div style={{ background: '#0a0f1e', borderRadius: '12px', border: '1px solid #1e293b', overflow: 'hidden', display: 'flex', flexDirection: 'column', height: '460px' }}>
          <div style={{ background: '#0f172a', padding: '0.5rem 1rem', display: 'flex', gap: '0.5rem', alignItems: 'center', borderBottom: '1px solid #1e293b', flexShrink: 0 }}>
            <div style={{ width: '11px', height: '11px', borderRadius: '50%', background: '#ef4444' }} />
            <div style={{ width: '11px', height: '11px', borderRadius: '50%', background: '#fbbf24' }} />
            <div style={{ width: '11px', height: '11px', borderRadius: '50%', background: '#22c55e' }} />
            <span style={{ marginLeft: '0.75rem', fontSize: '0.78rem', color: '#475569', fontFamily: 'monospace', flex: 1 }}>oracle-syslog</span>
            {logs.length > 0 && (
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.7rem', color: '#22c55e' }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#22c55e', animation: 'pulse 2s infinite' }} />CANLI
              </span>
            )}
            <span style={{ fontSize: '0.7rem', color: '#334155', background: '#1e293b', padding: '0.1rem 0.5rem', borderRadius: '999px', marginLeft: '0.5rem' }}>
              {filteredLogs.length}/{logs.length}
            </span>
          </div>
          <div style={{ background: '#0d1526', padding: '0.4rem 0.75rem', display: 'flex', gap: '0.35rem', borderBottom: '1px solid #1a2540', flexShrink: 0, overflowX: 'auto' }}>
            {FILTER_LEVELS.map(lvl => {
              const m = lvl === 'ALL' ? { color: '#94a3b8', bg: 'rgba(148,163,184,.1)' } : levelMeta(lvl)
              const active = logFilter === lvl
              return (
                <button key={lvl} onClick={() => setLogFilter(lvl)} style={{
                  padding: '0.2rem 0.6rem', borderRadius: '6px', border: `1px solid ${active ? m.color + '66' : 'transparent'}`,
                  background: active ? m.bg : 'transparent', color: active ? m.color : '#475569',
                  fontSize: '0.68rem', fontWeight: active ? 700 : 400, cursor: 'pointer', fontFamily: 'monospace', whiteSpace: 'nowrap',
                }}>
                  {lvl === 'ALL' ? 'TÜMÜ' : lvl}
                  {lvl !== 'ALL' && <span style={{ marginLeft: '0.3rem', opacity: 0.6 }}>{logs.filter(l => l.level === lvl).length}</span>}
                </button>
              )
            })}
          </div>
          <div style={{ padding: '0.5rem 0', overflowY: 'auto', flex: 1, fontFamily: '"JetBrains Mono", monospace', fontSize: '0.78rem', lineHeight: 1.5, display: 'flex', flexDirection: 'column-reverse' }}>
            {filteredLogs.length === 0 ? (
              <div style={{ color: '#334155', padding: '2rem', textAlign: 'center' }}>
                {logs.length === 0 ? '⏳ Loglar bekleniyor...' : `"${logFilter}" seviyesinde log yok.`}
              </div>
            ) : filteredLogs.map((log, i) => {
              const meta = levelMeta(log.level)
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', padding: '0.3rem 0.75rem', borderTop: '1px solid rgba(30,41,59,.6)' }}>
                  <div style={{ flexShrink: 0, width: '52px', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                    <span style={{ color: meta.color, fontSize: '0.7rem', fontWeight: 900 }}>{meta.icon}</span>
                    <span style={{ fontSize: '0.62rem', fontWeight: 700, color: meta.color, opacity: 0.85 }}>{meta.short}</span>
                  </div>
                  <div style={{ flexShrink: 0, width: '88px', color: '#334155', fontSize: '0.7rem' }}>{fmtLogTime(log.timestamp)}</div>
                  <div style={{ flex: 1, color: '#94a3b8', wordBreak: 'break-word' }}>{log.message}</div>
                  <span style={{ flexShrink: 0, fontSize: '0.62rem', color: '#1e3a5f', whiteSpace: 'nowrap', paddingLeft: '0.5rem' }}>{relTime(log.timestamp)}</span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Champion model paneli */}
        <div style={{ background: 'var(--bg-surface)', borderRadius: '12px', padding: 'var(--space-4)', border: '1px solid var(--border-default)' }}>
          <div style={{ fontSize: 'var(--text-md)', fontWeight: 'var(--fw-bold)', marginBottom: 'var(--space-3)', paddingBottom: 'var(--space-2)', borderBottom: '1px solid var(--border-subtle)' }}>
            Champion Model
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <StatChip label="LightGBM" value={`${champ?.n_rows ? champ.n_rows.toLocaleString('tr-TR') : '—'} satır · 21 özellik`} tone="profit" />
            <StatChip label="Ufuk / Bariyer" value={`${champ?.horizon ?? 10}g · TP ${champ?.tp_atr_mult ?? 3}× / SL ${champ?.sl_atr_mult ?? 2}×ATR`} tone="info" />
            <StatChip label="Eğitim verisi" value={champ?.up_pct != null ? `UP %${champ.up_pct} · ${champ?.date_min ?? ''}→${champ?.date_max ?? ''}` : '—'} tone="neutral" />
            <StatChip label="Öğrenme" value="Korumalı (şampiyon-rakip) · blind retrain yok" tone="accent" />
            <StatChip label="Eğitim tarihi" value={champ?.trained_at ? toUtc(champ.trained_at).toLocaleString('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'} tone="neutral" />
          </div>

          {/* En etkili özellikler */}
          {champ?.top_features && champ.top_features.length > 0 && (
            <div style={{ marginTop: 'var(--space-3)' }}>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 'var(--fw-bold)', marginBottom: 'var(--space-2)' }}>
                En Etkili Özellikler
              </div>
              {champ.top_features.slice(0, 6).map(f => (
                <div key={f.name} style={{ marginBottom: '6px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginBottom: '2px' }}>
                    <span>{f.name}</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>%{f.pct.toFixed(1)}</span>
                  </div>
                  <div style={{ height: '4px', background: 'var(--bg-surface-3)', borderRadius: '2px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.min(100, f.pct * 4)}%`, background: 'var(--accent)', borderRadius: '2px' }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Şeffaflık Paneli ────────────────────────────────────────── */}
      {wf && wf.step_stats && wf.step_stats.length > 0 && (
        <TransparencyPanel wf={wf} champ={champ} />
      )}

      {/* Dürüst Walk-Forward paneli */}
      <div style={{ background: 'var(--bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-default)', overflow: 'hidden' }}>
        <div style={{ padding: 'var(--space-4) var(--space-5)', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
          <h2 style={{ margin: 0, fontSize: 'var(--text-md)', fontWeight: 'var(--fw-bold)' }}>
            Dürüst Walk-Forward Doğrulaması
            <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--fw-regular)', color: 'var(--text-muted)', marginLeft: 'var(--space-2)' }}>
              purged + embargo · gelecek sızıntısı yok
            </span>
          </h2>
          {wf?.completed_at && (
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
              {toUtc(wf.completed_at).toLocaleString('tr-TR')}
            </span>
          )}
        </div>

        {!wf || wf.overall_accuracy == null ? (
          <div style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--text-muted)' }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 'var(--space-2)' }}><Icon name="clock" size={22} /></div>
            Walk-forward henüz çalıştırılmadı. <strong>Yönetim → "Walk-Forward Backtest"</strong> ile başlatabilirsin (~2-5 dk).
          </div>
        ) : (
          <div style={{ padding: 'var(--space-4) var(--space-5)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px,1fr))', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
              <WfMetric label="AL Precision" val={wf.buy_precision ?? null} highlight be={wf.breakeven_precision} />
              <WfMetric label="Taban Çizgisi" val={wf.base_rate ?? null} />
              <WfMetricRaw label="Lift (beceri)"
                val={wf.lift != null ? `${wf.lift >= 0 ? '+' : ''}${(wf.lift * 100).toFixed(1)}p` : '—'}
                color={wf.lift == null ? undefined : wf.lift > 0.01 ? 'var(--profit)' : wf.lift < 0 ? 'var(--loss)' : 'var(--warning)'} />
              <WfMetricRaw label="AUC (ayrım gücü)"
                val={wf.auc != null ? wf.auc.toFixed(3) : '—'}
                color={wf.auc == null ? undefined : wf.auc >= 0.55 ? 'var(--profit)' : wf.auc >= 0.52 ? 'var(--warning)' : 'var(--loss)'} />
              <WfMetric label="Kâr Eşiği" val={wf.breakeven_precision ?? null} />
              <WfMetricRaw label="Beklenen R/işlem"
                val={wf.expected_R_per_trade != null ? `${wf.expected_R_per_trade >= 0 ? '+' : ''}${wf.expected_R_per_trade.toFixed(3)}` : '—'}
                color={wf.expected_R_per_trade == null ? undefined : wf.expected_R_per_trade > 0 ? 'var(--profit)' : 'var(--loss)'} />
              <WfMetricRaw label="OOS Tahmin" val={wf.n_predictions?.toLocaleString('tr-TR') ?? '—'} />
              <WfMetricRaw label="Adım Sayısı" val={String(wf.n_steps ?? '—')} />
            </div>

            {/* Maliyet duyarlılığı — spread/kayma varsayımdan kötüyse kâr kalıyor mu? */}
            {wf.cost_sensitivity && wf.cost_sensitivity.length > 0 && (
              <div style={{ marginBottom: 'var(--space-4)' }}>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginBottom: 'var(--space-2)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 'var(--fw-bold)' }}>
                  Maliyet Duyarlılığı (komisyon + spread + kayma)
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                  {wf.cost_sensitivity.map(cs => (
                    <div key={cs.cost_pct} style={{
                      flex: '1 1 140px', padding: '8px 12px', borderRadius: 'var(--radius-sm)',
                      background: cs.profitable ? 'var(--profit-bg)' : 'var(--loss-bg)',
                      border: `1px solid ${cs.profitable ? 'var(--profit)' : 'var(--loss)'}33`,
                    }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)' }}>
                        maliyet %{(cs.cost_pct * 100).toFixed(1)}
                      </div>
                      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 800, fontVariantNumeric: 'tabular-nums',
                        color: cs.profitable ? 'var(--profit)' : 'var(--loss)' }}>
                        {cs.profitable ? 'KÂRLI' : 'ZARARLI'}
                        {cs.expected_R != null && <span style={{ fontWeight: 600, marginLeft: 6, fontSize: 'var(--text-xs)' }}>
                          R {cs.expected_R >= 0 ? '+' : ''}{cs.expected_R.toFixed(2)}
                        </span>}
                      </div>
                      <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>eşik %{(cs.breakeven_precision * 100).toFixed(1)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Adım bazlı doğruluk */}
            {wf.step_stats && wf.step_stats.length > 0 && (
              <div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginBottom: 'var(--space-2)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 'var(--fw-bold)' }}>
                  Adım Bazlı AL Precision (zaman içinde kararlılık)
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: '70px' }}>
                  {wf.step_stats.map((s, i) => {
                    const v = s.buy_precision ?? s.acc ?? 0
                    const h = Math.max(4, Math.round(v * 70))
                    const be = wf.breakeven_precision ?? 0.42
                    const c = v >= be ? 'var(--profit)' : 'var(--loss)'
                    return <div key={i} title={`Adım ${s.fold ?? i + 1}: %${(v * 100).toFixed(1)}`}
                      style={{ flex: 1, height: `${h}px`, background: c, borderRadius: '3px 3px 0 0', opacity: 0.85, minWidth: '6px' }} />
                  })}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: '4px' }}>
                  <span>Eski</span><span>Yeni · yeşil = kâr eşiği üstü</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Şeffaflık Paneli ─────────────────────────────────────────────────────────
function TransparencyPanel({ wf, champ }: { wf: WFInfo; champ: ChampionMeta | undefined }) {
  const steps = wf.step_stats ?? []
  const be = wf.breakeven_precision ?? 0.42

  // SVG öğrenme eğrisi — buy_precision per fold
  const W = 520, H = 140, PL = 40, PR = 16, PT = 12, PB = 28
  const iW = W - PL - PR, iH = H - PT - PB
  const vals = steps.map(s => s.buy_precision ?? s.acc ?? 0)
  const n = vals.length
  const yMin = 0.3, yMax = 0.75
  const xFor = (i: number) => PL + (n <= 1 ? iW / 2 : (i / (n - 1)) * iW)
  const yFor = (v: number) => PT + iH - ((Math.min(yMax, Math.max(yMin, v)) - yMin) / (yMax - yMin)) * iH
  const yBe = yFor(be)

  // Polyline points
  const pts = vals.map((v, i) => `${xFor(i)},${yFor(v)}`).join(' ')

  // Y-axis ticks: 0.35, 0.42(be), 0.50, 0.60, 0.70
  const yTicks = [0.35, 0.50, 0.65]
  const mean = n > 0 ? vals.reduce((a, b) => a + b, 0) / n : null
  const std = n > 1
    ? Math.sqrt(vals.reduce((a, b) => a + Math.pow(b - (mean ?? 0), 2), 0) / (n - 1))
    : null

  // Full feature importance (all features from champ.top_features)
  const feats = champ?.top_features ?? []

  return (
    <div style={{
      background: 'var(--bg-surface)', borderRadius: 'var(--radius-lg)',
      border: '1px solid var(--border-default)', overflow: 'hidden',
      marginBottom: 'var(--space-4)',
    }}>
      <div style={{
        padding: 'var(--space-4) var(--space-5)', borderBottom: '1px solid var(--border-subtle)',
        display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
      }}>
        <h2 style={{ margin: 0, fontSize: 'var(--text-md)', fontWeight: 'var(--fw-bold)' }}>
          Şeffaflık Paneli
        </h2>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
          öğrenme eğrisi · özellik önemi · kararlılık
        </span>
      </div>

      <div style={{ padding: 'var(--space-4) var(--space-5)', display: 'grid', gridTemplateColumns: '1fr 260px', gap: 'var(--space-5)', alignItems: 'start' }}>

        {/* Sol: öğrenme eğrisi SVG */}
        <div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', textTransform: 'uppercase',
            letterSpacing: '.06em', fontWeight: 'var(--fw-bold)', marginBottom: 'var(--space-2)' }}>
            Walk-Forward AL Precision — Adım Bazlı
          </div>

          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W, display: 'block', overflow: 'visible' }}>
            {/* Y grid */}
            {yTicks.map(t => (
              <g key={t}>
                <line x1={PL} x2={W - PR} y1={yFor(t)} y2={yFor(t)}
                  stroke="var(--border-subtle)" strokeWidth={1} strokeDasharray="3 3" />
                <text x={PL - 4} y={yFor(t) + 4} textAnchor="end"
                  fontSize={9} fill="var(--text-muted)">{`%${(t * 100).toFixed(0)}`}</text>
              </g>
            ))}
            {/* Breakeven line */}
            <line x1={PL} x2={W - PR} y1={yBe} y2={yBe}
              stroke="var(--warning)" strokeWidth={1.5} strokeDasharray="5 3" />
            <text x={W - PR + 2} y={yBe + 4} fontSize={9} fill="var(--warning)">BE</text>

            {/* Area fill */}
            {n > 0 && (
              <path d={`M${xFor(0)},${PT + iH} ${vals.map((v, i) => `L${xFor(i)},${yFor(v)}`).join(' ')} L${xFor(n - 1)},${PT + iH} Z`}
                fill="var(--accent)" fillOpacity={0.08} />
            )}

            {/* Line */}
            {n > 1 && (
              <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            )}

            {/* Data points */}
            {vals.map((v, i) => {
              const above = v >= be
              return (
                <g key={i}>
                  <circle cx={xFor(i)} cy={yFor(v)} r={4}
                    fill={above ? 'var(--profit)' : 'var(--loss)'}
                    stroke="var(--bg-surface)" strokeWidth={1.5} />
                  <title>{`Adım ${steps[i]?.fold ?? i + 1}: %${(v * 100).toFixed(1)}`}</title>
                </g>
              )
            })}

            {/* X labels */}
            {steps.map((s, i) => (
              <text key={i} x={xFor(i)} y={H - 4} textAnchor="middle"
                fontSize={9} fill="var(--text-muted)">{s.fold ?? i + 1}</text>
            ))}
            <text x={PL} y={H - 4} fontSize={9} fill="var(--text-muted)" textAnchor="middle" />
          </svg>

          {/* Kararlılık metrikleri */}
          <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-3)', flexWrap: 'wrap' }}>
            {[
              { k: 'Ortalama', v: mean != null ? `%${(mean * 100).toFixed(1)}` : '—',
                color: mean != null && mean >= be ? 'var(--profit)' : 'var(--loss)' },
              { k: 'Std. Sapma', v: std != null ? `±%${(std * 100).toFixed(1)}` : '—', color: 'var(--text-muted)' },
              { k: 'Min', v: vals.length ? `%${(Math.min(...vals) * 100).toFixed(1)}` : '—',
                color: Math.min(...vals) >= be ? 'var(--profit)' : 'var(--loss)' },
              { k: 'Maks', v: vals.length ? `%${(Math.max(...vals) * 100).toFixed(1)}` : '—', color: 'var(--profit)' },
              { k: 'Kâr Eşiği Üstü', v: `${vals.filter(v => v >= be).length}/${vals.length} adım`,
                color: vals.filter(v => v >= be).length >= vals.length / 2 ? 'var(--profit)' : 'var(--warning)' },
            ].map(({ k, v, color }) => (
              <div key={k} style={{
                background: 'var(--bg-surface-2)', borderRadius: 'var(--radius-sm)',
                padding: '6px 10px', flex: '1 1 100px',
              }}>
                <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase',
                  letterSpacing: '.04em', fontWeight: 700, marginBottom: 2 }}>{k}</div>
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 800, color, fontVariantNumeric: 'tabular-nums' }}>{v}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Sağ: tüm özellikler */}
        <div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', textTransform: 'uppercase',
            letterSpacing: '.06em', fontWeight: 'var(--fw-bold)', marginBottom: 'var(--space-2)' }}>
            Özellik Önemi (Champion)
          </div>
          {feats.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)', padding: 'var(--space-3)' }}>
              Özellik verisi yok — model eğitilmeli.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {feats.map(f => {
                const isTop = f.pct >= 8
                return (
                  <div key={f.name}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9,
                      color: isTop ? 'var(--text-primary)' : 'var(--text-secondary)',
                      fontWeight: isTop ? 700 : 400, marginBottom: 2 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>{f.name}</span>
                      <span style={{ fontVariantNumeric: 'tabular-nums', marginLeft: 4 }}>%{f.pct.toFixed(1)}</span>
                    </div>
                    <div style={{ height: 4, background: 'var(--bg-surface-3)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{
                        height: '100%',
                        width: `${Math.min(100, f.pct * 5)}%`,
                        background: isTop ? 'var(--accent)' : 'var(--border-strong)',
                        borderRadius: 2,
                      }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function StatChip({ label, value, tone }: { label: string; value: string; tone: 'profit' | 'info' | 'accent' | 'neutral' }) {
  const c = { profit: 'var(--profit)', info: 'var(--info)', accent: 'var(--accent)', neutral: 'var(--text-secondary)' }[tone]
  const bg = { profit: 'var(--profit-bg)', info: 'var(--info-bg)', accent: 'var(--accent-bg)', neutral: 'var(--bg-surface-2)' }[tone]
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)', padding: '8px 11px', background: bg, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
      <span style={{ fontSize: 'var(--text-xs)', color: c, fontWeight: 'var(--fw-bold)', whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', textAlign: 'right' }}>{value}</span>
    </div>
  )
}

function WfMetric({ label, val, highlight, be }: { label: string; val: number | null; highlight?: boolean; be?: number | null }) {
  const color = val == null ? 'var(--text-muted)'
    : (be != null ? (val >= be ? 'var(--profit)' : 'var(--loss)') : (val >= 0.5 ? 'var(--profit)' : 'var(--warning)'))
  return (
    <div style={{ background: 'var(--bg-surface-2)', borderRadius: 'var(--radius-sm)', padding: 'var(--space-3)', border: `1px solid ${highlight ? 'var(--accent-border)' : 'var(--border-default)'}` }}>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginBottom: '4px' }}>{label}</div>
      <div style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--fw-black)', color, fontVariantNumeric: 'tabular-nums' }}>
        {val != null ? `%${(val * 100).toFixed(1)}` : '—'}
      </div>
    </div>
  )
}

function WfMetricRaw({ label, val, color }: { label: string; val: string; color?: string }) {
  return (
    <div style={{ background: 'var(--bg-surface-2)', borderRadius: 'var(--radius-sm)', padding: 'var(--space-3)', border: '1px solid var(--border-default)' }}>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginBottom: '4px' }}>{label}</div>
      <div style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--fw-black)', fontVariantNumeric: 'tabular-nums', color }}>{val}</div>
    </div>
  )
}
