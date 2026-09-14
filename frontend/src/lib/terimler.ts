// =============================================================================
// SerInvest — Terim Sözlüğü
//
// Ekrandaki kısaltmaların (RSI, MACD, EMA, BB, F/K, PD/DD…) FİNANS BİLMEYEN
// birine anlatımı. Tek kaynak: aynı terim üç ayrı yerde üç ayrı şekilde
// anlatılmasın.
//
// Yazım kuralları — bunlar üslup tercihi değil, projenin ölçüm disiplininin
// metne yansıması:
//   • Jargonu jargonla açıklama. "Aşırı alım bölgesi" bir şey anlatmaz.
//   • "Al" / "sat" deme. Göstergeler tarif eder, karar vermez.
//   • Gösterge yanıltıyorsa BUNU YAZ. `uyari` alanı tam bunun için var —
//     "RSI 70 üstü = sat" gibi yaygın ama yanlış ezberler burada kırılıyor.
//
// Kullanım: <TerimTip ad="RSI (14)" /> — eşleşme etiket METNİYLE yapılır,
// böylece çağıran tarafta ayrıca anahtar taşımak gerekmiyor.
// =============================================================================

export interface Terim {
  /** İpucu başlığı — açık yazılmış hâli */
  baslik: string
  /** "Bu nedir?" — tek cümle, jargonsuz */
  ozet: string
  /** "Ekranda ne görüyorum?" */
  nasil: string
  /** Yaygın yanlış anlamaya karşı dürüst uyarı (varsa) */
  uyari?: string
}

