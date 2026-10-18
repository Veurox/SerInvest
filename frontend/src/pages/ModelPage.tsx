// =============================================================================
// SerInvest — Model  (route: /model)   [eski ML Ops + Yönetim birleşimi]
//
// Tasarım ilkesi: önce DÜZ TÜRKÇE cevap, sonra butonlar, jargon en sona katlanır.
// Kullanıcı şikâyeti (07/2026): "bir sürü şey var ama ne olduğunu anlamıyorum".
// Bu yüzden üstteki durum kartı sayıları CÜMLEYE çevirir; ham metrikler
// "İleri metrikler" panelinde gizlidir.
// =============================================================================
import { useCallback, useEffect, useRef, useState } from 'react'
import { ReliabilityCurve } from '../components/viz'
import { ADMIN, API, adminFetch } from '../lib/api'
import { useConfig } from '../lib/useConfig'
import { PageHeader } from '../components/ui'
import { useSearchParams } from 'react-router-dom'
import { ModelStory, JobStatus, SelfTestPanel, ModelVersions, ModelEvidence,
         RiskFilterPanel, DataDepth } from '../components/finance'
import { useToast } from '../components/ui/toastBaglam'
import type { SysLog, TrainingInfo, AdminStatus } from '../lib/types'
import { fmt, oranYuzde } from '../lib/format'

interface CalSummary {
  total: number; evaluated: number; ripening: number; matured_total: number
  buy_decided: number; buy_correct: number; hit_rate: number | null
  next_verdict: string | null; next_verdict_n: number
}
interface DriftResp {
  drift?: { status: string; message?: string
            n_live?: number; n_live_days?: number; min_rows?: number; min_days?: number }
  calibration?: { status: string; message?: string
                  n_evaluated?: number; min_required?: number
                  /** Gün düzeyi karar — havuzlanmış ECE anlamlılığı şişiriyordu. */
                  n_days?: number; min_days?: number
                  day_level?: { observed_up: number; predicted_cal_p: number
                                t: number; gap: number } | null
                  /** Canlı güvenilirlik eğrisinin kovaları (monitoring.py). */
                  bins?: Array<{ raw_p_range?: [number, number]; n: number
                                 predicted_cal_p: number; observed_up: number
                                 gap?: number }>
                  ece?: number | null; brier?: number | null }
}

/** /admin/job-progress — done/total GERÇEK iş birimidir (sembol/adım/pencere).
 *  total null ise birim sayılamıyor: yüzde uydurmak yerine aşama gösterilir. */
interface JobProgress {
  running: boolean; task: string | null; stage: string | null
  done: number; total: number | null; started_at: string | null
  last: { task: string; ok: boolean; message: string
          finished_at: string; duration_s: number | null } | null
}

const TASK_LABELS: Record<string, string> = {
  analiz: 'Analiz döngüsü', degerlendirme: 'Değerlendirme', terfi: 'Terfi kontrolü',
  dogrulama: 'Doğrulama (walk-forward)', 'veri-egitim': 'Veri kurulumu',
}
/** Düğme yolu → görev adı: koşan işin kartını vurgulamak için. */
const PATH_TASK: Record<string, string> = {
  'analyze-now': 'analiz', 'evaluate-now': 'degerlendirme', retrain: 'terfi',
  walkforward: 'dogrulama', 'reset-model': 'veri-egitim',
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

// ── Sekmeler (Faz E) ─────────────────────────────────────────────────────────
// Her sekme TEK bir soruya cevap verir; "bir sürü şey var ama ne olduğunu
// anlamıyorum" şikâyeti dokuz bölümün tek kaydırmada olmasından geliyordu.
type TabId = 'durum' | 'kanit' | 'kunye'
const TABS: { id: TabId; label: string; q: string }[] = [
  { id: 'durum', label: 'Durum',  q: 'bir şey bozuk mu?' },
  { id: 'kanit', label: 'Kanıt',  q: 'gerçekten bir şey biliyor mu?' },
  { id: 'kunye', label: 'Künye',  q: 'nasıl kuruldu, nasıl yönetilir?' },
]
const TAB_SUB: Record<TabId, string> = {
  durum: 'Sağlık, zamanlanmış işler ve kontroller',
  kanit: 'Ölçülmüş tahmin gücü — ve o ölçünün belirsizliği',
  kunye: 'Eğitim künyesi, sürümler ve modelin baktığı göstergeler',
}

/** Yerel kısaltma — biçim merkezden geliyor (lib/format). */
const pct = (v: number | null | undefined, d = 1) => oranYuzde(v, d)
const trDate = (iso?: string | null) =>
  !iso ? '—' : new Date(iso.length <= 10 ? iso + 'T00:00:00' : iso)
    .toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })

