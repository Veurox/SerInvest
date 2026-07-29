// =============================================================================
// SerInvest — Modelin Hikâyesi (görsel anlatım)
// "Aktif model ne, hangi eğitimlerden geçti?" sorusunun grafikli cevabı:
//   1. Künye kartı        — ne tür model, neyle eğitildi
//   2. Triple-barrier SVG — modelin "başarı" tanımı tek bakışta
//   3. Eğitim yolculuğu   — veri → eğitim → sınav → kalibrasyon → canlı → terfi
//   4. Sınav grafiği      — 24 fold'un lift'i (tutarlılık/varyans görünür)
//   5. Kalibrasyon eğrisi — "model %X dedi, gerçekte %kaç çıktı"
// =============================================================================
import { useEffect, useState } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, LineChart, Line, Legend,
} from 'recharts'
import { ADMIN, adminFetch } from '../../lib/api'

interface Fold {
  fold: number; test: string; n_train: number; n_test: number
  acc: number; base_rate: number; buy_signals: number
  buy_precision: number | null; lift: number | null
}
interface Story {
  identity: {
    algorithm: string; n_trees: number; max_depth: number; learning_rate: number
    n_features: number; feature_kind: string; trained_at: string | null
    n_rows: number | null; date_min: string | null; date_max: string | null
    up_pct: number | null; horizon: number | null
    tp_atr_mult: number | null; sl_atr_mult: number | null
    buy_threshold: number | null; xsec_rank: boolean; history_period: string
  }
  exam: {
    completed_at: string | null; n_folds: number | null; n_oos: number | null
    auc: number | null; buy_precision: number | null; base_rate: number | null
    lift: number | null; mean_fold_lift: number | null
    breakeven_precision: number | null; expected_R_per_trade: number | null
    profitable: boolean | null; folds: Fold[]
  }
  calibration: {
    fitted_at: string | null; n_oos: number | null; method: string | null
    reliability: { raw_p_range: number[]; n: number; observed_up: number; calibrated_p: number }[]
  }
  promotions: {
    checked_at: string; decision: string; reason?: string
    windows_won?: number | null; windows_total?: number | null; pooled_precision?: number | null
  }[]
  error?: string
}

const trDate = (iso?: string | null) =>
  !iso ? '—' : new Date(iso.length <= 10 ? iso + 'T00:00:00' : iso)
    .toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })

/**
 * Pencere genişliğini izler. Grafik yükseklikleri buna bağlanır: 1920px'e yayılan
 * 190px'lik bir grafik aşırı basık görünür (07/2026 bulgusu — tasarım dar
 * viewport'ta doğrulanıp geniş ekranda bozuluyordu).
 */