export const TERIMLER: Record<string, Terim> = {
  // ── Fiyat / seans ──────────────────────────────────────────────────────────
  acilis: {
    baslik: 'Açılış',
    ozet: 'Seansın ilk işlem fiyatı.',
    nasil: 'Günün kapanışı açılışın üstündeyse gün yükselişle geçmiş demektir.',
  },
  gunYuksek: {
    baslik: 'Gün Yükseği',
    ozet: 'Bugün görülen en yüksek fiyat.',
    nasil: 'Kapanış bu değere yakınsa gün güçlü kapanmış sayılır.',
  },
  gunDusuk: {
    baslik: 'Gün Düşüğü',
    ozet: 'Bugün görülen en düşük fiyat.',
    nasil: 'Yüksek ile düşük arasındaki mesafe, günün ne kadar oynak geçtiğini gösterir.',
  },
  gunYuksekDusuk: {
    baslik: 'G/Y — Gün Yükseği / Düşüğü',
    ozet: 'Bugün görülen en yüksek ve en düşük fiyat.',
    nasil: 'Aradaki mesafe ne kadar büyükse gün o kadar oynak geçmiş demektir.',
  },
  hacim: {
    baslik: 'Hacim',
    ozet: 'O gün el değiştiren pay adedi (M = milyon).',
    nasil: 'Bir fiyat hareketi yüksek hacimle olduysa arkasında kalabalık var demektir.',
    uyari: 'Düşük hacimli sert hareketler yanıltıcı olabilir — az sayıda işlem fiyatı kolayca oynatır.',
  },
  gunYonu: {
    baslik: 'Gün Yönü',
    ozet: 'Bugünkü fiyatın, günün açılışına göre yukarıda mı aşağıda mı olduğu.',
    nasil: 'Tek günlük bir fotoğraf; eğilim hakkında pek bir şey söylemez.',
  },

  // ── Momentum ───────────────────────────────────────────────────────────────
  rsi: {
    baslik: 'RSI (14) — Göreli Güç Endeksi',
    ozet: 'Fiyatın son 14 günde ne kadar hızlı yükselip düştüğünü 0 ile 100 arasında tek bir sayıya indirir. Bir tür "hız göstergesi".',
    nasil: '70 üstü: son dönemde hızlı yükselmiş. 30 altı: hızlı düşmüş. 50 civarı: kararsız.',
    uyari: 'Yüksek RSI "sat", düşük RSI "al" demek DEĞİLDİR. Güçlü bir yükselişte RSI haftalarca 70 üstünde kalabilir — erken satan yükselişi kaçırır.',
  },
  macd: {
    baslik: 'MACD',
    ozet: 'Fiyatın kısa vadeli ortalaması ile uzun vadeli ortalaması arasındaki fark. Yönün hızlanıp hızlanmadığını gösterir.',
    nasil: 'Sinyal çizgisinin üstündeyse yukarı ivme, altındaysa aşağı ivme diye okunur.',
    uyari: 'Sayının kendisi tek başına bir şey ifade etmez — hep Sinyal çizgisine göre bakılır.',
  },
  macdSinyal: {
    baslik: 'MACD Sinyal',
    ozet: 'MACD çizgisinin yumuşatılmış hâli. Tek işi MACD ile karşılaştırılmak.',
    nasil: 'MACD bunun üstüne çıkarsa "ivme yukarı döndü", altına inerse "aşağı döndü" denir.',
  },
  macdHist: {
    baslik: 'MACD Histogram',
    ozet: 'MACD ile Sinyal çizgisi arasındaki farkın kendisi.',
    nasil: 'Artı ve büyüyorsa yukarı ivme güçleniyor; artı ama küçülüyorsa güç kaybediyor. Eksi tarafta tersi geçerli.',
  },

  // ── Bollinger Bantları ─────────────────────────────────────────────────────
  bollinger: {
    baslik: 'Bollinger Bantları',
    ozet: 'Fiyatın, son 20 günün alışılmış aralığının neresinde olduğunu gösterir.',
    nasil: 'Alt banda yakınsa "alışılmadık derecede aşağıda", üst banda yakınsa "alışılmadık derecede yukarıda" sayılır.',
    uyari: 'Banda değmek al/sat sinyali değildir. Oynaklık arttıkça bantlar genişler; fiyat bantla birlikte yürüyebilir.',
  },
  bbUst: {
    baslik: 'BB Üst — Bollinger Üst Bandı',
    ozet: 'Fiyatın son 20 günde alışılmış en üst sınırı (ortalamanın iki standart sapma üstü).',
    nasil: 'Fiyat genelde üst ve alt bandın arasında dolaşır. Üst banda yaklaşmak "ortalamadan çok yukarı sapmış" demektir.',
    uyari: 'Üst banda değmek "sat" sinyali DEĞİLDİR — güçlü bir yükselişte fiyat günlerce üst banda yapışık gidebilir.',
  },
  bbOrta: {
    baslik: 'BB Orta — Bollinger Orta Bandı',
    ozet: 'Son 20 günün ortalama fiyatı. Üst ve alt bantlar buradan hesaplanır.',
    nasil: 'Fiyat bunun üstündeyse son bir ayın ortalamasından pahalı, altındaysa ucuz işlem görüyor demektir.',
  },
  bbAlt: {
    baslik: 'BB Alt — Bollinger Alt Bandı',
    ozet: 'Fiyatın son 20 günde alışılmış en alt sınırı (ortalamanın iki standart sapma altı).',
    nasil: 'Alt banda yaklaşmak "ortalamadan çok aşağı sapmış" demektir.',
    uyari: 'Alt banda değmek "al" sinyali DEĞİLDİR — düşüş sürüyorsa fiyat bandı da aşağı çeker.',
  },

  // ── Hareketli ortalamalar ──────────────────────────────────────────────────
  ema: {
    baslik: 'EMA — Üssel Hareketli Ortalama',
    ozet: 'Belirli sayıda günün ortalama fiyatı. Yakın günlere daha fazla ağırlık verdiği için düz ortalamadan çabuk tepki verir.',
    nasil: 'Fiyat çizginin üstündeyse o vadede yön yukarı kabul edilir.',
  },
  ema9: {
    baslik: 'EMA 9',
    ozet: 'Son 9 işlem gününün (yaklaşık 2 hafta) ağırlıklı ortalama fiyatı — en hızlı tepki veren çizgi.',
    nasil: 'Fiyat bunun üstündeyse çok kısa vadede yön yukarı.',
    uyari: 'Hızlı olduğu için çok sık yön değiştirir; tek başına gürültüdür.',
  },
  ema20: {
    baslik: 'EMA 20',
    ozet: 'Son 20 işlem gününün (yaklaşık 1 ay) ağırlıklı ortalama fiyatı.',
    nasil: 'Fiyat bunun üstündeyse kısa vadede yön yukarı kabul edilir.',
  },
  ema50: {
    baslik: 'EMA 50',
    ozet: 'Son 50 işlem gününün (yaklaşık 2,5 ay) ağırlıklı ortalama fiyatı — orta vade.',
    nasil: 'Fiyat bunun üstündeyse orta vadede yön yukarı kabul edilir.',
  },
  ema200: {
    baslik: 'EMA 200',
    ozet: 'Son 200 işlem gününün (yaklaşık 10 ay) ağırlıklı ortalama fiyatı — uzun vadeli ana eğilim.',
    nasil: 'Fiyatın bu çizginin üstünde olması "ana eğilim yukarı" diye yorumlanır; altı için tersi.',
    uyari: 'Çok sayıda yatırımcı buna baktığı için fiyat sık sık bu çizgi civarında tepki verir. Bu bir doğa kanunu değil, ortak alışkanlık.',
  },
  emaKesisim: {
    baslik: 'EMA 20/50 Kesişimi',
    ozet: 'Kısa vadeli ortalamanın (20 gün), orta vadeli ortalamanın (50 gün) üstünde mi altında mı olduğu.',
    nasil: 'Üstündeyse son bir ay, son iki buçuk aydan güçlü gidiyor demektir.',
  },

  // ── Özet göstergeler ───────────────────────────────────────────────────────
  sinyal: {
    baslik: 'Sinyal',
    ozet: 'Yukarıdaki teknik göstergelerin mekanik özeti: AL / SAT / NÖTR.',
    nasil: 'Göstergelerin çoğu aynı yöne bakıyorsa o yön yazılır.',
    uyari: 'Bu bir tavsiye değil, sabit kuralların toplamı. Modelin kendi kararı ayrı bir alanda (AI Kararı) durur.',
  },
  sinyalKuvveti: {
    baslik: 'Sinyal Kuvveti',
    ozet: 'Teknik göstergelerin kaçının aynı yöne baktığını özetleyen yüzde.',
    nasil: 'Yüksek olması "göstergeler hemfikir" demektir.',
    uyari: 'Hemfikir olmaları haklı oldukları anlamına GELMEZ. Bu bir kazanma olasılığı değildir.',
  },

  // ── Model çıktıları ────────────────────────────────────────────────────────
  aiKarari: {
    baslik: 'AI Kararı',
    ozet: 'Modelin o sembol için ürettiği karar (GÜÇLÜ ALIM / ALIM / TUT / SATIŞ).',
    nasil: 'Model 20 teknik göstergeden bir olasılık üretir, sonra eşiklere göre karara çevirir.',
    uyari: 'Modelin hisseler arası bir üstünlüğü henüz ÖLÇÜLEMEDİ (Model sayfasındaki kanıt bölümüne bak). Bu bir yatırım tavsiyesi değildir.',
  },
  guven: {
    baslik: 'Güven',
    ozet: 'Modelin kendi çıktısının ham skoru.',
    nasil: 'Listeyi daraltmak için kullanışlıdır: yüksek güvenli tahminleri öne alır.',
    uyari: 'Doğrulanmış bir olasılık DEĞİLDİR. "%70 güven", "%70 ihtimalle doğru" demek değildir.',
  },
  hedef: {
    baslik: 'Hedef',
    ozet: 'Modelin hesapladığı kısa vadeli fiyat hedefi.',
    nasil: 'Son dönemdeki günlük oynaklığın katı olarak hesaplanır — "şu kadar oynuyorsa bu kadar gidebilir" mantığı.',
    uyari: 'Bir söz değil, bir ölçek. Fiyatın oraya varacağının garantisi yok.',
  },
  stop: {
    baslik: 'Stop',
    ozet: 'Zarar kesme seviyesi: fiyat buraya inerse tahminin yanlışlandığı kabul edilir.',
    nasil: 'Hedefle birlikte okunur; ikisi arasındaki mesafe alınan riski belirler.',
  },
  riskKazanc: {
    baslik: 'R:R — Risk / Kazanç Oranı',
    ozet: 'Hedefe olan mesafenin, stopa olan mesafeye bölümü.',
    nasil: '1.5 ise "1 birim riske karşılık 1,5 birim kazanç hedefleniyor" demektir. Büyük olması tercih edilir.',
    uyari: 'Oranın büyük olması tahminin doğru olacağını göstermez; yalnız kazanç/zarar dengesini anlatır.',
  },

  // ── Dip taraması ───────────────────────────────────────────────────────────
  dipSkoru: {
    baslik: 'Dip Skoru',
    ozet: 'Hissenin "ana eğilimi sağlam ama geri çekilmiş" tanımına kaç şarttan kaçını sağladığı (0-5).',
    nasil: '5/5 bütün şartları geçti demektir. 3 altındakiler listeye hiç girmez.',
    uyari: 'Bu bir model tahmini değil, sabit kurallı bir filtre. "Dip" olduğunu değil, dibe benzediğini söyler.',
  },
  geriCekilme: {
    baslik: 'Geri Çekilme',
    ozet: 'Fiyatın son bir yıldaki zirvesinden yüzde kaç aşağıda olduğu.',
    nasil: 'Büyük geri çekilme ya fırsat ya da bozulan bir hikâyedir — ayrımı bu sayı yapmaz.',
  },

  // ── Temel analiz ───────────────────────────────────────────────────────────
  temelSkor: {
    baslik: 'Temel Skor',
    ozet: 'Şirketin 9 temel oranından (F/K, PD/DD, ROE, borç, büyüme, temettü, FAVÖK…) hesaplanan 0-1 arası ağırlıklı not.',
    nasil: '0.50 nötrdür. 0.60 üstü görece iyi, 0.40 altı görece zayıf.',
    uyari: '0.50 "vasat" da olabilir "veri yetersiz" de — şirketin verisi %55 tamamlığın altındaysa servis bu değeri döner.',
  },
  fk: {
    baslik: 'F/K — Fiyat / Kazanç',
    ozet: 'Hissenin fiyatı, şirketin bir yıllık kârının kaç katı.',
    nasil: '10 ise "şirket bu kâr hızıyla kendini 10 yılda çıkarır" gibi düşünülür. Hep aynı sektörle karşılaştırılır.',
    uyari: 'Düşük F/K her zaman ucuz demek değildir — piyasa kârın düşeceğini düşünüyor olabilir.',
  },
  pddd: {
    baslik: 'PD/DD — Piyasa Değeri / Defter Değeri',
    ozet: 'Şirketin borsadaki toplam değeri, muhasebe kayıtlarındaki öz sermayesinin kaç katı.',
    nasil: '1 ise borsada tam defter değerine işlem görüyor demektir.',
    uyari: '1 altı ucuzluk göstergesi olabileceği gibi, piyasanın şirkete güvenmediği anlamına da gelebilir.',
  },
  roe: {
    baslik: 'ROE — Öz Sermaye Kârlılığı',
    ozet: 'Şirket, ortakların koyduğu her 100 lira ile yılda kaç lira kâr etmiş.',
    nasil: 'Yüksek olması genelde iyidir. Aynı sektördeki şirketlerle karşılaştırılmalı.',
    uyari: 'Çok borçlanan şirketlerde ROE yapay olarak yükselebilir — tek başına okunmaz.',
  },
  temettu: {
    baslik: 'Temettü Verimi',
    ozet: 'Şirketin yıl içinde nakit dağıttığı kâr payı, hisse fiyatının yüzde kaçı.',
    nasil: '%5 ise "100 lira yatırıma yılda 5 lira nakit" demektir.',
    uyari: 'Yüksek temettü verimi bazen kâr payının bolluğundan değil, fiyatın çok düşmüş olmasından kaynaklanır.',
  },
}

