// =============================================================================
// SerInvest — Fon Tarayıcı (TEFAS)
// docs/PLAN_TEFAS.md Faz 2. Tarayıcı sayfasının "Fonlar" görünümü.
//
// Ayrı SAYFA değil ayrı BİLEŞEN: Faz F'de üç tarama sayfasını tek tabloda
// birleştirmiştik, o karar bozulmuyor. Ama fon satırı hisse satırından
// tamamen farklı bir şey (fiyat/sinyal/AI kararı yok; akran sırası, eşik
// farkı, fon büyüklüğü var) — iki satır türünü tek kolon sisteminden
// geçirmek her iki tarafı da bulandırırdı.
//
// HESAP BURADA DEĞİL: getiri, akran sırası, oynaklık, eşik farkı hepsi
// tefas-service'te hesaplanıyor. İki sebep: noktasal-zamanlılık deponun
// yanında durmalı ve tarayıcıya 100 bin satır göndermenin anlamı yok.
// Burası yalnız gösteriyor.
// =============================================================================
import { useEffect, useMemo, useState } from 'react'
import { DataTable, type Column, EmptyState, Icon } from '../ui'
import { FonDetay } from './FonDetay'
import { API } from '../../lib/api'
import { downloadCsv, fmt, yuzde, oranYuzde } from '../../lib/format'

type Donem = '1a' | '3a' | '1y'

const DONEM_ETIKET: Record<Donem, string> = {
  '1a': '1 Ay', '3a': '3 Ay', '1y': '1 Yıl',
}

interface Fon {
  kod: string
  unvan: string
  kategori: string
  kategori_kod: string
  son_gun: string
  ilk_gun: string
  fiyat: number
  gozlem: number
  bayat: boolean
  bayat_gun: number
  buyukluk: number | null
  kisi_sayisi: number | null
  oynaklik: number | null
  max_dusus: number | null
  getiri_1a: number | null; gun_1a: number | null
  getiri_3a: number | null; gun_3a: number | null
  getiri_1y: number | null; gun_1y: number | null
  akran_1a: number | null; akran_n_1a: number
  akran_3a: number | null; akran_n_3a: number
  akran_1y: number | null; akran_n_1y: number
  esik_farki_1a: number | null
  esik_farki_3a: number | null
  esik_farki_1y: number | null
  /** (getiri − eşik) / oynaklık. YALNIZ 1 yıl için — bkz. tefas_metrik.py. */
  risk_duzeltilmis_1y: number | null
}

interface Tarama {
  referans: string | null
  adet: number
  fonlar: Fon[]
  esik: Record<Donem, number | null>
  esik_kategori: string
  uyari?: string
  not?: string
}

const buyuklukYaz = (v: number | null): string => {
  if (v == null) return '—'
  if (v >= 1e9) return `${(v / 1e9).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} Mr`
  if (v >= 1e6) return `${(v / 1e6).toLocaleString('tr-TR', { maximumFractionDigits: 0 })} Mn`
  return v.toLocaleString('tr-TR', { maximumFractionDigits: 0 })
}

const sayiYaz = (v: number | null): string =>
  v == null ? '—' : Math.round(v).toLocaleString('tr-TR')

/** Getiri/eşik farkı hücresi — işaretine göre renklenir. */
function Oran({ v, d = 1 }: { v: number | null; d?: number }) {
  if (v == null) return <span style={{ color: 'var(--text-disabled)' }}>—</span>
  return (
    <span className={v > 0 ? 'dir-up' : v < 0 ? 'dir-down' : undefined}>
      {oranYuzde(v, d)}
    </span>
  )
}

