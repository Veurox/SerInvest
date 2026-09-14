// =============================================================================
// Güvenilirlik eğrisi — "model %70 dediğinde gerçekten %70 mi çıkıyor?"
//
// Bu, Model sayfasının ANA GÖRSELİ. Modelin doğruluğunu değil DÜRÜSTLÜĞÜNÜ
// ölçer: yüksek doğruluklu ama güvenini abartan bir model, olasılıklarına
// göre pozisyon büyüklüğü hesaplayan bir sistemde para kaybettirir.
//
// Köşegen = kusursuz kalibrasyon. Nokta köşegenin ALTINDAysa model o aralıkta
// kendine fazla güveniyor; ÜSTÜNDEyse fazla mütevazı.
//
// BELİRSİZLİK ÇİZİLİR (docs/PLAN_ARAYUZ.md §4, kural 1)
// Her kovadaki gözlenen oran bir tahmindir ve az örneklemle gürültülüdür.
// Dikey çubuklar %95 binom güven aralığı: aralık köşegeni KESİYORSA o kova
// "sapma var" demeye yetmez. Çubuksuz çizilen bir nokta, olmayan bir
// kesinlik vaat ederdi.
//
// EKSEN 0-1 ARALIĞINDA, KIRPILMADAN. Tahminler 0,4-0,7 civarında kümeleniyor;
// eksen oraya yakınlaştırılsaydı küçük sapmalar dağ gibi görünürdü. Olasılık
// ekseninin tamamı gösteriliyor — sapma ne kadarsa o kadar görünüyor.
//
// VERİ YOKKEN GRAFİK ÇİZİLMEZ. Boş bir kutu yerine kaç tahmin biriktiği ve
// ne zaman okunabileceği yazıyor.
// =============================================================================

export interface Kova {
  /** Ham olasılık aralığı [alt, üst] */
  raw_p_range?: [number, number]
  /** Kovadaki tahmin sayısı */
  n: number
  /** Modelin (kalibre edilmiş) ortalama iddiası */
  predicted_cal_p: number
  /** Gerçekte kaçı yukarı gitti */
  observed_up: number
  gap?: number
}

/** %95 binom güven aralığı yarıçapı. */
function guvenAraligi(p: number, n: number): number {
  if (n <= 0) return 0
  return 1.96 * Math.sqrt(Math.max(p * (1 - p), 1e-9) / n)
}

