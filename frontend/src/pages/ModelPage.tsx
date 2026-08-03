// =============================================================================
// SerInvest — Model  (route: /model)   [eski ML Ops + Yönetim birleşimi]
//
// Tasarım ilkesi: önce DÜZ TÜRKÇE cevap, sonra butonlar, jargon en sona katlanır.
// Kullanıcı şikâyeti (07/2026): "bir sürü şey var ama ne olduğunu anlamıyorum".
// Bu yüzden üstteki durum kartı sayıları CÜMLEYE çevirir; ham metrikler
// "İleri metrikler" panelinde gizlidir.
// =============================================================================
import { useCallback, useEffect, useState } from 'react'
import { ADMIN, API, adminFetch } from '../lib/api'
import { PageHeader, Icon } from '../components/ui'
import { ModelStory, JobStatus } from '../components/finance'
import { useToast } from '../components/ui/Toast'
import type { SysLog, TrainingInfo, AdminStatus } from '../lib/types'

interface CalSummary {
  total: number; evaluated: number; ripening: number; matured_total: number
  buy_decided: number; buy_correct: number; hit_rate: number | null
  next_verdict: string | null; next_verdict_n: number
}
interface DriftResp {
  drift?: { status: string; message?: string
            n_live?: number; n_live_days?: number; min_rows?: number; min_days?: number }
  calibration?: { status: string; message?: string
                  n_evaluated?: number; min_required?: number }
}

// ── Katlanır bölüm ───────────────────────────────────────────────────────────
function Fold({ title, hint, children, open: initOpen = false }:
  { title: string; hint?: string; children: React.ReactNode; open?: boolean }) {
  const [open, setOpen] = useState(initOpen)
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 'var(--space-3)' }}>
      <button onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
          padding: '10px 14px', background: 'transparent', border: 'none', textAlign: 'left',
          color: 'var(--text-primary)', fontSize: 13, fontWeight: 700,
        }}>
        <span style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s', color: 'var(--text-muted)' }}>▸</span>
        {title}
        {hint && <span style={{ fontWeight: 400, fontSize: 11.5, color: 'var(--text-muted)' }}>{hint}</span>}
      </button>
      {open && <div style={{ padding: '0 14px 14px', borderTop: '1px solid var(--border-subtle)' }}>{children}</div>}
    </div>
  )
}

const pct = (v: number | null | undefined, d = 1) => v == null ? '—' : `%${(v * 100).toFixed(d)}`
const trDate = (iso?: string | null) =>
  !iso ? '—' : new Date(iso.length <= 10 ? iso + 'T00:00:00' : iso)
    .toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })

