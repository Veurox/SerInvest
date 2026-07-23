// =============================================================================
// SerInvest — Şirket Meta (isim, domain, logo)
// =============================================================================

export const COMPANY_NAMES: Record<string, string> = {
  // BIST-30
  THYAO: 'Türk Hava Yolları', GARAN: 'Garanti BBVA',     AKBNK: 'Akbank',
  EREGL: 'Erdemir',           SISE:  'Şişecam',           KCHOL: 'Koç Holding',
  ARCLK: 'Arçelik',           BIMAS: 'BİM Mağazaları',    ASELS: 'Aselsan',
  FROTO: 'Ford Otosan',       TUPRS: 'Tüpraş',            SASA:  'SASA Polyester',
  SAHOL: 'Sabancı Holding',   TTKOM: 'Türk Telekom',      TCELL: 'Turkcell',
  PGSUS: 'Pegasus',           MGROS: 'Migros',            EKGYO: 'Emlak Konut GYO',
  HALKB: 'Halkbank',          VAKBN: 'Vakıfbank',         YKBNK: 'Yapı Kredi',
  PETKM: 'Petkim',            ISCTR: 'İş Bankası',        TOASO: 'Tofaş',
  VESTL: 'Vestel',
  // BIST-50 Ek
  TAVHL: 'TAV Havalimanları', AEFES: 'Anadolu Efes',      ENKAI: 'Enka İnşaat',
  MPARK: 'MLP Sağlık',        GUBRF: 'Gübre Fabrikaları', AKCNS: 'Akçansa',
  CIMSA: 'Çimsa',             DOAS:  'Doğuş Otomotiv',    AKSEN: 'Aksa Enerji',
  SOKM:  'Şok Marketler',     BRISA: 'Brisa',             CCOLA: 'Coca-Cola İçecek',
  ALARK: 'Alarko Holding',    DOHOL: 'Doğan Holding',     ENJSA: 'Enerjisa',
  KRDMD: 'Kardemir',
  OYAKC: 'Oyak Çimento',      TKFEN: 'Tekfen Holding',
  TSKB:  'TSKB',              TTRAK: 'Türk Traktör',      ULKER: 'Ülker Bisküvi',
  ZOREN: 'Zorlu Enerji',
  // BIST-100 Ek
  AGHOL: 'AG Anadolu Grubu',  AKFGY: 'Akfen GYO',         AKFYE: 'Akfen Yenilenebilir',
  AKSA:  'Aksa Akrilik',      AKSGY: 'Akiş GYO',          ALBRK: 'Albaraka Türk',
  ANHYT: 'Anadolu Hayat',     ANSGR: 'Anadolu Sigorta',   ASTOR: 'Astor Enerji',
  BERA:  'Bera Holding',      BIENY: 'Bien Yapı',         BIOEN: 'Biotrend Çevre',
  BRSAN: 'Borusan Mannesmann', BUCIM: 'Bursa Çimento',    CWENE: 'CW Enerji',
  ECILC: 'Eczacıbaşı İlaç',   EGEEN: 'Ege Endüstri',      GESAN: 'Girişim Elektrik',
  GOLTS: 'Göltaş Çimento',    HEKTS: 'Hektaş',
  KAREL: 'Karel Elektronik',  KARSN: 'Karsan Otomotiv',   KCAER: 'Kocaer Çelik',
  KONTR: 'Kontrolmatik',      KONYA: 'Konya Çimento',     MAVI:  'Mavi Giyim',
  MIATK: 'Mia Teknoloji',     ODAS:  'ODAŞ Enerji',       OTKAR: 'Otokar',
  PENTA: 'Penta Teknoloji',   SKBNK: 'Şekerbank',         SMRTG: 'Smart Güneş',
  TABGD: 'TAB Gıda',          TUKAS: 'Tukaş',             TURSG: 'Türkiye Sigorta',
  VESBE: 'Vestel Beyaz',
  // Emtia & Döviz
  XAUUSD: 'Altın (Spot)',     XAGUSD: 'Gümüş (Spot)',     BRENTOIL: 'Brent Petrol',
  USDTRY: 'Dolar / TL',       EURTRY: 'Euro / TL',        GBPTRY: 'Sterlin / TL',
}