function useViewportWidth(): number {
  const [w, setW] = useState(typeof window !== 'undefined' ? window.innerWidth : 1280)
  useEffect(() => {
    const onResize = () => setW(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return w
}

// ── Künye satırı ─────────────────────────────────────────────────────────────
function Spec({ k, v, hint }: { k: string; v: React.ReactNode; hint?: string }) {
  return (
    <div title={hint} style={{ padding: '7px 0', borderBottom: '1px solid var(--border-subtle)' }}>
      <div style={{ fontSize: 10.5, color: 'var(--text-muted)', letterSpacing: '.04em' }}>{k}</div>
      <div style={{ fontSize: 13.5, fontWeight: 700, marginTop: 1 }}>{v}</div>
    </div>
  )
}

// ── Triple-barrier şeması (SVG) ──────────────────────────────────────────────
// DİKKAT: SVG'yi width:100% ile bırakma — konteyner genişse viewBox ölçeklenir
// ve 9px yazılar ekranda 30px olur (07/2026 bulgusu). maxWidth ile sabitlenir.
function BarrierDiagram({ tp, sl, horizon }: { tp: number; sl: number; horizon: number }) {
  // viewBox ÖLÇEĞİ = okunabilirlik. Küçük viewBox + büyük maxWidth → yazılar şişer;
  // büyük viewBox + küçük maxWidth → yazılar okunmaz. 400×176 / 10-11px yazı,
  // maxWidth 440 ile ~1.1x ölçekte ekranda ~11-12px'e denk gelir.
  const W = 400, H = 176
  const x0 = 46, x1 = W - 96                  // fiyat yolu alanı (sağda etiket boşluğu)
  const tpY = 26, slY = H - 30
  const mid = tpY + (slY - tpY) * (sl / (tp + sl))   // giriş, TP:SL oranına göre

  return (
    <svg viewBox={`0 0 ${W} ${H}`}
         style={{ width: '100%', maxWidth: 440, height: 'auto', display: 'block' }}
         role="img" aria-label={`Triple-barrier: hedef +${tp}×ATR, stop −${sl}×ATR, ${horizon} gün süre`}>
      {/* Hedef bariyeri */}
      <line x1={x0} y1={tpY} x2={x1} y2={tpY} stroke="var(--profit)" strokeWidth="2" />
      <text x={x1 + 7} y={tpY + 4} fontSize="10.5" fontWeight="700" fill="var(--profit)">
        HEDEF
      </text>
      <text x={x1 + 7} y={tpY + 16} fontSize="9.5" fill="var(--profit)" opacity="0.85">
        +{tp}×ATR
      </text>

      {/* Stop bariyeri */}
      <line x1={x0} y1={slY} x2={x1} y2={slY} stroke="var(--loss)" strokeWidth="2" />
      <text x={x1 + 7} y={slY + 4} fontSize="10.5" fontWeight="700" fill="var(--loss)">
        STOP
      </text>
      <text x={x1 + 7} y={slY + 16} fontSize="9.5" fill="var(--loss)" opacity="0.85">
        −{sl}×ATR
      </text>

      {/* Süre bariyeri */}
      <line x1={x1} y1={tpY} x2={x1} y2={slY} stroke="var(--text-disabled)"
            strokeWidth="2" strokeDasharray="4 4" />
      <text x={x1 + 7} y={mid} fontSize="10" fontWeight="600" fill="var(--text-secondary)">
        {horizon} gün
      </text>
      <text x={x1 + 7} y={mid + 12} fontSize="9.5" fill="var(--text-muted)">süre dolar</text>

      {/* Giriş seviyesi */}
      <line x1={x0} y1={mid} x2={x1} y2={mid} stroke="var(--border-strong)"
            strokeWidth="1" strokeDasharray="3 4" />
      <text x={4} y={mid + 3.5} fontSize="10" fill="var(--text-secondary)">giriş</text>

      {/* Örnek fiyat yolu — hedefe değerek biter */}
      <path d={`M${x0} ${mid} L${x0 + 52} ${mid - 13} L${x0 + 96} ${mid + 10}
                L${x0 + 146} ${mid - 22} L${x0 + 198} ${tpY + 7} L${x0 + 230} ${tpY}`}
            fill="none" stroke="var(--info)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x0} cy={mid} r="3.75" fill="var(--info)" />
      <circle cx={x0 + 230} cy={tpY} r="4.5" fill="var(--profit)"
              stroke="var(--bg-surface)" strokeWidth="1.75" />
    </svg>
  )
}

export function ModelStory() {
  const [d, setD] = useState<Story | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const vw = useViewportWidth()
  const chartH = vw >= 1700 ? 280 : vw >= 1300 ? 235 : 195

  useEffect(() => {
    adminFetch(`${ADMIN}/model-story`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((j: Story) => j.error ? setErr(j.error) : setD(j))
      .catch(e => setErr(String(e)))
  }, [])

  if (err) return <div className="card" style={{ padding: 14, fontSize: 13, color: 'var(--text-muted)' }}>Model künyesi alınamadı: {err}</div>
  if (!d)  return <div className="card" style={{ padding: 14, fontSize: 13, color: 'var(--text-muted)' }}>Model künyesi yükleniyor…</div>

  const id = d.identity, ex = d.exam
  const folds = (ex.folds ?? []).map(f => ({
    ...f,
    liftPct: f.lift != null ? +(f.lift * 100).toFixed(2) : 0,
    label: `F${f.fold}`,
  }))
  const posFolds = folds.filter(f => f.liftPct > 0).length

  // Kalibrasyon eğrisi: ham p ortası → (model ne dedi, gerçekte ne çıktı)
  const calPts = (d.calibration.reliability ?? []).map(r => ({
    x: +(((r.raw_p_range[0] + r.raw_p_range[1]) / 2) * 100).toFixed(1),
    tahmin: +(r.calibrated_p * 100).toFixed(1),
    gercek: +(r.observed_up * 100).toFixed(1),
    n: r.n,
  }))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>

      {/* ── 1+2. KÜNYE + BARİYER ŞEMASI ──────────────────────────────────── */}
      <div className="card" style={{ padding: '14px 16px' }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase',
                      color: 'var(--text-muted)', marginBottom: 10 }}>
          Aktif modelin künyesi
        </div>
        {/* Geniş ekran disiplini (07/2026): şema SABİT sütunda (max 360px) durur,
            künye kalan alanı auto-fit ile DOLDURUR. Eskiden ikisi de 1fr'di →
            1920px'de şema 755px boşlukta yüzüyor, künye satırları yayılıyordu.
            alignItems:start — satırlar en uzun sütuna gerilmesin. */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(300px, 440px)',
                      gap: 24, alignItems: 'start' }}>
          {/* minmax(240px,·) → geniş ekranda 4 sütun × 2 satır. Daha dar minmax
              (145px) 8 alanı tek satıra diziyor, altında koca boşluk kalıyordu. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                        gap: '0 18px', alignContent: 'start' }}>
            <Spec k="ALGORİTMA" v="LightGBM" hint="Karar ağaçlarını sırayla ekleyerek öğrenen gradient boosting" />
            <Spec k="BÜYÜKLÜK" v={`${id.n_trees} ağaç · derinlik ${id.max_depth}`} />
            <Spec k="GÖSTERGE" v={`${id.n_features} teknik`} hint={id.feature_kind} />
            <Spec k="VERİ TÜRÜ" v="Saf teknik" hint="Haber/temel/makro bilinçli olarak dışarıda" />
            <Spec k="ÖĞRENDİĞİ ÖRNEK" v={(id.n_rows ?? 0).toLocaleString('tr-TR')} />
            <Spec k="VERİ ARALIĞI" v={`${(id.date_min ?? '').slice(0, 4)}–${(id.date_max ?? '').slice(0, 4)}`}
                  hint={`${id.date_min} → ${id.date_max}`} />
            <Spec k="EĞİTİM TARİHİ" v={trDate(id.trained_at)} />
            <Spec k="AL EŞİĞİ" v={`%${((id.buy_threshold ?? 0) * 100).toFixed(0)}`}
                  hint="Model bu olasılığın üstünde AL der" />
          </div>

          <div>
            <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginBottom: 4 }}>
              MODELİN “BAŞARI” TANIMI (triple-barrier)
            </div>
            <BarrierDiagram tp={id.tp_atr_mult ?? 3} sl={id.sl_atr_mult ?? 2} horizon={id.horizon ?? 10} />
            <div style={{ fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1.55, marginTop: 4 }}>
              Fiyat <b style={{ color: 'var(--profit)' }}>hedefe</b> önce değerse başarılı,{' '}
              <b style={{ color: 'var(--loss)' }}>stopa</b> önce değerse başarısız. Hiçbirine değmeden
              {' '}{id.horizon} gün dolarsa kararsız. Bariyerler hissenin kendi oynaklığına (ATR) göre ölçeklenir —
              sakin hissede dar, oynak hissede geniş.
            </div>
          </div>
        </div>
      </div>

      {/* ── 3. EĞİTİM YOLCULUĞU ──────────────────────────────────────────── */}
      <div className="card" style={{ padding: '14px 16px' }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase',
                      color: 'var(--text-muted)', marginBottom: 12 }}>
          Hangi aşamalardan geçti?
        </div>
        <div style={{ display: 'flex', gap: 0, flexWrap: 'wrap' }}>
          {[
            { n: 1, t: 'Veri toplandı', d: `${(id.n_rows ?? 0).toLocaleString('tr-TR')} örnek · ${id.history_period} geçmiş`, ok: true },
            { n: 2, t: 'Etiketlendi', d: `Triple-barrier · %${id.up_pct} yukarı çıktı`, ok: true },
            { n: 3, t: 'Eğitildi', d: `LightGBM ${id.n_trees} ağaç · ${trDate(id.trained_at)}`, ok: true },
            { n: 4, t: 'Sınava girdi', d: `${ex.n_folds} dönem · ${(ex.n_oos ?? 0).toLocaleString('tr-TR')} tahmin`, ok: true },
            { n: 5, t: 'Kalibre edildi', d: `${d.calibration.method ?? 'isotonic'} · ${(d.calibration.n_oos ?? 0).toLocaleString('tr-TR')} örnek`, ok: !!d.calibration.fitted_at },
            { n: 6, t: 'Canlıya alındı', d: 'Her 30 dk tarama · 19:00 değerlendirme', ok: true },
            { n: 7, t: 'Terfi denemesi', d: d.promotions.length
                ? `${d.promotions.length} deneme · ${d.promotions.filter(p => p.decision === 'promoted').length} terfi`
                : 'henüz yok', ok: d.promotions.length > 0, muted: true },
          ].map((s, i, arr) => (
            <div key={s.n} style={{ flex: '1 1 130px', minWidth: 125, position: 'relative', paddingRight: 10 }}>
              {i < arr.length - 1 && (
                <div style={{ position: 'absolute', top: 11, left: 26, right: 4, height: 2,
                              background: 'var(--border-default)' }} />
              )}
              <div style={{
                width: 23, height: 23, borderRadius: '50%', display: 'grid', placeItems: 'center',
                fontSize: 11, fontWeight: 800, position: 'relative', zIndex: 1,
                background: s.ok ? 'var(--profit-bg)' : 'var(--bg-surface-3)',
                border: `2px solid ${s.ok ? 'var(--profit)' : 'var(--border-strong)'}`,
                color: s.ok ? 'var(--profit)' : 'var(--text-muted)',
              }}>{s.ok ? '✓' : s.n}</div>
              <div style={{ fontSize: 12, fontWeight: 700, marginTop: 6 }}>{s.t}</div>
              <div style={{ fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1.45 }}>{s.d}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── 4. SINAV GRAFİĞİ ─────────────────────────────────────────────── */}
      <div className="card" style={{ padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
            Geçmiş sınav — {ex.n_folds} dönem
          </span>
          <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
            {posFolds}/{folds.length} dönemde tabanı geçti · ortalama{' '}
            <b style={{ color: (ex.mean_fold_lift ?? 0) > 0 ? 'var(--profit)' : 'var(--loss)' }}>
              {((ex.mean_fold_lift ?? 0) * 100).toFixed(1)} puan
            </b>
          </span>
        </div>
        <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginBottom: 8, lineHeight: 1.5 }}>
          Her çubuk bir dönem: modelin AL isabeti ile “hepsini alsaydık” tabanı arasındaki <b>fark</b>.
          Sıfırın üstü = model değer katmış. Çubukların savrulması, tek dönemin şansa bağlı olduğunu gösterir.
        </div>
        <ResponsiveContainer width="100%" height={chartH}>
          <BarChart data={folds} margin={{ top: 6, right: 6, bottom: 4, left: -18 }}>
            <CartesianGrid stroke="var(--border-subtle)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'var(--text-muted)' }}
                   axisLine={{ stroke: 'var(--border-default)' }} tickLine={false} interval={1} />
            <YAxis tick={{ fontSize: 9.5, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false}
                   tickFormatter={(v: number) => `${v}p`} />
            <Tooltip
              cursor={{ fill: 'var(--bg-glass)' }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const f = payload[0].payload as typeof folds[number]
                return (
                  <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
                                borderRadius: 4, padding: '7px 10px', fontSize: 11.5 }}>
                    <div style={{ fontWeight: 700 }}>Dönem {f.fold}</div>
                    <div style={{ color: 'var(--text-muted)', fontSize: 10.5 }}>{f.test}</div>
                    <div style={{ marginTop: 3 }}>
                      AL isabeti <b>{f.buy_precision != null ? `%${(f.buy_precision * 100).toFixed(0)}` : '—'}</b>
                      {' '}· taban <b>%{(f.base_rate * 100).toFixed(0)}</b>
                    </div>
                    <div style={{ color: f.liftPct >= 0 ? 'var(--profit)' : 'var(--loss)', fontWeight: 700 }}>
                      fark {f.liftPct >= 0 ? '+' : ''}{f.liftPct} puan
                    </div>
                    <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>{f.buy_signals} AL sinyali</div>
                  </div>
                )
              }} />
            <ReferenceLine y={0} stroke="var(--border-strong)" strokeWidth={1.5} />
            <Bar dataKey="liftPct" radius={[3, 3, 0, 0]} isAnimationActive={false}>
              {folds.map((f, i) => (
                <Cell key={i} fill={f.liftPct >= 0 ? 'var(--profit)' : 'var(--loss)'} opacity={0.85} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* ── 5. KALİBRASYON EĞRİSİ ────────────────────────────────────────── */}
      {calPts.length > 0 && (
        <div className="card" style={{ padding: '14px 16px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase',
                        color: 'var(--text-muted)', marginBottom: 4 }}>
            Kalibrasyon — model ne kadar dürüst?
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginBottom: 8, lineHeight: 1.5 }}>
            Yatay eksen modelin <b>ham</b> skoru. <b style={{ color: 'var(--info)' }}>Mavi</b> = modelin
            düzeltilmiş tahmini, <b style={{ color: 'var(--accent)' }}>turuncu</b> = gerçekte ne çıktığı.
            Mavi çizginin <b>düz</b> olması kritik: model ham 0.60 ile 0.90 arasında fark üretemiyor,
            bu yüzden hepsine aynı olasılığı veriyor — sıralama yapamamasının sebebi bu.
          </div>
          <ResponsiveContainer width="100%" height={chartH - 20}>
            <LineChart data={calPts} margin={{ top: 6, right: 10, bottom: 4, left: -20 }}>
              <CartesianGrid stroke="var(--border-subtle)" />
              <XAxis dataKey="x" tick={{ fontSize: 9.5, fill: 'var(--text-muted)' }}
                     tickFormatter={(v: number) => `%${v}`} axisLine={{ stroke: 'var(--border-default)' }} tickLine={false} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 9.5, fill: 'var(--text-muted)' }}
                     tickFormatter={(v: number) => `%${v}`} axisLine={false} tickLine={false} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null
                  const p = payload[0].payload as typeof calPts[number]
                  return (
                    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
                                  borderRadius: 4, padding: '7px 10px', fontSize: 11.5 }}>
                      <div style={{ color: 'var(--text-muted)', fontSize: 10.5 }}>ham skor ≈ %{label}</div>
                      <div style={{ color: 'var(--info)' }}>model dedi: <b>%{p.tahmin}</b></div>
                      <div style={{ color: 'var(--accent)' }}>gerçekte: <b>%{p.gercek}</b></div>
                      <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>{p.n} örnek</div>
                    </div>
                  )
                }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="tahmin" name="Model tahmini" stroke="var(--info)"
                    strokeWidth={2.5} dot={{ r: 3 }} isAnimationActive={false} />
              <Line type="monotone" dataKey="gercek" name="Gerçekleşen" stroke="var(--accent)"
                    strokeWidth={2.5} dot={{ r: 3 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── 6. TERFİ GEÇMİŞİ ─────────────────────────────────────────────── */}
      {d.promotions.length > 0 && (
        <div className="card" style={{ padding: '14px 16px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase',
                        color: 'var(--text-muted)', marginBottom: 8 }}>
            Terfi denemeleri — rakip modeller
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {[...d.promotions].reverse().map((p, i) => {
              const won = p.decision === 'promoted'
              return (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 10, fontSize: 12,
                  padding: '7px 10px', borderRadius: 4,
                  background: won ? 'var(--profit-bg)' : 'var(--bg-surface-2)',
                  border: `1px solid ${won ? 'var(--profit-border)' : 'var(--border-subtle)'}`,
                }}>
                  <span style={{ fontWeight: 800, color: won ? 'var(--profit)' : 'var(--text-muted)' }}>
                    {won ? '↑ TERFİ' : '✕ RET'}
                  </span>
                  <span style={{ color: 'var(--text-muted)' }}>{trDate(p.checked_at)}</span>
                  <span style={{ marginLeft: 'auto', color: 'var(--text-secondary)', fontSize: 11.5 }}>
                    {p.windows_total != null
                      ? <>Rakip {p.windows_won}/{p.windows_total} dönemde kazandı</>
                      : p.reason ?? ''}
                    {p.pooled_precision != null && <> · isabet %{(p.pooled_precision * 100).toFixed(0)}</>}
                  </span>
                </div>
              )
            })}
          </div>
          <div style={{ marginTop: 8, fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Model kendi kendine değişmez. Her Pazar 20:00'de bir <b>rakip</b> eğitilir; ancak son 3 bağımsız
            dönemin <b>çoğunda</b> şampiyonu geçerse yerine geçer. Geçemezse mevcut model korunur.
          </div>
        </div>
      )}
    </div>
  )
}