export function FundScreener({ q }: { q: string }) {
  /** Açık fon detayı. Hisse tablosunda satır grafik açıyor; burada ölü uçtu. */
  const [secili, setSecili] = useState<string | null>(null)
  const [data, setData] = useState<Tarama | null>(null)
  const [hata, setHata] = useState<string | null>(null)
  const [yukleniyor, setYukleniyor] = useState(true)
  const [donem, setDonem] = useState<Donem>('1y')
  const [kategori, setKategori] = useState<string>('')
  // Geçmişi kısa fonlar seçili dönemde hesaplanamıyor; varsayılan olarak
  // gizleniyorlar. "Hesaplanamadı" satırları tabloyu doldurup asıl
  // karşılaştırmayı zorlaştırıyor — ama gizlendikleri yazılı, sessizce
  // düşürülmüyorlar.
  const [eksikGoster, setEksikGoster] = useState(false)

  useEffect(() => {
    // Tek seferlik yükleme: başlangıç durumu zaten "yükleniyor, hata yok".
    let iptal = false
    fetch(`${API}/fon/tarama`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(d => { if (!iptal) { setData(d); setYukleniyor(false) } })
      .catch(e => { if (!iptal) { setHata(String(e.message ?? e)); setYukleniyor(false) } })
    return () => { iptal = true }
  }, [])

  const kategoriler = useMemo(() => {
    const m = new Map<string, string>()
    for (const f of data?.fonlar ?? []) m.set(f.kategori_kod, f.kategori)
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'tr'))
  }, [data])

  const rows = useMemo(() => {
    const needle = q.trim().toLocaleUpperCase('tr-TR')
    return (data?.fonlar ?? [])
      .filter(f => !kategori || f.kategori_kod === kategori)
      .filter(f => !needle
        || f.kod.toLocaleUpperCase('tr-TR').includes(needle)
        || f.unvan.toLocaleUpperCase('tr-TR').includes(needle))
      .filter(f => eksikGoster || f[`getiri_${donem}`] != null)
  }, [data, q, kategori, donem, eksikGoster])

  const eksikSayisi = useMemo(
    () => (data?.fonlar ?? []).filter(f => f[`getiri_${donem}`] == null).length,
    [data, donem])

  const columns = useMemo<Column<Fon>[]>(() => [
    {
      key: 'kod', header: 'Fon', width: 210,
      sortValue: f => f.kod,
      render: f => (
        <span>
          <b style={{ color: 'var(--text-primary)' }}>{f.kod}</b>
          {f.bayat && (
            <span title={`Son veri ${f.bayat_gun} gün önce — fon kapanmış ya da birleşmiş olabilir`}
                  style={{ marginLeft: 5, fontSize: 'var(--text-2xs)', fontWeight: 700,
                           color: 'var(--warning)' }}>bayat</span>
          )}
          <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-2xs)', marginLeft: 6 }}>
            {f.unvan.replace(/\s*\(.*$/, '')}
          </span>
        </span>
      ),
    },
    { key: 'kategori', header: 'Kategori', width: 120, priority: 2,
      sortValue: f => f.kategori, render: f => f.kategori },
    {
      key: 'getiri', header: `Getiri ${DONEM_ETIKET[donem]}`, numeric: true, width: 96,
      title: 'Seçili dönemin getirisi. Hücre boşsa fonun o kadar geçmişi yok.',
      sortValue: f => f[`getiri_${donem}`],
      render: f => <Oran v={f[`getiri_${donem}`]} />,
    },
    {
      key: 'akran', header: 'Akran sırası', numeric: true, width: 104,
      title: 'Kendi kategorisi içindeki yüzdelik dilim (100 = en iyi)',
      sortValue: f => f[`akran_${donem}`],
      render: f => {
        const v = f[`akran_${donem}`]
        if (v == null) return <span style={{ color: 'var(--text-disabled)' }}>—</span>
        const n = f[`akran_n_${donem}`]
        return (
          <span title={`${n} fon içinde`}
                style={{ fontWeight: 700,
                         color: v >= 75 ? 'var(--profit)' : v <= 25 ? 'var(--loss)' : 'var(--text-secondary)' }}>
            {yuzde(v, 0)}
          </span>
        )
      },
    },
    {
      key: 'esik', header: 'Eşik farkı', numeric: true, width: 96,
      title: 'Para piyasası fonlarının medyan getirisine göre fazla/eksik getiri. '
           + 'Negatifse "para piyasasında dursaydım daha iyiydi" demektir.',
      sortValue: f => f[`esik_farki_${donem}`],
      render: f => <Oran v={f[`esik_farki_${donem}`]} />,
    },
    {
      // Dönem seçiciden BAĞIMSIZ olarak hep 1 yıl: oynaklık yıllıklaştırılmış,
      // onu 1 aylık bir fazla getiriye bölmek farklı birimleri bölmek olurdu.
      // Dönem başlıkta yazılı (PLAN_ARAYUZ.md §4: dönem her grafikte yazılı).
      key: 'riskduz', header: 'Risk-düz. 1Y', numeric: true, width: 104,
      title: 'Para piyasası eşiğinin üstündeki getirinin, o getiriyi kazanırken '
           + 'yaşanan oynaklığa bölümü. "Aynı fazla getiriyi daha az sarsılarak '
           + 'kazanan hangisi" sorusunun cevabı. Yalnız 1 yıllık dönem için '
           + 'hesaplanır; kısa dönemlerde oynaklıkla birimi uyuşmaz.',
      sortValue: f => f.risk_duzeltilmis_1y,
      render: f => {
        const v = f.risk_duzeltilmis_1y
        if (v == null) return <span style={{ color: 'var(--text-disabled)' }}>—</span>
        return (
          <span className={v > 0 ? 'dir-up' : v < 0 ? 'dir-down' : undefined}
                style={{ fontWeight: 700 }}>
            {fmt(v)}
          </span>
        )
      },
    },
    {
      key: 'oynaklik', header: 'Oynaklık', numeric: true, width: 86, priority: 2,
      title: 'Yıllıklaştırılmış dalgalanma (son 1 yıl). Yüksek = fiyat çok zıplıyor.',
      sortValue: f => f.oynaklik,
      render: f => oranYuzde(f.oynaklik, 1),
    },
    {
      key: 'dusus', header: 'Maks. düşüş', numeric: true, width: 96, priority: 2,
      title: 'Son 1 yılda zirveden dibe en büyük kayıp. "En kötü ne oldu" sorusunun cevabı.',
      sortValue: f => f.max_dusus,
      render: f => f.max_dusus == null ? '—'
        : <span className="dir-down">{oranYuzde(f.max_dusus, 1)}</span>,
    },
    { key: 'buyukluk', header: 'Büyüklük', numeric: true, width: 92, priority: 3,
      title: 'Fonun toplam portföy büyüklüğü (TL)',
      sortValue: f => f.buyukluk, render: f => buyuklukYaz(f.buyukluk) },
    { key: 'kisi', header: 'Yatırımcı', numeric: true, width: 88, priority: 3,
      title: 'Fondaki yatırımcı sayısı — para akışının göstergesi',
      sortValue: f => f.kisi_sayisi, render: f => sayiYaz(f.kisi_sayisi) },
    { key: 'fiyat', header: 'Birim pay', numeric: true, width: 92, priority: 3,
      sortValue: f => f.fiyat, render: f => f.fiyat.toLocaleString('tr-TR', { maximumFractionDigits: 6 }) },
  ], [donem])

  const csvIndir = () => {
    downloadCsv(
      ['Fon', 'Unvan', 'Kategori', `Getiri ${DONEM_ETIKET[donem]}`, 'Gün',
       'Akran %', 'Akran sayısı', 'Eşik farkı', 'Risk-düz. 1Y', 'Oynaklık',
       'Maks düşüş', 'Büyüklük', 'Yatırımcı', 'Birim pay', 'Son veri'],
      rows.map(f => [
        f.kod, f.unvan, f.kategori, f[`getiri_${donem}`], f[`gun_${donem}`],
        f[`akran_${donem}`], f[`akran_n_${donem}`], f[`esik_farki_${donem}`],
        f.risk_duzeltilmis_1y, f.oynaklik, f.max_dusus, f.buyukluk,
        f.kisi_sayisi, f.fiyat, f.son_gun,
      ]),
      `fonlar-${donem}-${data?.referans ?? 'bugun'}.csv`,
    )
  }

  if (yukleniyor) {
    return <div style={{ padding: 'var(--space-6)', color: 'var(--text-muted)', fontSize: 12 }}>
      Fon tablosu hesaplanıyor…
    </div>
  }
  if (hata) {
    return <EmptyState icon={<Icon name="alert" size={22} />} title="Fon verisi alınamadı"
      message={`TEFAS servisine ulaşılamadı (${hata}). Servis kapalı olabilir.`} />
  }
  if (!data || data.adet === 0) {
    return <EmptyState icon={<Icon name="target" size={22} />} title="Fon verisi yok"
      message={data?.not ?? 'İlk çekim henüz yapılmadı.'} />
  }

  const esik = data.esik[donem]

  return (
    <div>
      {/* Denetimler */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
                    marginBottom: 'var(--space-3)' }}>
        <span className="mc-bar__label">Dönem</span>
        <span className="mc-seg" role="group" aria-label="Getiri dönemi">
          {(['1a', '3a', '1y'] as Donem[]).map(d => (
            <button key={d} aria-pressed={donem === d} onClick={() => setDonem(d)}>
              {DONEM_ETIKET[d]}
            </button>
          ))}
        </span>

        <select value={kategori} onChange={e => setKategori(e.target.value)}
                style={{ padding: '4px 8px', fontSize: 12, color: 'var(--text-primary)',
                         background: 'var(--bg-surface)', border: '1px solid var(--border-default)' }}>
          <option value="">Tüm kategoriler</option>
          {kategoriler.map(([kod, ad]) => <option key={kod} value={kod}>{ad}</option>)}
        </select>

        {eksikSayisi > 0 && (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5,
                          fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer' }}>
            <input type="checkbox" checked={eksikGoster}
                   onChange={e => setEksikGoster(e.target.checked)} />
            {eksikSayisi} fonun {DONEM_ETIKET[donem].toLocaleLowerCase('tr-TR')} geçmişi yok — onları da göster
          </label>
        )}

        <button onClick={csvIndir} className="scr-btn" title={`${rows.length} satır`}>CSV</button>
      </div>

      {/* Eşik — tablonun anlamını veren tek sayı */}
      <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap',
                    alignItems: 'baseline', padding: 'var(--space-2) var(--space-3)',
                    marginBottom: 'var(--space-2)', fontSize: 11.5,
                    background: 'var(--bg-surface)', border: '1px solid var(--border-default)' }}>
        <span style={{ color: 'var(--text-muted)' }}>
          Kıyas eşiği ({DONEM_ETIKET[donem]}) — para piyasası fonlarının medyanı:
        </span>
        <b style={{ color: 'var(--accent)' }}>{oranYuzde(esik)}</b>
        <span style={{ color: 'var(--text-muted)' }}>
          “Eşik farkı” kolonu her fonun buna göre ne kadar fazla/eksik kazandırdığını gösterir.
          Negatif değer, para piyasası fonunda durmanın daha iyi olacağı anlamına gelir.
        </span>
      </div>

      {/* Hayatta kalma yanlılığı — arka uçtan geliyor ki ekran unutamasın */}
      {data.uyari && (
        <div style={{ padding: 'var(--space-2) var(--space-3)', marginBottom: 'var(--space-2)',
                      fontSize: 11, lineHeight: 1.5, color: 'var(--warning)',
                      background: 'var(--bg-surface)',
                      borderLeft: '2px solid var(--warning)' }}>
          {data.uyari}
        </div>
      )}

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={f => f.kod}
        defaultSort={{ key: 'getiri', dir: 'desc' }}
        maxHeight={secili ? 'calc(100vh - 720px)' : 'calc(100vh - 400px)'}
        empty="Bu süzgeçte fon yok."
        onRowClick={f => setSecili(k => (k === f.kod ? null : f.kod))}
        activeKey={secili}
      />

      {secili && <FonDetay kod={secili} onKapat={() => setSecili(null)} />}

      <div style={{ marginTop: 'var(--space-2)', fontSize: 10.5, color: 'var(--text-muted)' }}>
        {data.referans} tarihli veriyle · {rows.length}/{data.adet} fon gösteriliyor ·
        {' '}getiri dönemi {DONEM_ETIKET[donem]} · akran sırası kategori içinde
      </div>
    </div>
  )
}

export default FundScreener
