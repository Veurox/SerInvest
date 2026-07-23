// =============================================================================
// SerInvest — Yönetim (Admin) Sekmesi
// Model durumu, walk-forward özeti, feature importance, eğitim verisi yönetimi.
// =============================================================================
import { useEffect, useState } from 'react'
import { ADMIN, adminFetch } from '../lib/api'
import { ActionBtn } from '../components/common/ActionBtn'
import { AdminKeyInput, GROUP_COLORS } from '../components/common/AdminKeyInput'
import { PageHeader, Icon } from '../components/ui'
import type {
  AdminStatus, FeatImportance, PredRow, PredSummary, SymbolList, TrainingInfo,
} from '../lib/types'

export function AdminTab() {
  const [status, setStatus]       = useState<AdminStatus | null>(null)
  const [featImp, setFeatImp]     = useState<FeatImportance | null>(null)
  const [symbols, setSymbols]     = useState<SymbolList | null>(null)
  const [busy, setBusy]           = useState(false)
  const [toast, setToast]         = useState('')
  const [confirmAction, setConfirmAction] = useState<null | { label: string; action: () => void }>(null)
  const [predLog, setPredLog]     = useState<{ rows: PredRow[]; summary: PredSummary } | null>(null)
  const [trainingInfo, setTrainingInfo] = useState<TrainingInfo | null>(null)

  const fetchStatus = async () => {
    try {
      const r = await adminFetch(`${ADMIN}/status`)
      if (r.ok) setStatus(await r.json())
    } catch {}
  }
  const fetchFeatImp = async () => {
    try {
      const r = await adminFetch(`${ADMIN}/feature-importance`)
      if (r.ok) setFeatImp(await r.json())
    } catch {}
  }
  const fetchSymbols = async () => {
    try {
      const r = await adminFetch(`${ADMIN}/symbols`)
      if (r.ok) setSymbols(await r.json())
    } catch {}
  }
  const fetchPredLog = async () => {
    try {
      const r = await adminFetch(`${ADMIN}/prediction-log`)
      if (r.ok) setPredLog(await r.json())
    } catch {}
  }
  const fetchTrainingInfo = async () => {
    try {
      const r = await adminFetch(`${ADMIN}/training-info`)
      if (r.ok) setTrainingInfo(await r.json())
    } catch {}
  }

  useEffect(() => {
    fetchStatus(); fetchFeatImp(); fetchSymbols(); fetchPredLog(); fetchTrainingInfo()
    const t1 = setInterval(fetchStatus, 8_000)
    const t2 = setInterval(fetchPredLog, 30_000)
    return () => { clearInterval(t1); clearInterval(t2) }
  }, [])

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 5000)
  }

  const callAdmin = async (path: string, method = 'POST') => {
    setBusy(true)
    try {
      const r = await adminFetch(`${ADMIN}/${path}`, { method })
      if (r.status === 401) {
        showToast('Yetki yok — Admin API anahtarı eksik veya hatalı')
        return
      }
      const j = await r.json()
      showToast(j.message ?? j.error ?? 'Tamam')
      setTimeout(fetchStatus, 1500)
    } catch (e) {
      showToast('Sunucuya ulaşılamadı')
    } finally {
      setBusy(false)
    }
  }

  const confirm = (label: string, action: () => void) =>
    setConfirmAction({ label, action })

  const s = status

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', paddingTop: 'var(--space-2)' }}>

      <PageHeader
        icon={<Icon name="settings" size={20} />}
        title="Yönetim"
        subtitle={<>Champion model · veri · korumalı öğrenme kontrolleri <span className="tech-tag" style={{ marginLeft: 6 }}>● ml v3</span></>}
      />

      {/* Admin API Key kutusu */}
      <AdminKeyInput onSaved={() => { fetchStatus(); fetchTrainingInfo() }} />

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: '1.2rem', right: '1.5rem', zIndex: 999,
          background: 'var(--bg-surface)', border: '1px solid var(--border-strong)', borderRadius: '10px',
          padding: '.75rem 1.25rem', color: 'var(--text-primary)', fontSize: '.85rem', maxWidth: '380px',
          boxShadow: '0 4px 24px rgba(0,0,0,.4)',
        }}>
          {toast}
        </div>
      )}

      {/* Onay Modalı */}
      {confirmAction && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} onClick={() => setConfirmAction(null)}>
          <div style={{
            background: 'var(--bg-surface)', border: '1px solid var(--border-strong)', borderRadius: '14px',
            padding: '1.75rem 2rem', maxWidth: '420px', width: '90%',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '.75rem', color: 'var(--text-primary)' }}>
              Onay Gerekiyor
            </div>
            <div style={{ color: '#94a3b8', fontSize: '.875rem', marginBottom: '1.5rem' }}>
              <strong style={{ color: 'var(--accent)' }}>{confirmAction.label}</strong> işlemini başlatmak istediğinden emin misin?
            </div>
            <div style={{ display: 'flex', gap: '.75rem', justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirmAction(null)}
                style={{ padding: '.5rem 1.2rem', borderRadius: '8px', border: '1px solid #334155',
                  background: 'transparent', color: '#94a3b8', cursor: 'pointer' }}>
                İptal
              </button>
              <button onClick={() => { confirmAction.action(); setConfirmAction(null) }}
                style={{ padding: '.5rem 1.2rem', borderRadius: '8px', border: 'none',
                  background: '#ef4444', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
                Evet, Başlat
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Model Durumu ── */}
      <section style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '14px', padding: '1.25rem 1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', marginBottom: '1rem' }}>
          <Icon name="bot" size={17} />
          <span style={{ fontWeight: 800, fontSize: '1rem' }}>Model Durumu</span>
          {s?.training.running && (
            <span style={{ marginLeft: 'auto', fontSize: '.72rem', padding: '.2rem .7rem',
              borderRadius: '999px', background: 'var(--accent-bg)', color: 'var(--accent)',
              fontWeight: 700, animation: 'pulse 2s infinite' }}>
              {s.training.task} çalışıyor...
            </span>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px,1fr))', gap: '.75rem' }}>
          {[
            { label: 'Model', value: s?.model_loaded ? 'Yüklü' : 'Yok', color: s?.model_loaded ? '#22c55e' : '#ef4444' },
            { label: 'Özellik Sayısı', value: s ? `${s.n_features} feature` : '—' },
            { label: 'Sembol Sayısı', value: s ? `${s.n_symbols} varlık` : '—' },
            { label: 'BIST Hissesi', value: s ? `${s.bist_count} hisse` : '—' },
            { label: 'Model Yaşı', value: s?.model_age_hours != null ? `${s.model_age_hours}s önce` : '—' },
            { label: 'WF Yön Doğruluğu', value: s?.wf_accuracy != null ? `${(s.wf_accuracy*100).toFixed(1)}%` : '—', color: s?.wf_accuracy != null ? (s.wf_accuracy > 0.45 ? '#22c55e' : '#f59e0b') : undefined },
            { label: 'WF AL Precision', value: s?.wf_buy_accuracy != null ? `${(s.wf_buy_accuracy*100).toFixed(1)}%` : '—', color: '#22c55e' },
            { label: 'WF OOS Tahmin', value: s?.wf_n_predictions != null ? `${s.wf_n_predictions.toLocaleString('tr-TR')}` : '—' },
          ].map(item => (
            <div key={item.label} style={{ background: 'var(--tint-2)', borderRadius: '10px', padding: '.75rem 1rem' }}>
              <div style={{ fontSize: '.68rem', color: 'var(--text-muted)', marginBottom: '.25rem', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                {item.label}
              </div>
              <div style={{ fontWeight: 700, fontSize: '.95rem', color: item.color ?? 'var(--text)' }}>
                {item.value}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Eylem Butonları ── */}
      <section style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '14px', padding: '1.25rem 1.5rem' }}>
        <div style={{ fontWeight: 800, fontSize: '1rem', marginBottom: '1rem' }}>Model Yönetimi</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.75rem' }}>

          <ActionBtn
            icon={<Icon name="refresh" size={18} />} label="Anlık Analiz" desc="Sıradaki döngüyü beklemeden BIST-50'yi tara (~1dk)"
            color="#818cf8" disabled={busy || s?.training.running}
            onClick={() => callAdmin('analyze-now')}
          />
          <ActionBtn
            icon={<Icon name="shield" size={18} />} label="Korumalı Eğitim" desc="Şampiyon-rakip: rakip bağımsız pencerede şampiyonu net geçerse terfi eder"
            color="#22c55e" disabled={busy || s?.training.running}
            onClick={() => confirm('Korumalı Promosyon (şampiyon-rakip)', () => callAdmin('retrain'))}
          />
          <ActionBtn
            icon={<Icon name="trending-up" size={18} />} label="Walk-Forward" desc="Dürüst purged+embargo doğrulama (önbellekli veri, ~2-5dk)"
            color="#f59e0b" disabled={busy || s?.training.running}
            onClick={() => confirm('Dürüst Walk-Forward Doğrulaması', () => callAdmin('walkforward'))}
          />
          <ActionBtn
            icon={<Icon name="alert" size={18} />} label="Veriyi Yenile + Eğit" desc="BIST-50 veri setini sıfırdan kur + champion'ı yeniden eğit (~4-6dk)"
            color="#ef4444" disabled={busy || s?.training.running}
            onClick={() => confirm('Veri setini yeniden kur ve champion eğit', () => callAdmin('reset-model'))}
          />
        </div>
        {s?.training.running && s.training.started_at && (
          <div style={{ marginTop: '.75rem', fontSize: '.78rem', color: 'var(--accent)' }}>
            ⏳ Başlangıç: {new Date(s.training.started_at).toLocaleTimeString('tr-TR')} — tamamlanınca sayfa güncellenir
          </div>
        )}
      </section>

      {/* ── Feature Importance ── */}
      {featImp && (
        <section style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '14px', padding: '1.25rem 1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', marginBottom: '1rem' }}>
            <Icon name="fundamental" size={17} />
            <span style={{ fontWeight: 800, fontSize: '1rem' }}>Feature Importance</span>
            <span style={{ fontSize: '.7rem', color: 'var(--text-muted)', marginLeft: '.5rem' }}>En önemli 15 özellik</span>
          </div>

          {/* Grup özeti */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem', marginBottom: '1.25rem' }}>
            {Object.entries(featImp.groups).sort((a,b) => b[1]-a[1]).map(([g, pct]) => (
              <span key={g} style={{
                padding: '.2rem .65rem', borderRadius: '999px', fontSize: '.72rem', fontWeight: 700,
                background: (GROUP_COLORS[g] ?? '#64748b') + '22',
                color: GROUP_COLORS[g] ?? '#64748b',
                border: `1px solid ${(GROUP_COLORS[g] ?? '#64748b')}44`,
              }}>
                {g} %{pct.toFixed(1)}
              </span>
            ))}
          </div>

          {/* Bar chart */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.45rem' }}>
            {featImp.features.slice(0, 15).map(f => (
              <div key={f.name} style={{ display: 'flex', alignItems: 'center', gap: '.75rem' }}>
                <div style={{ width: '170px', fontSize: '.72rem', color: 'var(--text)', textAlign: 'right',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 0 }}>
                  {f.name}
                </div>
                <div style={{ flex: 1, height: '14px', background: 'var(--tint-3)', borderRadius: '4px', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', width: `${f.pct * 3.5}%`, maxWidth: '100%',
                    background: GROUP_COLORS[f.group] ?? '#64748b',
                    borderRadius: '4px', transition: 'width .4s',
                  }} />
                </div>
                <div style={{ width: '44px', fontSize: '.72rem', color: GROUP_COLORS[f.group] ?? '#94a3b8',
                  fontWeight: 700, textAlign: 'right', flexShrink: 0 }}>
                  %{f.pct.toFixed(1)}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Sembol Listesi ── */}
      {symbols && (
        <section style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '14px', padding: '1.25rem 1.5rem' }}>
          <div style={{ fontWeight: 800, fontSize: '1rem', marginBottom: '1rem' }}>
            Takip Edilen Varlıklar
            <span style={{ fontSize: '.75rem', color: 'var(--text-muted)', fontWeight: 400, marginLeft: '.6rem' }}>
              Toplam {symbols.total} sembol
            </span>
          </div>
          {([['BIST Hisseleri', symbols.bist], ['Emtialar', symbols.commodity], ['Döviz/Forex', symbols.forex]] as const).map(([title, list]) => (
            <div key={title} style={{ marginBottom: '1rem' }}>
              <div style={{ fontSize: '.72rem', color: 'var(--text-muted)', textTransform: 'uppercase',
                letterSpacing: '.06em', marginBottom: '.5rem' }}>
                {title} ({list.length})
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.35rem' }}>
                {list.map(s => (
                  <span key={s.ticker} style={{
                    padding: '.2rem .55rem', borderRadius: '6px', fontSize: '.72rem', fontWeight: 600,
                    background: 'var(--tint-3)', color: 'var(--text-secondary)',
                    border: '1px solid var(--tint-5)',
                  }}>
                    {s.ticker}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {/* ── Eğitim Verisi Durumu ── */}
      {trainingInfo && (
        <section style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '14px', padding: '1.25rem 1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', marginBottom: '1rem' }}>
            <Icon name="list" size={17} />
            <span style={{ fontWeight: 800, fontSize: '1rem' }}>Eğitim Verisi Durumu</span>
          </div>

          {/* Walk-forward özeti */}
          {trainingInfo.walkforward && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px,1fr))', gap: '.65rem', marginBottom: '1rem' }}>
              {[
                { label: 'WF Tamamlandı', value: (() => { const raw = trainingInfo.walkforward!.completed_at ?? ''; const d = new Date(raw.endsWith('Z') ? raw : raw + 'Z'); return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('tr-TR', { day:'2-digit', month:'short', year:'numeric' }) + ' ' + d.toLocaleTimeString('tr-TR', { hour:'2-digit', minute:'2-digit' }) })() },
                { label: 'Sembol Sayısı', value: `${trainingInfo.walkforward!.n_symbols} sembol` },
                { label: 'Adım Sayısı',   value: `${trainingInfo.walkforward!.n_steps} adım` },
                { label: 'WF Doğruluk',   value: trainingInfo.walkforward!.overall_accuracy != null ? `%${(trainingInfo.walkforward!.overall_accuracy * 100).toFixed(1)}` : '—', color: trainingInfo.walkforward!.overall_accuracy != null && trainingInfo.walkforward!.overall_accuracy > 0.45 ? '#22c55e' : '#f59e0b' },
                { label: 'WF Tahmin',     value: trainingInfo.walkforward!.n_predictions != null ? trainingInfo.walkforward!.n_predictions.toLocaleString('tr-TR') : '—' },
              ].map(item => (
                <div key={item.label} style={{ background: 'var(--tint-2)', borderRadius: '10px', padding: '.65rem .85rem' }}>
                  <div style={{ fontSize: '.65rem', color: 'var(--text-muted)', marginBottom: '.2rem', textTransform: 'uppercase', letterSpacing: '.04em' }}>{item.label}</div>
                  <div style={{ fontWeight: 700, fontSize: '.88rem', color: (item as any).color ?? 'var(--text)' }}>{item.value}</div>
                </div>
              ))}
            </div>
          )}

          {/* Eğitim CSV istatistikleri */}
          {trainingInfo.training_csv && (
            <>
              <div style={{ fontSize: '.72rem', color: 'var(--text-muted)', textTransform: 'uppercase',
                letterSpacing: '.06em', marginBottom: '.6rem', marginTop: '.25rem' }}>
                Eğitim CSV
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px,1fr))', gap: '.65rem', marginBottom: '1rem' }}>
                {[
                  { label: 'Toplam Satır',  value: trainingInfo.training_csv.total_rows != null ? trainingInfo.training_csv.total_rows.toLocaleString('tr-TR') : '—' },
                  { label: 'Özellik Sayısı',value: trainingInfo.training_csv.n_features != null ? `${trainingInfo.training_csv.n_features} feature` : '—' },
                  { label: 'Dosya Boyutu',  value: trainingInfo.training_csv.file_size_mb != null ? `${trainingInfo.training_csv.file_size_mb} MB` : '—' },
                  { label: 'Yukarı (UP)',   value: trainingInfo.training_csv.label_balance?.up_pct != null ? `%${trainingInfo.training_csv.label_balance.up_pct.toFixed(1)}` : '—', color: '#22c55e' },
                  { label: 'Aşağı (DOWN)',  value: trainingInfo.training_csv.label_balance?.down_pct != null ? `%${trainingInfo.training_csv.label_balance.down_pct.toFixed(1)}` : '—', color: '#ef4444' },
                  { label: 'Son Güncelleme',value: trainingInfo.training_csv.modified_at ?? '—' },
                ].map(item => (
                  <div key={item.label} style={{ background: 'var(--tint-2)', borderRadius: '10px', padding: '.65rem .85rem' }}>
                    <div style={{ fontSize: '.65rem', color: 'var(--text-muted)', marginBottom: '.2rem', textTransform: 'uppercase', letterSpacing: '.04em' }}>{item.label}</div>
                    <div style={{ fontWeight: 700, fontSize: '.88rem', color: (item as any).color ?? 'var(--text)' }}>{item.value}</div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Canlı doğruluk (değerlendirilmiş tahminlerden) */}
          {trainingInfo.live_accuracy && trainingInfo.live_accuracy.total_evaluated > 0 && (
            <>
              <div style={{ fontSize: '.72rem', color: 'var(--text-muted)', textTransform: 'uppercase',
                letterSpacing: '.06em', marginBottom: '.6rem' }}>
                Canlı Tahmin Doğruluğu
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px,1fr))', gap: '.65rem' }}>
                {[
                  { label: 'Değerlendirilen', value: trainingInfo.live_accuracy.total_evaluated.toLocaleString('tr-TR') },
                  { label: 'Doğru Tahmin',    value: trainingInfo.live_accuracy.total_correct.toLocaleString('tr-TR'), color: '#22c55e' },
                  { label: 'Genel Doğruluk',  value: trainingInfo.live_accuracy.overall != null ? `%${(trainingInfo.live_accuracy.overall * 100).toFixed(1)}` : '—', color: trainingInfo.live_accuracy.overall != null && trainingInfo.live_accuracy.overall > 0.45 ? '#22c55e' : '#f59e0b' },
                  { label: 'Son Değerlendirme', value: trainingInfo.live_accuracy.last_eval ?? '—' },
                ].map(item => (
                  <div key={item.label} style={{ background: 'var(--tint-2)', borderRadius: '10px', padding: '.65rem .85rem' }}>
                    <div style={{ fontSize: '.65rem', color: 'var(--text-muted)', marginBottom: '.2rem', textTransform: 'uppercase', letterSpacing: '.04em' }}>{item.label}</div>
                    <div style={{ fontWeight: 700, fontSize: '.88rem', color: (item as any).color ?? 'var(--text)' }}>{item.value}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {/* ── Tahmin Geçmişi ── */}
      {predLog && (
        <section style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '14px', padding: '1.25rem 1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
            <Icon name="history" size={17} />
            <span style={{ fontWeight: 800, fontSize: '1rem' }}>Tahmin Geçmişi</span>
            <span style={{ fontSize: '.7rem', color: 'var(--text-muted)', marginLeft: '.25rem' }}>Son 200 tahmin</span>

            {/* Özet pill'ler */}
            <div style={{ display: 'flex', gap: '.5rem', marginLeft: 'auto', flexWrap: 'wrap' }}>
              {[
                { label: `Toplam ${predLog.summary.total}`, color: '#94a3b8' },
                { label: `Değerlendirildi ${predLog.summary.evaluated}`, color: '#38bdf8' },
                { label: `Bekliyor ${predLog.summary.pending}`, color: 'var(--accent)' },
                ...(predLog.summary.accuracy != null ? [{ label: `Doğruluk %${(predLog.summary.accuracy * 100).toFixed(1)}`, color: predLog.summary.accuracy > 0.45 ? '#22c55e' : '#f59e0b' }] : []),
              ].map(p => (
                <span key={p.label} style={{ padding: '.2rem .65rem', borderRadius: '999px', fontSize: '.7rem', fontWeight: 700,
                  background: p.color + '22', color: p.color, border: `1px solid ${p.color}44` }}>
                  {p.label}
                </span>
              ))}
            </div>
          </div>

          {/* En iyi / en kötü semboller */}
          {(predLog.summary.top_symbols?.length > 0 || predLog.summary.worst_symbols?.length > 0) && (
            <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
              {predLog.summary.top_symbols?.length > 0 && (
                <div>
                  <div style={{ fontSize: '.65rem', color: '#22c55e', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '.35rem' }}>En İyi</div>
                  <div style={{ display: 'flex', gap: '.35rem', flexWrap: 'wrap' }}>
                    {predLog.summary.top_symbols.map(ts => (
                      <span key={ts.symbol} style={{ padding: '.2rem .5rem', borderRadius: '6px', fontSize: '.7rem', fontWeight: 700,
                        background: 'rgba(34,197,94,.1)', color: '#22c55e', border: '1px solid rgba(34,197,94,.25)' }}>
                        {ts.symbol} %{(ts.accuracy * 100).toFixed(0)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {predLog.summary.worst_symbols?.length > 0 && (
                <div>
                  <div style={{ fontSize: '.65rem', color: '#ef4444', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '.35rem' }}>En Kötü</div>
                  <div style={{ display: 'flex', gap: '.35rem', flexWrap: 'wrap' }}>
                    {predLog.summary.worst_symbols.map(ws => (
                      <span key={ws.symbol} style={{ padding: '.2rem .5rem', borderRadius: '6px', fontSize: '.7rem', fontWeight: 700,
                        background: 'rgba(239,68,68,.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,.25)' }}>
                        {ws.symbol} %{(ws.accuracy * 100).toFixed(0)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tablo */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.75rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Tarih', 'Sembol', 'Karar', 'Güven', 'Fiyat', 'Sonuç (10g)', 'Getiri'].map(h => (
                    <th key={h} style={{ padding: '.5rem .75rem', textAlign: h === 'Getiri' || h === 'Güven' || h === 'Fiyat' ? 'right' : 'left',
                      color: 'var(--text-muted)', fontWeight: 600, fontSize: '.65rem',
                      textTransform: 'uppercase', letterSpacing: '.05em', whiteSpace: 'nowrap' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {predLog.rows.map((row, i) => {
                  const ts = new Date((row.timestamp ?? '') + (row.timestamp?.endsWith('Z') ? '' : 'Z'))
                  const dateStr = isNaN(ts.getTime()) ? row.timestamp : ts.toLocaleDateString('tr-TR', { day:'2-digit', month:'short', year:'2-digit' })
                  const timeStr = isNaN(ts.getTime()) ? '' : ts.toLocaleTimeString('tr-TR', { hour:'2-digit', minute:'2-digit' })

                  const predColor = row.predicted === 'BUY' ? '#22c55e' : '#94a3b8'
                  const rowBg = !row.evaluated
                    ? 'transparent'
                    : row.correct ? 'rgba(34,197,94,.04)' : 'rgba(239,68,68,.04)'
                  const resultColor = !row.evaluated ? '#64748b' : row.correct ? '#22c55e' : '#ef4444'
                  const resultLabel = !row.evaluated ? 'Bekliyor' : row.correct ? 'Doğru' : 'Yanlış'

                  // parse return
                  const retVal = row.return ? parseFloat(row.return) : null
                  const retColor = retVal == null ? '#94a3b8' : retVal > 0 ? '#22c55e' : retVal < 0 ? '#ef4444' : '#94a3b8'
                  const retStr = retVal != null ? `${retVal > 0 ? '+' : ''}${(retVal * 100).toFixed(2)}%` : '—'

                  return (
                    <tr key={i} style={{ borderBottom: '1px solid var(--tint-2)', background: rowBg }}>
                      <td style={{ padding: '.45rem .75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        <div>{dateStr}</div>
                        <div style={{ fontSize: '.65rem', color: '#475569' }}>{timeStr}</div>
                      </td>
                      <td style={{ padding: '.45rem .75rem', fontWeight: 700, color: 'var(--text)' }}>{row.symbol}</td>
                      <td style={{ padding: '.45rem .75rem' }}>
                        <span style={{ padding: '.15rem .5rem', borderRadius: '5px', fontWeight: 700,
                          background: predColor + '22', color: predColor, border: `1px solid ${predColor}44`,
                          fontSize: '.7rem' }}>
                          {row.predicted}
                        </span>
                      </td>
                      <td style={{ padding: '.45rem .75rem', textAlign: 'right', fontWeight: 600,
                        color: row.confidence > 0.7 ? '#22c55e' : row.confidence > 0.55 ? '#fbbf24' : '#94a3b8' }}>
                        %{(row.confidence * 100).toFixed(0)}
                      </td>
                      <td style={{ padding: '.45rem .75rem', textAlign: 'right', color: 'var(--text-muted)' }}>
                        {row.close ? row.close.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                      </td>
                      <td style={{ padding: '.45rem .75rem', color: resultColor, fontWeight: 600, fontSize: '.7rem' }}>
                        {resultLabel}
                      </td>
                      <td style={{ padding: '.45rem .75rem', textAlign: 'right', fontWeight: 700, color: retColor }}>
                        {retStr}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {predLog.rows.length === 0 && (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '.8rem' }}>
                Henüz tahmin kaydı yok — sistem her gün 18:10'da otomatik analiz üretir
              </div>
            )}
          </div>
        </section>
      )}

    </div>
  )
}