// Ekranda geçen etiket → sözlük anahtarı.
//
// Eşleşme etiket METNİYLE yapılıyor; böylece her çağıran yerde ayrıca bir
// anahtar taşımak gerekmiyor ve bir bileşendeki başlık değişirse burada tek
// satır güncellenip iş bitiyor.
const ESLESME: Record<string, keyof typeof TERIMLER> = {
  'açılış': 'acilis',
  'gün yüksek': 'gunYuksek', 'günlük yüksek': 'gunYuksek', 'gün yükseği': 'gunYuksek',
  'gün düşük': 'gunDusuk', 'günlük düşük': 'gunDusuk', 'gün düşüğü': 'gunDusuk',
  'g/y': 'gunYuksekDusuk',
  'hacim': 'hacim',
  'gün yönü': 'gunYonu',

  'rsi': 'rsi', 'rsi (14)': 'rsi', 'rsi(14)': 'rsi', 'rsi 14': 'rsi',

  'macd': 'macd',
  'macd sinyal': 'macdSinyal',
  'macd hist': 'macdHist', 'macd histogram': 'macdHist',

  'bollinger': 'bollinger',
  'bb üst': 'bbUst', 'bb orta': 'bbOrta', 'bb alt': 'bbAlt',

  'ema': 'ema',
  'ema 9': 'ema9', 'ema 20': 'ema20', 'ema 50': 'ema50', 'ema 200': 'ema200',
  'ema 20/50': 'emaKesisim',

  'sinyal': 'sinyal',
  'sinyal kuvveti': 'sinyalKuvveti',

  'ai kararı': 'aiKarari',
  'güven': 'guven',
  'hedef': 'hedef',
  'stop': 'stop',
  'r:r': 'riskKazanc',

  'dip skoru': 'dipSkoru',
  'geri çekilme': 'geriCekilme',

  'temel skor': 'temelSkor',
  'f/k': 'fk',
  'pd/dd': 'pddd',
  'roe': 'roe',
  'temettü': 'temettu',
}

/**
 * Etiket metninden terim bulur. Bulamazsa undefined — çağıran sessizce
 * ipucusuz devam eder (eksik açıklama, yanlış açıklamadan iyidir).
 *
 * DİKKAT: küçültme `toLowerCase()` ile, `toLocaleLowerCase('tr-TR')` ile
 * DEĞİL. Türkçe yerelinde "RSI" → "rsı" olur (noktasız ı) ve anahtar tutmaz.
 */
export function terimBul(ad: string): Terim | undefined {
  const k = ESLESME[ad.toLowerCase().replace(/\s+/g, ' ').trim()]
  return k ? TERIMLER[k] : undefined
}