export const COMPANY_DOMAINS: Record<string, string> = {
  // BIST-30
  THYAO: 'turkishairlines.com', GARAN: 'garantibbva.com.tr', AKBNK: 'akbank.com',
  EREGL: 'erdemir.com.tr',      SISE:  'sisecam.com',        KCHOL: 'koc.com.tr',
  ARCLK: 'arcelik.com',         BIMAS: 'bim.com.tr',         ASELS: 'aselsan.com',
  FROTO: 'fordotosan.com.tr',   TUPRS: 'tupras.com.tr',      SAHOL: 'sabanci.com',
  TTKOM: 'turktelekom.com.tr',  TCELL: 'turkcell.com.tr',    PGSUS: 'flypgs.com',
  MGROS: 'migros.com.tr',       EKGYO: 'emlakkonut.com.tr',  HALKB: 'halkbank.com.tr',
  VAKBN: 'vakifbank.com.tr',    YKBNK: 'yapikredi.com.tr',   PETKM: 'petkim.com.tr',
  ISCTR: 'isbank.com.tr',       TOASO: 'tofas.com.tr',       VESTL: 'vestel.com.tr',
  SASA:  'sasa.com.tr',
  // BIST-50 Ek
  TAVHL: 'tav.aero',            AEFES: 'anadoluefes.com',    ENKAI: 'enka.com',
  MPARK: 'mlpcare.com',         GUBRF: 'gubretas.com.tr',    AKCNS: 'akcansa.com.tr',
  CIMSA: 'cimsa.com.tr',        DOAS:  'dogusotomotiv.com.tr', AKSEN: 'aksaenerji.com.tr',
  SOKM:  'sokmarket.com.tr',    BRISA: 'brisa.com.tr',       CCOLA: 'cci.com.tr',
  ALARK: 'alarko.com.tr',       DOHOL: 'doganholding.com.tr', ENJSA: 'enerjisa.com.tr',
  KRDMD: 'kardemir.com',
  OYAKC: 'oyakcimento.com.tr',  TKFEN: 'tekfen.com.tr',
  TSKB:  'tskb.com.tr',         TTRAK: 'turktraktor.com.tr', ULKER: 'ulker.com.tr',
  ZOREN: 'zorlu.com.tr',
  // BIST-100 Ek
  AGHOL: 'aganadolugrubu.com',  AKFGY: 'akfengyo.com.tr',    AKFYE: 'akfenyenilenebilir.com.tr',
  AKSA:  'aksa.com.tr',         AKSGY: 'akisgyo.com',        ALBRK: 'albarakaturk.com.tr',
  ANHYT: 'anadoluhayat.com.tr', ANSGR: 'anadolusigorta.com.tr', ASTOR: 'astor.com.tr',
  BERA:  'beraholding.com.tr',  BIENY: 'bienyapi.com.tr',    BIOEN: 'biotrend.com.tr',
  BRSAN: 'borusanmannesmann.com', BUCIM: 'bursacimento.com.tr', CWENE: 'cwenerji.com',
  ECILC: 'eczacibasi.com.tr',   EGEEN: 'egeendustri.com.tr', GESAN: 'girisimelektrik.com.tr',
  GOLTS: 'goltas.com.tr',       HEKTS: 'hektas.com.tr',
  KAREL: 'karel.com.tr',        KARSN: 'karsan.com.tr',      KCAER: 'kocaer.com.tr',
  KONTR: 'kontrolmatik.com',    KONYA: 'konyacimento.com',   MAVI:  'mavi.com',
  MIATK: 'miateknoloji.com.tr', ODAS:  'odasenerji.com.tr',  OTKAR: 'otokar.com.tr',
  PENTA: 'penta.com.tr',        SKBNK: 'sekerbank.com.tr',   SMRTG: 'smartsolar.com.tr',
  TABGD: 'tabgida.com.tr',      TUKAS: 'tukas.com.tr',       TURSG: 'turkiyesigorta.com.tr',
  VESBE: 'vestelbeyaz.com.tr',
}

const LOGO_COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#22c55e', '#14b8a6', '#f97316']
export const logoColor = (sym: string) => LOGO_COLORS[sym.charCodeAt(0) % LOGO_COLORS.length]

// Logo URL kaynakları — sırayla denen cascade.
// 1. icon.horse        → 256px PNG, açık kaynak, en iyi kalite
// 2. Google Favicons   → 128px, hep çalışır ama bazen düşük çözünürlük
// 3. DDG Icons         → ICO formatı, yedek
// 4. Domain /favicon.ico → mutlak son çare; bazı siteler 32x32 ICO veriyor
export const logoSources = (domain: string) => [
  `https://icon.horse/icon/${domain}`,
  `https://www.google.com/s2/favicons?domain=${domain}&sz=128`,
  `https://icons.duckduckgo.com/ip3/${domain}.ico`,
  `https://${domain}/favicon.ico`,
]