export function ReliabilityCurve({
  kovalar, boyut = 300, ece, brier, nToplam, gunSayisi, bekleyen,
}: {
  kovalar: Kova[]
  boyut?: number
  ece?: number | null
  brier?: number | null
  nToplam?: number | null
  gunSayisi?: number | null
  /** Veri yokken gösterilecek açıklama (ör. "0/150 birikiyor"). */
  bekleyen?: string
}) {
  const kenar = 34
  const ic = boyut - kenar * 2
  const x = (p: number) => kenar + p * ic
  const y = (p: number) => kenar + (1 - p) * ic

  if (!kovalar || kovalar.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--u-s2)',
                    padding: 'var(--u-s5)', background: 'var(--u-panel)',
                    borderRadius: 'var(--u-r-md)', alignItems: 'flex-start' }}>
        <span className="u-label">Güvenilirlik eğrisi</span>
        <span className="u-sub" style={{ maxWidth: 460 }}>
          {bekleyen ?? 'Henüz değerlendirilmiş tahmin yok.'}
        </span>
        <span className="u-sub" style={{ color: 'var(--u-text-4)' }}>
          Bir tahmin ancak ufku dolduktan sonra yargılanabiliyor; bu yüzden
          eğri boş. Boş bir grafik çizmek "ölçtük ve sıfır çıktı" gibi
          okunurdu — ölçüm henüz yapılamadı.
        </span>
      </div>
    )
  }

  const enBuyukN = Math.max(...kovalar.map(k => k.n), 1)

  // YAYILIM — eğrinin söylemediği şeyi söyler.
  // Kalibrasyon "dürüst mü" sorusunu cevaplar, "bir şey biliyor mu" sorusunu
  // DEĞİL. Köşegen üstünde oturan ama %49-%54 arasına sıkışmış bir eğri
  // "dürüst ve neredeyse hep yazı tura diyor" demektir. Tam ölçekli eksende
  // bütün noktalar tek bir lekeye dönüşüp bu gerçeği gizliyordu; sayıyla
  // yazmak ekseni kırpmaktan (ve sapmayı abartmaktan) dürüst.
  const tahminler = kovalar.map(k => k.predicted_cal_p)
  const enAz = Math.min(...tahminler)
  const enCok = Math.max(...tahminler)
  const yayilimPuan = (enCok - enAz) * 100
  const DUSUK_AYRIM = 10        // puan

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--u-s2)' }}>
      <svg width={boyut} height={boyut} viewBox={`0 0 ${boyut} ${boyut}`}
           role="img"
           aria-label={`Güvenilirlik eğrisi: ${kovalar.length} kova, ` +
             kovalar.map(k => `model %${(k.predicted_cal_p * 100).toFixed(0)} dedi, ` +
               `gerçekleşen %${(k.observed_up * 100).toFixed(0)}`).join('; ')}
           style={{ display: 'block' }}>

        {/* Izgara */}
        <g stroke="var(--viz-grid)" strokeWidth={1}>
          {[0.25, 0.5, 0.75].map(v => (
            <g key={v}>
              <line x1={x(v)} y1={y(0)} x2={x(v)} y2={y(1)} />
              <line x1={x(0)} y1={y(v)} x2={x(1)} y2={y(v)} />
            </g>
          ))}
        </g>

        {/* Eksenler — 0'dan 1'e, kırpılmadan */}
        <g stroke="var(--viz-axis)" strokeWidth={1}>
          <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(0)} />
          <line x1={x(0)} y1={y(0)} x2={x(0)} y2={y(1)} />
        </g>

        {/* Köşegen: kusursuz kalibrasyon */}
        <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)}
              stroke="var(--viz-ref)" strokeWidth={1.25} strokeDasharray="4 4" />

        {/* Kovalar: güven aralığı + nokta */}
        {kovalar.map((k, i) => {
          const ci = guvenAraligi(k.observed_up, k.n)
          const alt = Math.max(0, k.observed_up - ci)
          const ust = Math.min(1, k.observed_up + ci)
          // Aralık köşegeni kesiyorsa bu kova "sapma var" demeye yetmez.
          const kesiyor = alt <= k.predicted_cal_p && k.predicted_cal_p <= ust
          const r = 3 + (k.n / enBuyukN) * 4
          return (
            <g key={i}>
              <line x1={x(k.predicted_cal_p)} y1={y(alt)}
                    x2={x(k.predicted_cal_p)} y2={y(ust)}
                    stroke={kesiyor ? 'var(--u-text-4)' : 'var(--u-warn)'}
                    strokeWidth={1.5} strokeLinecap="round" />
              <circle cx={x(k.predicted_cal_p)} cy={y(k.observed_up)} r={r}
                      fill={kesiyor ? 'var(--viz-1)' : 'var(--u-warn)'} />
            </g>
          )
        })}

        {/* Eksen etiketleri */}
        <text x={kenar + ic / 2} y={boyut - 8} textAnchor="middle"
              style={{ fontSize: 10, fill: 'var(--u-text-3)' }}>
          Model ne dedi
        </text>
        <text x={11} y={kenar + ic / 2} textAnchor="middle"
              transform={`rotate(-90 11 ${kenar + ic / 2})`}
              style={{ fontSize: 10, fill: 'var(--u-text-3)' }}>
          Gerçekte ne oldu
        </text>
        {[0, 0.5, 1].map(v => (
          <g key={v}>
            <text x={x(v)} y={y(0) + 13} textAnchor="middle"
                  style={{ fontSize: 9, fill: 'var(--u-text-4)',
                           fontFamily: 'var(--u-mono)' }}>
              %{v * 100}
            </text>
            <text x={x(0) - 6} y={y(v) + 3} textAnchor="end"
                  style={{ fontSize: 9, fill: 'var(--u-text-4)',
                           fontFamily: 'var(--u-mono)' }}>
              %{v * 100}
            </text>
          </g>
        ))}
      </svg>

      <div style={{ display: 'flex', gap: 'var(--u-s4)', flexWrap: 'wrap',
                    fontSize: 'var(--u-t-micro)', color: 'var(--u-text-3)' }}>
        {ece != null && <span>ECE <b className="u-num">{ece.toFixed(3)}</b></span>}
        {brier != null && <span>Brier <b className="u-num">{brier.toFixed(3)}</b></span>}
        {nToplam != null && <span><b className="u-num">{nToplam.toLocaleString('tr-TR')}</b> tahmin</span>}
        {gunSayisi != null && <span><b className="u-num">{gunSayisi}</b> gün</span>}
      </div>

      <span className="u-sub" style={{ maxWidth: 420 }}>
        Model olasılıkları{' '}
        <b className="u-num">%{(enAz * 100).toFixed(1)}</b>–
        <b className="u-num">%{(enCok * 100).toFixed(1)}</b> arasında
        {' '}(<b className="u-num">{yayilimPuan.toFixed(1)}</b> puanlık bant).
        {yayilimPuan < DUSUK_AYRIM && (
          <b style={{ color: 'var(--u-warn)' }}>
            {' '}Bu dar bir bant: model neredeyse hep “yazı tura” diyor.
            Eğri köşegen üstünde olsa bile bu, DÜRÜST ama AYRIMI ZAYIF
            demektir — kalibrasyon “bir şey biliyor mu” sorusunu cevaplamaz.
          </b>
        )}
      </span>
      <span className="u-sub" style={{ maxWidth: 420, color: 'var(--u-text-4)' }}>
        Kesikli köşegen kusursuz kalibrasyon. Dikey çubuk %95 güven aralığı —
        köşegeni kesiyorsa o kova sapma kanıtı sayılmaz. Nokta büyüklüğü
        kovadaki tahmin sayısı.
      </span>
    </div>
  )
}

export default ReliabilityCurve