export default function ModelPage() {
  const toast = useToast()
  const [info, setInfo]   = useState<TrainingInfo | null>(null)
  const [status, setStatus] = useState<AdminStatus | null>(null)
  const [cal, setCal]     = useState<CalSummary | null>(null)
  const [drift, setDrift] = useState<DriftResp | null>(null)
  const [logs, setLogs]   = useState<SysLog[]>([])
  const [feats, setFeats] = useState<{ features: { name: string; pct: number }[]; groups: Record<string, number> } | null>(null)
  const [busy, setBusy]   = useState(false)
  const [allLogs, setAllLogs] = useState(false)

  const load = useCallback(() => {
    const g = (p: string, set: (v: any) => void) =>
      adminFetch(`${ADMIN}/${p}`).then(r => r.ok ? r.json() : null).then(d => d && set(d)).catch(() => {})
    g('training-info', setInfo)
    g('status', setStatus)
    g('feature-importance', setFeats)
    g('drift', setDrift)
    adminFetch(`${ADMIN}/prediction-calendar`).then(r => r.ok ? r.json() : null)
      .then(d => d?.summary && setCal(d.summary)).catch(() => {})
    fetch(`${API}/oracle/syslogs`).then(r => r.ok ? r.json() : null)
      .then(d => d?.logs && setLogs(d.logs)).catch(() => {})
  }, [])

  useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t) }, [load])

  const act = async (path: string, label: string) => {
    setBusy(true)
    try {
      const r = await adminFetch(`${ADMIN}/${path}`, { method: 'POST' })
      if (r.status === 401) { toast.error('Yetki yok — Admin API anahtarı eksik'); return }
      const j = await r.json()
      j.error ? toast.error(j.error) : toast.success(j.message ?? `${label} başlatıldı`)
      setTimeout(load, 2000)
    } catch { toast.error('Sunucuya ulaşılamadı') } finally { setBusy(false) }
  }

  // ── Düz Türkçe durum cümleleri ─────────────────────────────────────────────
  const trained  = info?.champion?.trained_at ?? null
  const ageDays  = status?.model_age_hours != null ? Math.round(status.model_age_hours / 24) : null
  const live     = info?.live_accuracy
  const hit      = cal?.hit_rate ?? null
  // Taban çizgisi: "hepsini alsaydık" oranı — lift'in referansı
  const baseRate = (live as any)?.base_rate ?? null
  const lift     = baseRate != null && hit != null ? hit - baseRate : null

  const skill = lift == null ? null
    : lift >= 0.03 ? { txt: 'Model tabanı belirgin geçiyor', tone: 'var(--profit)' }
    : lift >= 0.005 ? { txt: 'Model tabanı hafif geçiyor', tone: 'var(--warning)' }
    : { txt: 'Model tabandan farklı sonuç üretmiyor', tone: 'var(--loss)' }

  return (
    <div style={{ paddingTop: 'var(--space-2)' }}>
      <PageHeader
        icon={<Icon name="mlops" size={20} />}
        title="Model"
        subtitle={<>Durum, kontroller ve performans — eski “ML Ops” + “Yönetim” tek sayfada</>}
      />

      {/* ── 1. DURUM KARTI — sayılar değil, cümleler ────────────────────── */}
      <div className="card" style={{ padding: '14px 16px', marginBottom: 'var(--space-3)' }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase',
                      color: 'var(--text-muted)', marginBottom: 9 }}>
          Şu an ne durumda?
        </div>

        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, lineHeight: 1.85, color: 'var(--text-secondary)' }}>
          <li>
            Model <b style={{ color: 'var(--text-primary)' }}>{trDate(trained)}</b> tarihinde eğitildi
            {ageDays != null && <> (<b>{ageDays} gün</b> önce)</>} ve <b>o günden beri değişmedi</b>.
            {' '}Model yalnızca Pazar 20:00 korumalı terfide, rakip 3 bağımsız pencerede kazanırsa değişir.
          </li>
          {cal && (
            <li>
              <b style={{ color: 'var(--text-primary)' }}>{cal.total}</b> tahmin yapıldı;
              {' '}<b style={{ color: 'var(--text-primary)' }}>{cal.evaluated}</b> tanesi sonuçlandı,
              {' '}<b>{cal.ripening}</b> tanesi hâlâ olgunlaşıyor
              {cal.next_verdict && <> (sıradaki sonuç: <b>{trDate(cal.next_verdict)}</b>, {cal.next_verdict_n} tahmin)</>}.
            </li>
          )}
          {hit != null && (
            <li>
              Sonuçlananlarda isabet <b style={{ color: 'var(--text-primary)' }}>{pct(hit)}</b>
              {baseRate != null && <> — ama “hepsini alsaydık” tabanı <b>{pct(baseRate)}</b> idi</>}.
              {skill && <> <b style={{ color: skill.tone }}>{skill.txt}.</b></>}
              {lift != null && <span style={{ color: 'var(--text-muted)' }}> (fark {lift >= 0 ? '+' : ''}{(lift * 100).toFixed(1)} puan)</span>}
            </li>
          )}
          <li>
            Sağlık: veri kayması{' '}
            <b>{drift?.drift?.status === 'OK' ? 'normal'
              : drift?.drift?.status === 'DRIFT' ? 'UYARI'
              : 'henüz ölçülemiyor'}</b>
            {drift?.drift?.status === 'COLLECTING' && drift.drift.min_days != null && (
              <span style={{ color: 'var(--text-muted)' }}>
                {' '}({drift.drift.n_live_days ?? 0}/{drift.drift.min_days} bağımsız gün toplandı)
              </span>
            )},{' '}
            kalibrasyon{' '}
            <b>{drift?.calibration?.status === 'OK' ? 'normal'
              : drift?.calibration?.status === 'MISCALIBRATED' ? 'SAPMIŞ'
              : 'henüz ölçülemiyor'}</b>
            {drift?.calibration?.status === 'COLLECTING' && drift.calibration.min_required != null && (
              <span style={{ color: 'var(--text-muted)' }}>
                {' '}({drift.calibration.n_evaluated ?? 0}/{drift.calibration.min_required} sonuçlanmış tahmin)
              </span>
            )}.
          </li>
          <li>
            <b>{status?.n_symbols ?? '—'}</b> sembol analiz ediliyor;
            {' '}izleme listesinde toplam <b>{info?.symbols?.total ?? '—'}</b> varlık var
            {' '}({status?.bist_count ?? '—'} BIST hissesi + emtia/döviz).
          </li>
        </ul>
      </div>

      {/* ── 2. EYLEMLER ─────────────────────────────────────────────────── */}
      <div className="card" style={{ padding: '13px 16px', marginBottom: 'var(--space-3)' }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase',
                      color: 'var(--text-muted)', marginBottom: 10 }}>
          Ne yapabilirim?
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 8 }}>
          {[
            { p: 'analyze-now',  t: 'Şimdi analiz et',     d: 'Sıradaki döngüyü beklemeden tüm sembolleri tara (~1 dk)' },
            { p: 'evaluate-now', t: 'Şimdi değerlendir',   d: 'Olgunlaşmış tahminlerin sonucunu hesapla (~1-2 dk)' },
            { p: 'retrain',      t: 'Terfi kontrolü',      d: 'Rakip model şampiyonu geçiyor mu? Geçerse yerine geçer' },
            { p: 'walkforward',  t: 'Doğrulama çalıştır',  d: 'Geçmiş veride dürüst sınav + kalibratörü tazeler (~2-5 dk)' },
            { p: 'reset-model',  t: 'Veriyi yenile + eğit', d: 'Veri setini sıfırdan kur ve modeli yeniden eğit (~4-6 dk)', warn: true },
          ].map(b => (
            <button key={b.p} disabled={busy} onClick={() => act(b.p, b.t)}
              style={{
                textAlign: 'left', padding: '9px 11px', borderRadius: 5, cursor: busy ? 'wait' : 'pointer',
                border: `1px solid ${b.warn ? 'var(--loss-border)' : 'var(--border-default)'}`,
                background: b.warn ? 'var(--loss-bg)' : 'var(--bg-surface-2)',
                opacity: busy ? 0.6 : 1,
              }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: b.warn ? 'var(--loss)' : 'var(--text-primary)' }}>{b.t}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4, marginTop: 2 }}>{b.d}</div>
            </button>
          ))}
        </div>
      </div>

      {/* ── 2b. ZAMANLANMIŞ İŞLER — "bugünkü değerlendirme yapıldı mı?" ──── */}
      <div style={{ marginBottom: 'var(--space-3)' }}>
        <JobStatus />
      </div>

      {/* ── 3. MODELİN HİKÂYESİ (görsel) ────────────────────────────────── */}
      <div style={{ marginBottom: 'var(--space-3)' }}>
        <ModelStory />
      </div>

      {/* ── 4. KATLANIR: son olaylar ────────────────────────────────────── */}
      <Fold title="Son olaylar" hint={`· ${logs.length} kayıt`}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 10 }}>
          {(allLogs ? logs : logs.slice(0, 10)).map((l, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '52px 60px 1fr', gap: 8,
                                  fontSize: 11.5, padding: '3px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ color: 'var(--text-disabled)', fontVariantNumeric: 'tabular-nums' }}>
                {l.timestamp.slice(11, 16)}
              </span>
              <span style={{ fontWeight: 700, fontSize: 10,
                             color: l.level === 'ERROR' ? 'var(--loss)' : l.level === 'WARN' ? 'var(--warning)'
                                  : l.level === 'SUCCESS' ? 'var(--profit)' : 'var(--text-muted)' }}>
                {l.level}
              </span>
              <span style={{ color: 'var(--text-secondary)' }}>{l.message}</span>
            </div>
          ))}
        </div>
        {logs.length > 10 && (
          <button onClick={() => setAllLogs(a => !a)}
            style={{ marginTop: 8, fontSize: 11.5, cursor: 'pointer', background: 'transparent',
                     border: 'none', color: 'var(--accent)' }}>
            {allLogs ? '↑ Sadece son 10' : `↓ Tümünü göster (${logs.length})`}
          </button>
        )}
      </Fold>

      {/* ── 4. KATLANIR: ileri metrikler ────────────────────────────────── */}
      <Fold title="İleri metrikler" hint="· doğrulama sınavı, kâr eşiği, ayrım gücü">
        <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          {[
            { k: 'Geçmiş sınav — yön doğruluğu', v: pct(info?.walkforward?.overall_accuracy as any),
              h: 'Walk-forward: modelin hiç görmediği geçmiş dönemlerde yönü bilme oranı' },
            { k: 'Geçmiş sınav — AL isabeti', v: pct((info?.walkforward as any)?.buy_precision),
              h: 'AL dediğinde hedefe önce değme oranı (geçmiş sınavda)' },
            { k: 'Kâr eşiği', v: pct((info?.walkforward as any)?.breakeven_precision),
              h: 'Bu oranın ÜSTÜ kârlı. Hedef stoptan büyük olduğu için %50 gerekmiyor' },
            { k: 'Ayrım gücü (AUC)', v: ((info?.walkforward as any)?.auc ?? '—').toString(),
              h: '0.50 = yazı-tura, 1.00 = kusursuz ayrım' },
            { k: 'Sınav örneklemi', v: (info?.walkforward?.n_predictions ?? (info?.walkforward as any)?.n_oos ?? '—').toLocaleString?.('tr-TR') ?? '—',
              h: 'Geçmiş sınavda değerlendirilen tahmin sayısı' },
            { k: 'Eğitim verisi', v: (info?.training_csv?.total_rows ?? '—').toLocaleString?.('tr-TR') ?? '—',
              h: 'Modelin öğrendiği örnek sayısı' },
          ].map(m => (
            <div key={m.k} title={m.h} style={{ padding: '8px 10px', borderRadius: 4,
                                                background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1.3 }}>{m.k}</div>
              <div style={{ fontSize: 17, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{m.v}</div>
              <div style={{ fontSize: 10, color: 'var(--text-disabled)', lineHeight: 1.4, marginTop: 3 }}>{m.h}</div>
            </div>
          ))}
        </div>
      </Fold>

      {/* ── 5. KATLANIR: model neye bakıyor ─────────────────────────────── */}
      <Fold title="Model neye bakıyor?" hint="· en etkili göstergeler">
        {feats && (
          <div style={{ marginTop: 10 }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
              {Object.entries(feats.groups ?? {}).sort((a, b) => b[1] - a[1]).map(([g, v]) => (
                <span key={g} style={{ fontSize: 11, padding: '2px 9px', borderRadius: 999,
                                       background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)' }}>
                  {g} <b>%{v}</b>
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {(feats.features ?? []).slice(0, 10).map(f => (
                <div key={f.name} style={{ display: 'grid', gridTemplateColumns: '150px 1fr 44px', gap: 8,
                                           alignItems: 'center', fontSize: 11.5 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>{f.name}</span>
                  <div style={{ height: 7, borderRadius: 3, background: 'var(--bg-surface-3)', overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(100, f.pct * 5)}%`, height: '100%', background: 'var(--accent)' }} />
                  </div>
                  <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)' }}>%{f.pct}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Fold>

      {/* ── 6. KATLANIR: izlenen semboller ──────────────────────────────── */}
      <Fold title="İzlenen varlıklar" hint={`· ${info?.symbols?.total ?? 0} sembol`}>
        <div style={{ marginTop: 10, fontSize: 11.5, lineHeight: 1.9, color: 'var(--text-secondary)' }}>
          {(['bist', 'commodity', 'forex'] as const).map(k => {
            const arr = (info?.symbols as any)?.[k] as string[] | undefined
            if (!arr?.length) return null
            const lbl = k === 'bist' ? 'BIST hisseleri' : k === 'commodity' ? 'Emtia' : 'Döviz'
            return (
              <div key={k} style={{ marginBottom: 6 }}>
                <b style={{ color: 'var(--text-primary)' }}>{lbl} ({arr.length}):</b>{' '}
                <span style={{ color: 'var(--text-muted)' }}>{arr.join(' · ')}</span>
              </div>
            )
          })}
        </div>
      </Fold>
    </div>
  )
}