export default function ModelPage() {
  const toast = useToast()
  const cfg = useConfig()
  // Sekme URL'de tutulur (?t=kanit): paylaşılabilir ve yenilemede kaybolmaz.
  const [sp, setSp] = useSearchParams()
  const tab = (TABS.some(t => t.id === sp.get('t')) ? sp.get('t') : 'durum') as TabId
  const setTab = (t: TabId) => setSp(t === 'durum' ? {} : { t }, { replace: true })
  const [info, setInfo]   = useState<TrainingInfo | null>(null)
  const [status, setStatus] = useState<AdminStatus | null>(null)
  const [cal, setCal]     = useState<CalSummary | null>(null)
  const [drift, setDrift] = useState<DriftResp | null>(null)
  /** Eğitim/sınav kalibrasyonu — canlıyla YAN YANA gösterilecek.
      ModelStory de aynı uç noktayı çekiyor; iki istek yerine tek yerden
      dağıtmak daha temiz olurdu ama o bileşen bağımsız kalsın diye
      şimdilik ayrı. (5 dakikada bir, kişisel kullanım.) */
  const [egitimKalib, setEgitimKalib] = useState<
    Array<{ raw_p_range: [number, number]; n: number
            calibrated_p: number; observed_up: number }> | null>(null)
  const [logs, setLogs]   = useState<SysLog[]>([])
  const [feats, setFeats] = useState<{ features: { name: string; pct: number }[]; groups: Record<string, number> } | null>(null)
  const [busy, setBusy]   = useState(false)
  const [allLogs, setAllLogs] = useState(false)
  const [prog, setProg]   = useState<JobProgress | null>(null)

  const load = useCallback(() => {
    const g = <T,>(p: string, set: (v: T) => void) =>
      adminFetch(`${ADMIN}/${p}`).then(r => r.ok ? r.json() : null).then(d => d && set(d)).catch(() => {})
    g('training-info', setInfo)
    g('status', setStatus)
    g('feature-importance', setFeats)
    g('drift', setDrift)
    adminFetch(`${ADMIN}/model-story`).then(r => r.ok ? r.json() : null)
      .then(d => d?.calibration?.reliability && setEgitimKalib(d.calibration.reliability))
      .catch(() => {})
    adminFetch(`${ADMIN}/prediction-calendar`).then(r => r.ok ? r.json() : null)
      .then(d => d?.summary && setCal(d.summary)).catch(() => {})
    fetch(`${API}/oracle/syslogs`).then(r => r.ok ? r.json() : null)
      .then(d => d?.logs && setLogs(d.logs)).catch(() => {})
  }, [])

  useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t) }, [load])

  // İş ilerlemesi: 2 sn'de bir yokla — koşan işin çubuğu ve son işin karnesi.
  useEffect(() => {
    let stop = false
    const tick = () => adminFetch(`${ADMIN}/job-progress`)
      .then(r => r.ok ? r.json() : null)
      .then(j => { if (!stop && j && !j.error) setProg(j) })
      .catch(() => {})
    tick()
    const t = setInterval(tick, 2000)
    return () => { stop = true; clearInterval(t) }
  }, [])

  // İş bitince sayfa verilerini tazele — sonuç (yeni tahminler, yeni model
  // künyesi) çubuğun kaybolmasıyla AYNI anda görünsün, 60 sn'lik turu beklemesin.
  const wasRunning = useRef(false)
  useEffect(() => {
    if (wasRunning.current && !prog?.running) load()
    wasRunning.current = !!prog?.running
  }, [prog?.running, load])

  /**
   * Geri alınamayan işlemler onaysız başlamasın (25.09.2026).
   * O gün "Doğrulama çalıştır"a tek tıkla basıldı ve kalibrasyon ölçümünün
   * sayacı sıfırlandı. Yanındaki "Veriyi yenile + eğit" ise modeli sıfırdan
   * eğitiyor — o da tek tıklık bir işlemdi.
   */
  const ONAY: Record<string, string> = {
    walkforward: 'Kalibratör yenilenecek ve kalibrasyon ölçümü (I12) SIFIRDAN '
               + 'başlayacak — ilk dürüst okuma ~3 hafta ertelenir.\n\nDevam edilsin mi?',
    // 18.10.2026: eskiden "kalibrasyon ölçümü de sıfırlanır" diyordu — yanlıştı,
    // bu yol kalibratöre dokunmuyor. Artık model de yalnız terfi sınavını
    // geçerse değişiyor.
    'reset-model': 'Eğitim verisi baştan indirilecek (birkaç dakika) ve terfi sınavı hemen '
                 + 'çalışacak. Rakip şampiyonu geçmezse model DEĞİŞMEZ.\n\nDevam edilsin mi?',
  }

  const act = async (path: string, label: string) => {
    if (ONAY[path] && !window.confirm(ONAY[path])) return
    setBusy(true)
    try {
      const r = await adminFetch(`${ADMIN}/${path}`, { method: 'POST' })
      if (r.status === 401) { toast.error('Yetki yok — Admin API anahtarı eksik'); return }
      const j = await r.json()
      if (j.error) toast.error(j.error)
      else toast.success(j.message ?? `${label} başlatıldı`)
      setTimeout(load, 2000)
    } catch { toast.error('Sunucuya ulaşılamadı') } finally { setBusy(false) }
  }

  // ── Düz Türkçe durum cümleleri ─────────────────────────────────────────────
  const trained  = info?.champion?.trained_at ?? null
  const ageDays  = status?.model_age_hours != null ? Math.round(status.model_age_hours / 24) : null
  const live     = info?.live_accuracy
  const hit      = cal?.hit_rate ?? null
  // Taban çizgisi: "hepsini alsaydık" oranı — lift'in referansı
  const baseRate = live?.base_rate ?? null
  const lift     = baseRate != null && hit != null ? hit - baseRate : null

  const skill = lift == null ? null
    : lift >= 0.03 ? { txt: 'Model tabanı belirgin geçiyor', tone: 'var(--profit)' }
    : lift >= 0.005 ? { txt: 'Model tabanı hafif geçiyor', tone: 'var(--warning)' }
    : { txt: 'Model tabandan farklı sonuç üretmiyor', tone: 'var(--loss)' }

  return (
    <div className="ui2" style={{ minHeight: '100%', padding: 'var(--u-s4) var(--u-s5) var(--u-s5)' }}>
      {/* Sayfanın başlığı bir SORU (docs/PLAN_ARAYUZ.md §1). Sekmeler zaten
          üç alt soruya bölünmüştü; başlık da onların çatısı. */}
      <PageHeader
        title="Buna güvenebilir miyim?"
        subtitle={TAB_SUB[tab]}
      />

      {/* ── SEKMELER (Faz E) ─────────────────────────────────────────────
          Önce tek uzun kaydırmada 9 bölüm vardı ve "karışık" şikâyeti
          buradan geliyordu. Üç soruya üç sekme: bir şey bozuk mu / gerçekten
          bir şey biliyor mu / nasıl kurulup yönetiliyor.
          Seçim URL'de tutulur: paylaşılabilir ve yenilemede kaybolmaz. */}
      <div className="mtabs" role="tablist" aria-label="Model bölümleri">
        {TABS.map(t => (
          <button key={t.id} role="tab" aria-selected={tab === t.id}
                  onClick={() => setTab(t.id)}
                  className={`mtab${tab === t.id ? ' mtab--on' : ''}`}>
            {t.label}
            <span className="mtab__q">{t.q}</span>
          </button>
        ))}
      </div>

      {tab === 'durum' && <>
      {/* ── 1. DURUM KARTI — sayılar değil, cümleler ────────────────────── */}
      <div className="card" style={{ padding: '14px 16px', marginBottom: 'var(--space-3)' }}>
        <div className="u-label" style={{ marginBottom: 9 }}>
          Şu an ne durumda?
        </div>

        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, lineHeight: 1.85, color: 'var(--text-secondary)' }}>
          <li>
            Model <b style={{ color: 'var(--text-primary)' }}>{trDate(trained)}</b> tarihinde eğitildi
            {ageDays != null && <> (<b>{ageDays} gün</b> önce)</>} ve <b>o günden beri değişmedi</b>.
            {' '}Model yalnızca {cfg.schedule.promote} korumalı terfide, rakip {cfg.promotion.windows} bağımsız
            pencerede kazanırsa değişir.
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
              {lift != null && <span style={{ color: 'var(--text-muted)' }}> (fark {fmt(lift * 100, 1)} puan)</span>}
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
            {/* Hangi kısıt bağlayıcıysa O gösterilir. Gün eşiği eklendikten sonra
                yalnız satır saymak yanıltıcıydı: "401/150 tahmin" yazıp yanında
                "henüz ölçülemiyor" demek çelişki gibi okunuyordu. */}
            {drift?.calibration?.status === 'COLLECTING' && (
              <span style={{ color: 'var(--text-muted)' }}>
                {drift.calibration.min_days != null
                 && (drift.calibration.n_days ?? 0) < drift.calibration.min_days
                  ? <> ({drift.calibration.n_days ?? 0}/{drift.calibration.min_days} bağımsız gün toplandı)</>
                  : drift.calibration.min_required != null
                  ? <> ({drift.calibration.n_evaluated ?? 0}/{drift.calibration.min_required} sonuçlanmış tahmin)</>
                  : null}
              </span>
            )}
            {drift?.calibration?.status === 'MISCALIBRATED' && drift.calibration.day_level && (
              <span style={{ color: 'var(--text-muted)' }}>
                {' '}(kalibratör {pct(drift.calibration.day_level.predicted_cal_p)},
                {' '}{drift.calibration.n_days} günde gözlenen {pct(drift.calibration.day_level.observed_up)})
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
        <div className="u-label" style={{ marginBottom: 10 }}>
          Ne yapabilirim?
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 8 }}>
          {[
            // Seans içinde bar kapısı tahmini reddeder (yarım bar) — açıklama
            // bunu söylemezse düğme "çalışmıyor" sanılır.
            { p: 'analyze-now',  t: 'Şimdi analiz et',     d: 'Sıradaki döngüyü beklemeden tara (~1 dk). Seans açıkken yeni tahmin üretmez — günün barı 18.30 itibarıyla tamamlanmış sayılır' },
            { p: 'evaluate-now', t: 'Şimdi değerlendir',   d: 'Olgunlaşmış tahminlerin sonucunu hesapla (~1-2 dk)' },
            { p: 'retrain',      t: 'Terfi kontrolü',      d: 'Rakip model şampiyonu geçiyor mu? Geçerse yerine geçer' },
            // 25.09.2026: kalibratörü tazelemek I12'nin ölçüm sayacını sıfırlar.
            // Düğme bunu SÖYLEMİYORDU; o gün elle basıldı ve ilk dürüst
            // kalibrasyon okuması ekim başından ekim ortasına kaydı.
            { p: 'walkforward',  t: 'Doğrulama çalıştır',  d: 'Geçmiş veride dürüst sınav + kalibratörü tazeler (~2-5 dk). Kalibrasyon ölçümünü sıfırlar — ilk dürüst okuma ~3 hafta ertelenir', warn: true },
            { p: 'reset-model',  t: 'Veriyi yenile + sına', d: 'Eğitim verisini baştan indir, terfi sınavını hemen çalıştır (~5-8 dk). Model yalnız rakip geçerse değişir', warn: true },
          ].map(b => {
            const running = !!prog?.running
            const isActive = running && prog?.task === PATH_TASK[b.p]
            const off = busy || running
            return (
              <button key={b.p} disabled={off} onClick={() => act(b.p, b.t)}
                style={{
                  textAlign: 'left', padding: '9px 11px', borderRadius: 2,
                  cursor: off ? 'wait' : 'pointer',
                  border: `1px solid ${isActive ? 'var(--accent-border)'
                                     : b.warn ? 'var(--loss-border)' : 'var(--border-default)'}`,
                  background: isActive ? 'var(--accent-bg)'
                            : b.warn ? 'var(--loss-bg)' : 'var(--bg-surface-2)',
                  opacity: off && !isActive ? 0.55 : 1,
                }}>
                <div style={{ fontSize: 13, fontWeight: 700,
                              color: isActive ? 'var(--accent)' : b.warn ? 'var(--loss)' : 'var(--text-primary)' }}>
                  {b.t}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4, marginTop: 2 }}>{b.d}</div>
              </button>
            )
          })}
        </div>

        {/* Canlı ilerleme — done/total GERÇEK iş birimi (sembol/adım/pencere).
            total yoksa yüzde uydurulmaz: aşama metni + kayan şerit gösterilir. */}
        {prog?.running && (() => {
          const pct = prog.total ? Math.min(100, Math.round(100 * prog.done / prog.total)) : null
          const secs = prog.started_at
            ? Math.max(0, Math.round((Date.now() - Date.parse(prog.started_at + 'Z')) / 1000)) : null
          return (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                            fontSize: 11.5, marginBottom: 4, gap: 10 }}>
                <span style={{ fontWeight: 700 }}>
                  {TASK_LABELS[prog.task ?? ''] ?? prog.task}
                  <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>
                    {' '}— {prog.stage ?? 'başlıyor'}
                  </span>
                </span>
                <span className="t-num" style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  {pct != null ? `%${pct} · ${prog.done}/${prog.total}` : 'sayısız aşama'}
                  {secs != null ? ` · ${secs} sn` : ''}
                </span>
              </div>
              <div className="jobbar">
                {pct != null
                  ? <div className="jobbar__fill" style={{ width: `${pct}%` }} />
                  : <div className="jobbar__indet" />}
              </div>
            </div>
          )
        })()}

        {/* Son işin karnesi — "başarılı mı?" sorusunun kalıcı cevabı */}
        {!prog?.running && prog?.last && (
          <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'baseline',
                        flexWrap: 'wrap', fontSize: 11.5, padding: '6px 9px',
                        border: `1px solid ${prog.last.ok ? 'var(--profit-border)' : 'var(--loss-border)'}`,
                        background: prog.last.ok ? 'var(--profit-bg)' : 'var(--loss-bg)' }}>
            <b style={{ color: prog.last.ok ? 'var(--profit)' : 'var(--loss)', whiteSpace: 'nowrap' }}>
              {prog.last.ok ? '✓' : '✕'} {TASK_LABELS[prog.last.task] ?? prog.last.task}
              {prog.last.ok ? ' bitti' : ' BAŞARISIZ'}
            </b>
            <span style={{ color: 'var(--text-secondary)' }}>{prog.last.message}</span>
            {prog.last.duration_s != null && (
              <span className="t-num" style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>
                {prog.last.duration_s} sn
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── 2a. ÖZ DENETİM — değişmezler (sessiz hatalar burada görünür) ── */}
      <div style={{ marginBottom: 'var(--space-3)' }}>
        <SelfTestPanel />
      </div>

      {/* ── 2b. ZAMANLANMIŞ İŞLER — "bugünkü değerlendirme yapıldı mı?" ──── */}
      <div style={{ marginBottom: 'var(--space-3)' }}>
        <JobStatus />
      </div>

      {/* ── KATLANIR: son olaylar ───────────────────────────────────────── */}
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
      </>}

      {tab === 'kanit' && <>
        {/* Alternatif verinin derinliği — "ne zaman daha iyisi olur" (Faz B) */}
        <DataDepth />

        {/* Filtrenin durumu + gölge portföyle karşılaştırma (Faz A) */}
        <RiskFilterPanel />

        {/* Ölçülmüş sıralama gücü — açık başlar, sekmenin asıl konusu bu */}
        <ModelEvidence />

        {/* CANLI güvenilirlik eğrisi — ModelStory'dekiyle KARIŞTIRILMAMALI.
            Oradaki eğri eğitim/sınav verisinden: "model kurulurken dürüst
            müydü". Buradaki canlı tahminlerden: "sahada dürüst mü". İkincisi
            asıl sorudur ve şu an henüz birikiyor; boş grafik yerine ne kadar
            kaldığı yazıyor. */}
        <div style={{ marginBottom: 'var(--space-3)', padding: 'var(--u-s4) var(--u-s5)',
                      background: 'var(--u-panel)', borderRadius: 'var(--u-r-md)',
                      display: 'flex', gap: 'var(--u-s6)', flexWrap: 'wrap',
                      alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--u-s2)',
                        minWidth: 0, flex: '1 1 320px' }}>
            <span className="u-label">Canlı güvenilirlik — sahada dürüst mü?</span>
            <span className="u-sub" style={{ maxWidth: 440 }}>
              Model bir sembole “%70” dediğinde, öyle dediği yüz tahminin
              gerçekten yetmişi yukarı mı gitti? Bu, doğruluktan ayrı bir
              sorudur: güvenini abartan bir model, pozisyon büyüklüğünü
              olasılığa göre hesaplayan bir sistemde para kaybettirir.
            </span>
            {drift?.calibration?.day_level && (
              <span className="u-sub">
                Gün düzeyi karşılaştırma: model{' '}
                <b className="u-num">{oranYuzde(drift.calibration.day_level.predicted_cal_p, 1)}</b>
                {' '}dedi, gerçekleşen{' '}
                <b className="u-num">{oranYuzde(drift.calibration.day_level.observed_up, 1)}</b>.
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 'var(--u-s5)', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--u-s2)' }}>
              <span className="u-label">Eğitim/sınav — kurulurken</span>
              <ReliabilityCurve
                kovalar={(egitimKalib ?? []).map(r => ({
                  raw_p_range: r.raw_p_range, n: r.n,
                  predicted_cal_p: r.calibrated_p, observed_up: r.observed_up,
                }))}
                nToplam={(egitimKalib ?? []).reduce((t, r) => t + r.n, 0) || null}
                bekleyen="Eğitim kalibrasyon raporu okunamadı."
                boyut={268}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--u-s2)' }}>
              <span className="u-label">Canlı — sahada</span>
              <ReliabilityCurve
                kovalar={drift?.calibration?.bins ?? []}
                ece={drift?.calibration?.ece ?? null}
                brier={drift?.calibration?.brier ?? null}
                nToplam={drift?.calibration?.n_evaluated ?? null}
                gunSayisi={drift?.calibration?.n_days ?? null}
                bekleyen={drift?.calibration?.message}
                boyut={268}
              />
            </div>
          </div>
        </div>

        {/* Modelin görsel künyesi: sınav grafiği ve kalibrasyon eğrisi burada,
            çünkü ikisi de "gerçekten bir şey biliyor mu" sorusunun kanıtı. */}
        <div style={{ marginBottom: 'var(--space-3)' }}>
          <ModelStory />
        </div>

        <Fold title="İleri metrikler" hint="· doğrulama sınavı, kâr eşiği, ayrım gücü">
        <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          {[
            { k: 'Geçmiş sınav — yön doğruluğu', v: pct(info?.walkforward?.overall_accuracy),
              h: 'Walk-forward: modelin hiç görmediği geçmiş dönemlerde yönü bilme oranı' },
            { k: 'Geçmiş sınav — AL isabeti', v: pct(info?.walkforward?.buy_precision),
              h: 'AL dediğinde hedefe önce değme oranı (geçmiş sınavda)' },
            { k: 'Kâr eşiği', v: pct(info?.walkforward?.breakeven_precision),
              h: 'Bu oranın ÜSTÜ kârlı. Hedef stoptan büyük olduğu için %50 gerekmiyor' },
            { k: 'Ayrım gücü (AUC)', v: info?.walkforward?.auc != null ? fmt(info.walkforward.auc, 3) : '—',
              h: '0.50 = yazı-tura, 1.00 = kusursuz ayrım' },
            { k: 'Sınav örneklemi', v: (info?.walkforward?.n_predictions ?? info?.walkforward?.n_oos)?.toLocaleString('tr-TR') ?? '—',
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
      </>}

      {tab === 'kunye' && <>
        {/* Sürümler + geri alma: modelin nasıl yönetildiği */}
        <ModelVersions />

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
            const arr = info?.symbols?.[k]
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
      </>}
    </div>
  )
}
