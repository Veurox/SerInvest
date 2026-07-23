"""
SerInvest Haber Analiz Motoru (Faz 0)
--------------------------------------
- Türkçe + İngilizce RSS haberleri çeker
- Çok dilli DistilBERT ile duygu analizi yapar (VADER yerine)
- BIST hisselerini, altın/gümüş/petrolü ve makro olayları tespit eder
- Yapılandırılmış mesajları RabbitMQ 'news.analyzed' kuyruğuna gönderir
"""

import pika
import json
import re
import time
import calendar
import datetime
import os
import socket
import feedparser
import requests as _requests   # Oracle anomali tetikleyici için
from pathlib import Path
from transformers import pipeline as hf_pipeline

# RSS feed'leri bazen takılı kalabilir — global timeout 20sn.
# (feedparser timeout argümanı kabul etmez; socket seviyesinden yakalıyoruz.)
socket.setdefaulttimeout(20)

# seen_guids restart sonrası sıfırlanmasın — kalıcı dosyaya kaydet
SEEN_GUIDS_FILE = Path("/app/seen_guids.json")

# ══════════════════════════════════════════════════════════════════════════════
#  Faz 3 (ml v4): OLAY TİPOLOJİSİ + YENİLİK SKORU
#  Ham sentiment zayıf sinyal ("Süper Loto → BULLISH +0.96" vakası). Meta-labeling
#  katmanı yapılandırılmış olay tipi + tekrar-haber cezasıyla beslenir.
# ══════════════════════════════════════════════════════════════════════════════

# Olay tipi → (regex deseni TR+EN, yön ipucu: +1 pozitif / -1 negatif / 0 nötr).
# Sıra ÖNEMLİ: ilk eşleşen kazanır (özgül → genel).
EVENT_PATTERNS: list[tuple[str, str, int]] = [
    ("TEMETTU",        r"temettü|kar payı|kâr payı|dividend", +1),
    ("GERI_ALIM",      r"geri alım|geri alim|pay geri|buyback|share repurchase", +1),
    ("BEDELLI",        r"bedelli|bedelsiz|sermaye artırım|sermaye artirim|rights issue", 0),
    ("KAR_ACIKLAMA",   r"net dönem kar|net donem kar|bilanço|bilanco|finansal sonuç|finansal sonuc|earnings|net profit|quarterly result", 0),
    ("SOZLESME",       r"ihale|sözleşme imza|sozlesme imza|anlaşma imza|anlasma imza|sipariş ald|siparis ald|contract award|new order", +1),
    ("YATIRIM",        r"yatırım karar|yatirim karar|kapasite art|yeni fabrika|tesis aç|tesis ac|üretim tesisi|uretim tesisi|new plant|capacity expansion", +1),
    ("YONETIM",        r"genel müdür|genel mudur|yönetim kurulu başkan|yonetim kurulu baskan|ceo|istifa|atan(dı|di|ma)|resign|appoint", 0),
    ("CEZA_SORUSTURMA", r"soruşturma|sorusturma|spk ceza|rekabet kurumu|idari para ceza|dava aç|dava ac|mahkeme karar|investigation|lawsuit|fine[sd]?\b|penalty", -1),
    ("DERECELENDIRME", r"not artır|not artir|not indir|hedef fiyat|kredi notu|tavsiye yükselt|tavsiye yukselt|tavsiye düşür|tavsiye dusur|upgrade|downgrade|price target|rating", 0),
    ("FAIZ_KARARI",    r"faiz karar|politika faizi|tcmb.*faiz|faiz.*tcmb|merkez bankası faiz|merkez bankasi faiz|fed.*(faiz|rate)|rate (decision|cut|hike)|interest rate", 0),
    ("ENFLASYON",      r"enflasyon|tüfe|tufe|üfe\b|ufe\b|inflation|cpi\b|ppi\b", 0),
    ("JEOPOLITIK",     r"savaş|savas|saldırı|saldiri|yaptırım|yaptirim|çatışma|catisma|füze|fuze|işgal|isgal|war\b|attack|sanction|missile|invasion|conflict", -1),
    ("MAKRO_VERI",     r"büyüme veri|buyume veri|gsyh|işsizlik|issizlik|cari (açık|acik|denge)|pmi\b|sanayi üretim|sanayi uretim|gdp|unemployment|current account", 0),
]
_EVENT_RE = [(name, re.compile(pat, re.IGNORECASE), hint) for name, pat, hint in EVENT_PATTERNS]


def classify_event(text: str) -> str:
    """Haber metni → yapılandırılmış olay tipi. Eşleşme yoksa GENEL."""
    for name, rx, _hint in _EVENT_RE:
        if rx.search(text):
            return name
    return "GENEL"


class NoveltyTracker:
    """
    Son 72 saatin başlıklarına Jaccard token benzerliğiyle yenilik skoru:
    novelty = 1 − max_benzerlik. Aynı haberin 15 kaynaktaki tekrarı ≈ 0 alır.
    Restart'a dayanıklı (JSON persist) — Faz 1'deki seen_guids deseniyle aynı.
    """
    FILE = Path("/app/recent_heads.json")
    WINDOW_HOURS = 72
    MAX_ITEMS = 3000

    def __init__(self):
        self.items: list[dict] = []   # [{t: iso, tok: [..]}]
        try:
            if self.FILE.exists():
                self.items = json.loads(self.FILE.read_text(encoding="utf-8"))
        except Exception:
            self.items = []

    @staticmethod
    def _tokens(text: str) -> set:
        words = re.findall(r"[a-zçğıöşü0-9]{3,}", text.lower())
        return set(words)

    def _prune(self):
        cutoff = (datetime.datetime.utcnow()
                  - datetime.timedelta(hours=self.WINDOW_HOURS)).isoformat()
        self.items = [it for it in self.items if it.get("t", "") >= cutoff][-self.MAX_ITEMS:]

    def score_and_add(self, headline: str) -> float:
        """Yenilik skoru [0,1] hesaplar ve başlığı belleğe ekler."""
        toks = self._tokens(headline)
        if not toks:
            return 1.0
        max_sim = 0.0
        for it in self.items:
            prev = set(it.get("tok", []))
            if not prev:
                continue
            inter = len(toks & prev)
            if inter == 0:
                continue
            sim = inter / len(toks | prev)
            if sim > max_sim:
                max_sim = sim
                if max_sim > 0.95:
                    break
        self.items.append({"t": datetime.datetime.utcnow().isoformat(),
                           "tok": sorted(toks)[:40]})
        return round(1.0 - max_sim, 4)

    def save(self):
        try:
            self._prune()
            self.FILE.write_text(json.dumps(self.items, ensure_ascii=False),
                                 encoding="utf-8")
        except Exception as e:
            print(f"[novelty] kaydedilemedi: {e}")


NOVELTY = NoveltyTracker()

# ── BIST Ticker Sözlüğü ────────────────────────────────────────────────────────
BIST_KEYWORDS = {
    # ── BIST-30 (Haber-yoğun) ──────────────────────────────────────────────
    "thyao": "THYAO", "türk hava yolları": "THYAO", "türk hava": "THYAO", "turkish airlines": "THYAO", "turk hava": "THYAO",
    "garan": "GARAN", "garanti bankası": "GARAN", "garanti bbva": "GARAN", "garanti bank": "GARAN",
    "akbnk": "AKBNK", "akbank": "AKBNK",
    "eregl": "EREGL", "erdemir": "EREGL", "ereğli demir": "EREGL",
    "sise":  "SISE",  "şişecam": "SISE", "sisecam": "SISE",
    "kchol": "KCHOL", "koç holding": "KCHOL", "koc holding": "KCHOL",
    "arclk": "ARCLK", "arçelik": "ARCLK", "arcelik": "ARCLK",
    "bimas": "BIMAS", "bim mağaza": "BIMAS", "bim birleşik": "BIMAS",
    "asels": "ASELS", "aselsan": "ASELS",
    "froto": "FROTO", "ford otosan": "FROTO",
    "tuprs": "TUPRS", "tüpraş": "TUPRS", "tupras": "TUPRS",
    "sasa":  "SASA",  "sasa polyester": "SASA",
    "sahol": "SAHOL", "sabancı holding": "SAHOL", "sabanci": "SAHOL", "sabancı sahol": "SAHOL",
    "ttkom": "TTKOM", "türk telekom": "TTKOM", "turk telekom": "TTKOM",
    "tcell": "TCELL", "turkcell": "TCELL",
    "pgsus": "PGSUS", "pegasus hava": "PGSUS", "pegasus airlines": "PGSUS",
    "mgros": "MGROS", "migros": "MGROS",
    "ekgyo": "EKGYO", "emlak gyo": "EKGYO", "emlak konut": "EKGYO",
    "halkb": "HALKB", "halkbank": "HALKB", "halk bankası": "HALKB",
    "vakbn": "VAKBN", "vakıfbank": "VAKBN", "vakifbank": "VAKBN", "vakıf bank": "VAKBN",
    "ykbnk": "YKBNK", "yapı kredi": "YKBNK", "yapi kredi": "YKBNK", "ykb ": "YKBNK",
    "petkm": "PETKM", "petkim": "PETKM",
    "krdmd": "KRDMD", "kardemir": "KRDMD",
    "dohol": "DOHOL", "doğan holding": "DOHOL", "dogan holding": "DOHOL",
    "ccola": "CCOLA", "coca-cola içecek": "CCOLA", "coca cola içecek": "CCOLA",
    "isctr": "ISCTR", "iş bankası": "ISCTR", "isbank": "ISCTR", "is bankasi": "ISCTR",
    "toaso": "TOASO", "tofaş": "TOASO", "tofas": "TOASO",
    "vestl": "VESTL", "vestel": "VESTL",

    # ── BIST-50 (Genişletilmiş) ────────────────────────────────────────────
    "tavhl": "TAVHL", "tav havalimanları": "TAVHL", "tav havalimanlari": "TAVHL", "tav airport": "TAVHL",
    "aefes": "AEFES", "anadolu efes": "AEFES",
    "enkai": "ENKAI", "enka inşaat": "ENKAI", "enka insaat": "ENKAI",
    "tralt": "TRALT", "türkiye altın": "TRALT",
    "trmet": "TRMET", "türkiye metal": "TRMET",
    "mpark": "MPARK", "mlp sağlık": "MPARK", "mlp saglik": "MPARK",
    "gubrf": "GUBRF", "gübre fabrika": "GUBRF", "gubre fabrika": "GUBRF",
    "akcns": "AKCNS", "akçansa": "AKCNS", "akcansa": "AKCNS",
    "cimsa": "CIMSA", "çimsa": "CIMSA",
    "doas":  "DOAS",  "doğuş otomotiv": "DOAS", "dogus otomotiv": "DOAS",
    "aksen": "AKSEN", "aksa enerji": "AKSEN",
    "sokm":  "SOKM",  "şok market": "SOKM", "sok market": "SOKM", "şok marketler": "SOKM",
    "brisa": "BRISA", "brisa lastik": "BRISA", "bridgestone sabancı": "BRISA",

    # ── BIST-100 Ek (kalan haber-yoğun büyük şirketler) ────────────────────
    "agesa": "AGESA", "agesa hayat": "AGESA", "agesa emeklilik": "AGESA",
    "alark": "ALARK", "alarko holding": "ALARK", "alarko": "ALARK",
    "anhyt": "ANHYT", "anadolu hayat": "ANHYT", "anadolu sigorta": "ANHYT",
    "askgs": "ASUZU", "anadolu isuzu": "ASUZU", "ısuzu": "ASUZU",
    "bagfs": "BAGFS", "bagfaş": "BAGFS", "bagfas": "BAGFS",
    "bera":  "BERA",  "bera holding": "BERA",
    "bobet": "BOBET", "boğaziçi beton": "BOBET",
    "bucim": "BUCIM", "bursa çimento": "BUCIM",
    "cante": "CANTE", "çan2 termik": "CANTE",
    "ctkns": "CTKNS", "çatkın gıda": "CTKNS",
    "deva":  "DEVA",  "deva holding": "DEVA", "deva ilaç": "DEVA",
    "ecilc": "ECILC", "eczacıbaşı ilaç": "ECILC", "eczacıbaşı yatırım": "ECZYT",
    "eczyt": "ECZYT", "eczacıbaşı": "ECZYT",
    "egeen": "EGEEN", "ege endüstri": "EGEEN",
    "ekos":  "EKOS",  "ekos enerji": "EKOS",
    "fenerbahçe": "FENER", "fenerbahce": "FENER", "fb spor": "FENER",
    "gesan": "GESAN", "girişim elektrik": "GESAN",
    "goodyear": "GOODY", "goodyear lastik": "GOODY",
    "hekts": "HEKTS", "hektaş": "HEKTS", "hektas": "HEKTS",
    "ipekg": "IPEKE", "ipek doğal enerji": "IPEKE",
    "izmdc": "IZMDC", "izmir demir çelik": "IZMDC",
    "kartn": "KARTN", "kartonsan": "KARTN",
    "kayse": "KAYSE", "kayseri şeker": "KAYSE",
    "kfein": "KFEIN", "kafein yazılım": "KFEIN",
    "kontr": "KONTR", "kontrolmatik": "KONTR",
    "kordsa": "KORDS","kordsa teknik": "KORDS",
    "koton": "KOTON", "koton mağazacılık": "KOTON",
    "kozaa": "KOZAA", "koza anadolu": "KOZAA",
    "kozal": "KOZAL", "koza altın": "KOZAL", "koza altin": "KOZAL",
    "logo":  "LOGO",  "logo yazılım": "LOGO", "logo yazilim": "LOGO",
    "mavi":  "MAVI",  "mavi giyim": "MAVI",
    "naturel": "NATEN", "naturelnet enerji": "NATEN",
    "netas": "NETAS", "netaş": "NETAS",
    "odas":  "ODAS",  "odaş elektrik": "ODAS", "odas elektrik": "ODAS",
    "otkar": "OTKAR", "otokar": "OTKAR",
    "oyakc": "OYAKC", "oyak çimento": "OYAKC",
    "papil": "PAPIL", "papilon savunma": "PAPIL",
    "penta": "PENTA", "penta teknoloji": "PENTA",
    "qua":   "QUAGR", "qua granite": "QUAGR",
    "selec": "SELEC", "selçuk ecza": "SELEC", "selcuk ecza": "SELEC",
    "skbnk": "SKBNK", "şekerbank": "SKBNK", "sekerbank": "SKBNK",
    "smrtg": "SMRTG", "smart güneş": "SMRTG", "smart gunes": "SMRTG",
    "tkfen": "TKFEN", "tekfen holding": "TKFEN", "tekfen inşaat": "TKFEN",
    "tmsn":  "TMSN",  "tümosan motor": "TMSN", "tumosan motor": "TMSN",
    "trgyo": "TRGYO", "torunlar gyo": "TRGYO",
    "tsk":   "TSKB",  "tskb": "TSKB", "türkiye sınai kalkınma": "TSKB",
    "ttrak": "TTRAK", "türk traktör": "TTRAK", "turk traktor": "TTRAK",
    "ulker": "ULKER", "ülker bisküvi": "ULKER", "ulker biskuvi": "ULKER",
    "vesbe": "VESBE", "vestel beyaz": "VESBE",
    "yatas": "YATAS", "yataş yatak": "YATAS", "yatas yatak": "YATAS",
    "zorlu": "ZOREN", "zorlu enerji": "ZOREN",
    "alkim": "ALKIM", "alkim kimya": "ALKIM",
    "ayen":  "AYEN",  "ayen enerji": "AYEN",
    "kervn": "KERVN", "kervan gıda": "KERVN", "kervan gida": "KERVN",
    "tatgd": "TATGD", "tat gıda": "TATGD", "tat gida": "TATGD",

    # ── Ek Sık Görülen Şirketler ────────────────────────────────────────────
    "enjsa":  "ENJSA", "enerjisa": "ENJSA", "enerjisa enerji": "ENJSA",
    "hlgyo":  "HLGYO", "halk gyo": "HLGYO", "halk gayrimenkul": "HLGYO",
    "ykgyo":  "YKGYO", "yapı kredi gyo": "YKGYO", "yapi kredi gyo": "YKGYO",
    "tursg":  "TURSG", "türkiye sigorta": "TURSG", "turkiye sigorta": "TURSG",
    "aghol":  "AGHOL", "anadolu grubu": "AGHOL", "anadolu group": "AGHOL",
    "ttgyo":  "TTGYO", "türkerler gyo": "TTGYO",
    "indes":  "INDES", "index grup": "INDES", "index group": "INDES",
    "prkme":  "PRKME", "park elektrik": "PRKME",
    "bfren":  "BFREN", "bosch fren": "BFREN",
    "cment":  "CMENT", "çimentaş": "CMENT", "cimentas": "CMENT",
    "izocm":  "IZOCM", "izocam": "IZOCM",
    "lmkdc":  "LMKDC", "limak çimento": "LMKDC",
    "karsn":  "KARSN", "karsan otomotiv": "KARSN", "karsan": "KARSN",
    "nthol":  "NTHOL", "net holding": "NTHOL",
    "tcman":  "TCMAN", "türkiye çimento": "TCMAN",
    "adese":  "ADESE", "adese alışveriş": "ADESE",
    "albrk":  "ALBRK", "albaraka türk": "ALBRK", "albaraka": "ALBRK",
    "kuyas":  "KUYAS", "kuyaş": "KUYAS",
    "mhrtn":  "MHRTN", "mehur inşaat": "MHRTN",
    "issen":  "ISSEN", "işkur": "ISKUR",
    "avhol":  "AVHOL", "avrasya holding": "AVHOL",
    "banvt":  "BANVT", "bandırma vitamin": "BANVT",
    "rygyo":  "RYGYO", "ray sigorta": "RYGYO",
    "bmsch":  "BMSCH", "bmsc holding": "BMSCH",
    "euhol":  "EUHOL", "euro holding": "EUHOL",
}

COMMODITY_KEYWORDS = {
    "gold": "XAUUSD", "altın": "XAUUSD", "xau": "XAUUSD", "gold price": "XAUUSD",
    "silver": "XAGUSD", "gümüş": "XAGUSD", "xag": "XAGUSD",
    "oil": "BRENTOIL", "petrol": "BRENTOIL", "brent": "BRENTOIL", "crude": "BRENTOIL",
    "natural gas": "NATGAS", "doğalgaz": "NATGAS", "lng": "NATGAS",
    "copper": "COPPER", "bakır": "COPPER",
}

MACRO_KEYWORDS = {
    "bist": "BIST100", "borsa istanbul": "BIST100", "bist100": "BIST100", "bist 100": "BIST100",
    "dow jones": "DJI", "s&p 500": "SP500", "s&p500": "SP500", "nasdaq": "NASDAQ",
    "fed": "FED", "federal reserve": "FED", "faiz": "FED",
    "tcmb": "TCMB", "merkez bankası": "TCMB", "central bank": "TCMB",
    "enflasyon": "INFLATION", "inflation": "INFLATION", "tüfe": "INFLATION",
    "usdtry": "USDTRY", "dolar/tl": "USDTRY", "usd/try": "USDTRY",
    "dolar": "USDTRY", "dollar": "USDTRY",
    "eurtry": "EURTRY", "euro/tl": "EURTRY",
    "bitcoin": "BTC", "btc": "BTC", "kripto": "BTC",
    "bütçe": "MACRO_TR", "budget": "MACRO_TR",
    "gdp": "MACRO_GLOBAL", "büyüme": "MACRO_TR", "growth": "MACRO_GLOBAL",
    "jeopolitik": "GEOPOLITICAL", "geopolitic": "GEOPOLITICAL", "savaş": "GEOPOLITICAL",
    "war": "GEOPOLITICAL", "sanctions": "GEOPOLITICAL", "yaptırım": "GEOPOLITICAL",
}

RSS_FEEDS = {
    # ── Türkçe Genel Ekonomi ───────────────────────────────────────────────
    "AA Ekonomi":          "https://www.aa.com.tr/tr/rss/default?cat=ekonomi",
    "Bloomberg HT":        "https://www.bloomberght.com/rss",
    "Investing.com TR":    "https://tr.investing.com/rss/news_25.rss",

    # ── Türkçe BIST-Yoğun (denenmiş, çalışan kaynaklar) ──────────────────
    "TRT Haber Eko":       "https://www.trthaber.com/ekonomi_articles.rss",# 60 entry
    "Hürriyet Ekonomi":    "https://www.hurriyet.com.tr/rss/ekonomi",      # 100 entry
    "Milliyet Ekonomi":    "https://www.milliyet.com.tr/rss/rssNew/ekonomiRss.xml",
    "NTV Ekonomi":         "https://www.ntv.com.tr/ekonomi.rss",
    "CNN Türk Ekonomi":    "https://www.cnnturk.com/feed/rss/ekonomi/news",
    "Sabah Ekonomi":       "https://www.sabah.com.tr/rss/ekonomi.xml",
    "Para Analiz":         "https://www.paraanaliz.com/feed/",
    "Ekonomim":            "https://www.ekonomim.com/rss",
    "Bigpara":             "https://bigpara.hurriyet.com.tr/rss/",          # 30 entry, finans odaklı (KAP haberlerini içerir)
    "Haberturk Ekonomi":   "https://www.haberturk.com/rss/ekonomi.xml",    # 30 entry
    "Sozcu Ekonomi":       "https://www.sozcu.com.tr/rss/ekonomi.xml",     # 50 entry
    "Investing.com Hisse": "https://tr.investing.com/rss/news_356.rss",
    "Investing.com Tahvil":"https://tr.investing.com/rss/news_95.rss",

    # ── İngilizce Kaynaklar (makro/global bağlam) ────────────────────────
    "CNBC Economy":        "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258",
    "CNBC Markets":        "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=15839069",
    "Investing.com Comm":  "https://tr.investing.com/rss/news_11.rss",
    "MarketWatch":         "https://feeds.content.dowjones.io/public/rss/mw_realtimeheadlines",
    # NOT: Foreks (403), Dünya Gazetesi/Borsa (404), CNBC World, Bloomberg HT Borsa/Şirket,
    # Mynet, Finans Gündem — test edildi, çalışmıyor, çıkarıldı.
}

JEOPOLITIK_KEYWORDS = [
    "war", "savaş", "conflict", "çatışma", "sanction", "yaptırım",
    "geopolitic", "jeopolitik", "nato", "un security", "bm güvenlik",
    "election", "seçim", "government", "hükümet", "central bank", "merkez",
    "crisis", "kriz", "recession", "durgunluk", "gdp", "büyüme",
    "inflation", "enflasyon", "interest rate", "faiz",
    "fed meeting", "fomc", "tcmb toplantı",
]

# ── Türkçe Finansal Lexicon Boost ──────────────────────────────────────────
# Multilingual DistilBERT genel sentimente bakar; "rekor kar", "ihale aldı",
# "zarar açıkladı" gibi BIST haberlerindeki net finansal sinyalleri tutarlı
# yakalayamaz. Bu sözlük modelin çıktısına +/- ek ağırlık verir.
FIN_POSITIVE = {
    "rekor kar": 0.30, "rekor kâr": 0.30, "kar açıkladı": 0.20, "kâr açıkladı": 0.20,
    "kar artışı": 0.20, "kâr artışı": 0.20, "kar marjı arttı": 0.20,
    "ihale aldı": 0.25, "ihale kazandı": 0.25, "sözleşme imzaladı": 0.20,
    "anlaşma imzaladı": 0.18, "stratejik ortaklık": 0.15,
    "ihracat arttı": 0.20, "kapasite artış": 0.18, "yatırım kararı": 0.15,
    "büyüme": 0.12, "rekor seviye": 0.18, "zirve": 0.15, "tarihi zirve": 0.25,
    "beklenti üstü": 0.22, "tahminleri aştı": 0.22, "yükseliş trendi": 0.15,
    "temettü dağıtacak": 0.18, "temettü artırdı": 0.20, "bedelsiz sermaye": 0.15,
    "hedef yükseltildi": 0.20, "al tavsiyesi": 0.25, "alım tavsiyesi": 0.25,
    "outperform": 0.20, "buy rating": 0.20, "upgrade": 0.18,
    "record high": 0.22, "all-time high": 0.25, "beat estimates": 0.22,
}

FIN_NEGATIVE = {
    "zarar açıkladı": -0.30, "zarar kaydetti": -0.28, "zarar yazdı": -0.25,
    "kar düşüşü": -0.22, "kâr düşüşü": -0.22, "gelir düştü": -0.18,
    "iflas": -0.40, "tasfiye": -0.35, "moratorium": -0.30, "borç krizi": -0.30,
    "ihale iptali": -0.25, "sözleşme feshi": -0.22, "üretim durdu": -0.25,
    "fabrika kapandı": -0.25, "üretim durduruldu": -0.25,
    "ihracat düştü": -0.18, "kapasite düştü": -0.18, "yatırım iptali": -0.20,
    "beklenti altı": -0.22, "tahminlerin altında": -0.22, "düşüş trendi": -0.15,
    "temettü iptali": -0.25, "temettü askıya": -0.22,
    "hedef düşürüldü": -0.22, "sat tavsiyesi": -0.25, "satım tavsiyesi": -0.25,
    "underperform": -0.22, "sell rating": -0.22, "downgrade": -0.20,
    "missed estimates": -0.22, "profit warning": -0.28, "lawsuit": -0.18,
    "soruşturma": -0.18, "para cezası": -0.20, "ceza kesildi": -0.20,
    "skandal": -0.22, "dolandırıcılık": -0.30, "yolsuzluk": -0.28,
    "deprem": -0.10, "yangın": -0.10, "kaza": -0.08,  # operasyonel risk
}

# Kaynak güven ağırlıkları — BIST haberi için Türkçe kaynaklar daha güvenilir
SOURCE_WEIGHTS = {
    # Genel TR ekonomi
    "AA Ekonomi":          1.30,
    "Bloomberg HT":        1.30,
    "Dünya Gazetesi":      1.20,
    "Investing.com TR":    1.10,
    # BIST-özel TR (en yüksek güven — direkt borsa/şirket odaklı)
    "Bloomberg HT Borsa":  1.40,
    "Bloomberg HT Şirket": 1.40,
    "Dünya Borsa":         1.35,
    "Dünya Şirketler":     1.35,
    "Investing.com Hisse": 1.25,
    "Investing.com Tahvil":1.10,
    "Mynet Finans":        1.20,
    "Para Analiz":         1.25,
    "Ekonomim":            1.20,
    "Bigpara":             1.30,   # Hürriyet finans alt sitesi, BIST haberleri ağırlıklı
    "Haberturk Ekonomi":   1.20,
    "Sozcu Ekonomi":       1.15,
    "TRT Haber Eko":       1.20,
    "Hürriyet Ekonomi":    1.15,
    "Milliyet Ekonomi":    1.10,
    "NTV Ekonomi":         1.10,
    "CNN Türk Ekonomi":    1.10,
    "Sabah Ekonomi":       1.10,
    # Global EN
    "CNBC Economy":        0.85,
    "CNBC Markets":        0.85,
    "Investing.com Comm":  0.95,  # Emtia için iyi
    "MarketWatch":         0.85,
}


# ── Anomali tetikleyici cooldown (30 dakika) ─────────────────────────────────
_LAST_TRIGGER_AT: datetime.datetime | None = None
_TRIGGER_COOLDOWN_SEC = 30 * 60  # 30 dakika

# Oracle URL (docker-compose'da ORACLE_URL env var olarak set edilir)
_ORACLE_URL = os.environ.get("ORACLE_URL", "").rstrip("/")


class NewsAnalyzer:
    def __init__(self):
        print("Sentiment modelleri yükleniyor...")
        # 1) Türkçe BERT — TR kaynaklardaki BIST haberlerini çok daha iyi anlar.
        #    "TAV 19M yolcuya hizmet verdi" → BULLISH (multilingual bunu NEUTRAL görüyordu)
        print("  [1/2] Türkçe BERT (savasy/bert-base-turkish-sentiment-cased)...")
        self.sentiment_tr = hf_pipeline(
            "sentiment-analysis",
            model="savasy/bert-base-turkish-sentiment-cased",
            top_k=None,
            device=-1,
        )
        # 2) Çok dilli DistilBERT — İngilizce / global haberler için
        print("  [2/2] Çok dilli DistilBERT (lxyuan)...")
        self.sentiment_ml = hf_pipeline(
            "sentiment-analysis",
            model="lxyuan/distilbert-base-multilingual-cased-sentiments-student",
            top_k=None,
            device=-1,
        )
        self.seen_guids: set[str] = self._load_seen_guids()
        print(f"Her iki model yüklendi. ({len(self.seen_guids)} bilinen GUID yüklendi)")

    @staticmethod
    def _load_seen_guids() -> set[str]:
        """Restart sonrası daha önce işlenen haberleri tekrar göndermemek için."""
        if SEEN_GUIDS_FILE.exists():
            try:
                return set(json.loads(SEEN_GUIDS_FILE.read_text(encoding="utf-8")))
            except Exception as e:
                print(f"  [seen_guids] yükleme hatası: {e}")
        return set()

    def _save_seen_guids(self) -> None:
        try:
            # Son ~3000 GUID yeterli — eski haberler RSS feed'inden zaten kaybolur
            recent = list(self.seen_guids)[-3000:]
            SEEN_GUIDS_FILE.write_text(json.dumps(recent, ensure_ascii=False))
        except Exception as e:
            print(f"  [seen_guids] kaydetme hatası: {e}")

    @staticmethod
    def _kw_match(kw: str, text_lower: str) -> bool:
        """
        Kısa BIST kodları (örn. "selec", "deva", "logo") "selection",
        "devasa", "logoyla" gibi yaygın kelimelerin substring'i olarak
        eşleşip yanlış pozitif üretiyordu. ≤6 harf anahtarlar için word
        boundary (\\b) ile tam kelime eşleştir; uzun çok kelimeli ifadeler
        için substring yeterli (zaten yeterince spesifik).
        """
        if " " in kw or len(kw.strip()) > 6:
            return kw in text_lower
        # Kısa anahtar: tam kelime sınırı
        return re.search(rf"\b{re.escape(kw.strip())}\b", text_lower) is not None

    def detect_asset(self, text: str) -> tuple[str, str]:
        text_lower = text.lower()

        for kw, ticker in BIST_KEYWORDS.items():
            if self._kw_match(kw, text_lower):
                return ticker, "BIST"

        for kw, asset in COMMODITY_KEYWORDS.items():
            if self._kw_match(kw, text_lower):
                return asset, "COMMODITY"

        for kw, asset in MACRO_KEYWORDS.items():
            if self._kw_match(kw, text_lower):
                return asset, "MACRO"

        return "GLOBAL", "GENERAL"

    def detect_geopolitical(self, text: str) -> bool:
        text_lower = text.lower()
        return any(kw in text_lower for kw in JEOPOLITIK_KEYWORDS)

    def _financial_lexicon_boost(self, text_lower: str) -> float:
        """
        Türkçe finansal lexicon ile sentiment skorunu güçlendirir.
        Genel sentiment modelinin "kar açıkladı" gibi finansal ifadeleri yatay
        algılaması sorununu giderir. Birden fazla eşleşmede toplam clip[-0.5, 0.5].
        """
        boost = 0.0
        for kw, w in FIN_POSITIVE.items():
            if kw in text_lower:
                boost += w
        for kw, w in FIN_NEGATIVE.items():
            if kw in text_lower:
                boost += w
        return max(-0.50, min(0.50, boost))

    def analyze_sentiment(self, text: str, is_tr_source: bool = False) -> tuple[float, str]:
        """
        is_tr_source=True → Türkçe BERT (savasy) kullan — BIST haberleri için optimize.
        is_tr_source=False → Çok dilli DistilBERT (lxyuan) — İngilizce/global haberler.

        Her iki model da 'positive' ve 'negative' label üretir; Türkçe model 'notr',
        multilingual model 'neutral' kullanır. compound = positive - negative formülü
        her ikisi için de çalışır.
        """
        try:
            model = self.sentiment_tr if is_tr_source else self.sentiment_ml
            results = model(text[:512])[0]
            scores = {r["label"].lower(): r["score"] for r in results}
            compound = scores.get("positive", 0.0) - scores.get("negative", 0.0)

            # Finansal lexicon boost — "rekor kar", "zarar açıkladı" gibi
            # BIST haberlerine özgü güçlü sinyalleri sentimente ekle.
            lex_boost = self._financial_lexicon_boost(text.lower())
            compound  = round(max(-1.0, min(1.0, compound + lex_boost)), 4)

            if compound > 0.15:
                label = "BULLISH"
            elif compound < -0.15:
                label = "BEARISH"
            else:
                label = "NEUTRAL"

            return compound, label
        except Exception as e:
            print(f"Sentiment hatası: {e}")
            return 0.0, "NEUTRAL"

    def _fire_anomaly_trigger(self, entity: str, score: float) -> None:
        """
        Güçlü BIST sinyali geldiğinde Oracle'ı hemen analiz döngüsü başlatması için uyar.
        30 dakika cooldown — Oracle'ı spam'lemez.
        """
        global _LAST_TRIGGER_AT
        if not _ORACLE_URL:
            return
        now = datetime.datetime.utcnow()
        if (_LAST_TRIGGER_AT is not None and
                (now - _LAST_TRIGGER_AT).total_seconds() < _TRIGGER_COOLDOWN_SEC):
            return  # Cooldown aktif
        try:
            _requests.post(f"{_ORACLE_URL}/admin/analyze-now", timeout=3)
            _LAST_TRIGGER_AT = now
            direction = "BULLISH" if score > 0 else "BEARISH"
            print(f"  ⚡ Anomali tetikleyici: {entity} {direction} ({score:+.2f}) → Oracle uyarıldı")
        except Exception as e:
            print(f"  [Trigger] Oracle ulaşılamadı: {e}")

    @staticmethod
    def _entry_published_utc(entry) -> str:
        """RSS entry'nin gerçek yayın zamanı (event_ts) — ISO 8601 UTC.

        Faz 1 (ml v4): eğitimde as-of join için haberin YAYIN zamanı gerekir;
        analiz zamanı ("timestamp" alanı) ingest_ts olarak ayrıca gönderilir.
        feedparser *_parsed alanları UTC struct_time döner. Yoksa şimdiki zaman.
        """
        for attr in ("published_parsed", "updated_parsed"):
            st = entry.get(attr)
            if st:
                try:
                    return datetime.datetime.fromtimestamp(
                        calendar.timegm(st), tz=datetime.timezone.utc
                    ).isoformat()
                except Exception:
                    pass
        return datetime.datetime.now(datetime.timezone.utc).isoformat()

    def fetch_and_analyze(self) -> list[dict]:
        messages = []
        print(f"\n[{datetime.datetime.now().strftime('%H:%M:%S')}] Haberler taranıyor...")

        for source_name, url in RSS_FEEDS.items():
            try:
                feed = feedparser.parse(url)
                # bozuk / boş feed sessizce atlansın (hata yağmuru olmasın)
                if not feed.entries:
                    continue
                # TR kaynaklar için 30, global için 15 entry al.
                # Şirket haberleri feed'in derin kısmında yer alıyor.
                is_tr_source = source_name in SOURCE_WEIGHTS and SOURCE_WEIGHTS[source_name] >= 1.10
                entry_limit = 30 if is_tr_source else 15
                for entry in feed.entries[:entry_limit]:
                    guid = entry.get("id", entry.get("link", ""))
                    if not guid or guid in self.seen_guids:
                        continue
                    self.seen_guids.add(guid)

                    title = getattr(entry, "title", "")
                    summary = getattr(entry, "summary", "")
                    full_text = f"{title}. {summary}"

                    entity, asset_type = self.detect_asset(full_text)
                    # Türkçe kaynaklar için TR-BERT, İngilizce için multilingual model
                    is_tr = is_tr_source
                    compound, sentiment_label = self.analyze_sentiment(full_text, is_tr_source=is_tr)
                    is_geopolitical = self.detect_geopolitical(full_text)

                    # Kaynak güveni: BIST haberi için Türkçe kaynaklar 1.3×,
                    # global/CNBC kaynakları 0.7-0.85×. BIST dışı asset'ler için
                    # ağırlık 1.0 (uygulanmaz).
                    src_weight = SOURCE_WEIGHTS.get(source_name, 1.0)
                    if asset_type == "BIST":
                        weighted = max(-1.0, min(1.0, compound * src_weight))
                    else:
                        weighted = compound  # commodity/macro için kaynak filtrelemesi yok

                    print(f"  [{source_name}] {title[:55]}... → {entity} | {sentiment_label} ({compound:+.2f} → {weighted:+.2f})")

                    # C8 Anomali tetikleyici: Türkçe kaynaktan güçlü BIST sinyali
                    # gelirse Oracle'ı hemen yeni analiz döngüsü başlatması için uyard.
                    # Eşik: |weighted| >= 0.60 ve source_weight >= 1.20 (TR'ye özel)
                    if asset_type == "BIST" and abs(weighted) >= 0.60 and src_weight >= 1.20:
                        self._fire_anomaly_trigger(entity, weighted)

                    messages.append({
                        "source": source_name,
                        "headline": title,
                        "summary": summary[:600],
                        "url": entry.get("link", ""),
                        "entity": entity,
                        "asset_type": asset_type,
                        "sentiment_score": round(weighted, 4),
                        "sentiment_raw":   round(compound, 4),  # ham model çıktısı (debug)
                        "source_weight":   round(src_weight, 2),
                        "sentiment_label": sentiment_label,
                        "is_geopolitical": is_geopolitical,
                        "timestamp": datetime.datetime.utcnow().isoformat(),
                        # ── Faz 1 (ml v4): point-in-time haber deposu alanları ──
                        "guid": guid[:512],                       # dedupe anahtarı
                        "published_at": self._entry_published_utc(entry),  # event_ts
                        "lang": "tr" if is_tr else "en",
                        # ── Faz 3 (ml v4): olay tipolojisi + yenilik ──
                        "event_type": classify_event(full_text),
                        "novelty": NOVELTY.score_and_add(title),
                    })
            except Exception as e:
                print(f"  HATA [{source_name}]: {e}")

        # Eski GUID'leri temizle (bellek sızıntısını önle)
        if len(self.seen_guids) > 5000:
            self.seen_guids = set(list(self.seen_guids)[-2000:])

        # Her döngünün sonunda diske kaydet — restart sonrası dedupe korunur
        self._save_seen_guids()
        NOVELTY.save()   # Faz 3: yenilik belleği de kalıcı

        return messages


# ── KAP (Kamuyu Aydınlatma Platformu) Bildirim Çekici ────────────────────────
# KAP sitesi tamamen client-side rendering yapıyor — doğrudan HTTP ile
# API çağrıları WAF tarafından bloklanıyor. Playwright headless Chromium
# gerçek bir browser gibi sayfayı render edip DOM'dan veriyi çekiyor.
#
# Bildirim tipleri → sentiment yönü:
#   BULLISH: kar/temettü açıklaması, sözleşme, kapasite artışı, rekor satış
#   BEARISH: zarar, uyarı, soruşturma, ortaklık sona erme, üretim durması
#   NEUTRAL: rutin KAP bildirimleri (yönetim değişikliği, genel kurul daveti vb.)

import threading as _threading
import asyncio   as _asyncio

# KAP bildirim türü → (yön_katkısı, ağırlık)
_KAP_TYPE_SIGNALS: dict[str, tuple[float, float]] = {
    # Güçlü pozitif
    "temettü":               (+0.35, 1.5),
    "kar dağıtım":           (+0.35, 1.5),
    "kâr dağıtım":           (+0.35, 1.5),
    "olağanüstü temettü":    (+0.40, 1.6),
    "yeni sözleşme":         (+0.25, 1.3),
    "kapasite artış":        (+0.20, 1.2),
    "rekor":                 (+0.30, 1.4),
    "ihracat artış":         (+0.20, 1.2),
    "sermaye artırım":       (+0.15, 1.1),
    "bedelsiz hisse":        (+0.20, 1.2),
    "kar açıklama":          (+0.25, 1.3),
    "kâr açıklama":          (+0.25, 1.3),
    "büyüme":                (+0.15, 1.1),
    "ihale kazandı":         (+0.25, 1.3),
    # Güçlü negatif
    "zarar":                 (-0.35, 1.5),
    "soruşturma":            (-0.30, 1.4),
    "dava":                  (-0.20, 1.2),
    "uyarı":                 (-0.15, 1.1),
    "görevden":              (-0.20, 1.2),
    "ortaklıktan çıkma":     (-0.20, 1.2),
    "iflas":                 (-0.45, 1.8),
    "üretim dur":            (-0.25, 1.3),
    "faaliyet dur":          (-0.25, 1.3),
    "sözleşme sona":         (-0.20, 1.2),
    "ceza":                  (-0.25, 1.3),
    "borç yapılandırma":     (-0.20, 1.2),
    # Finansal rapor — kendi başına nötr, içerik önemli
    "finansal rapor":        (0.0,   1.0),
    "bilanço":               (0.0,   1.0),
    "çeyrek":                (0.0,   1.0),
    "yıllık rapor":          (0.0,   1.0),
}

# KAP şirket adı → BIST kodu eşleşmesi (sayfa HTML'inden dinamik olarak dolduruluyor)
_KAP_NAME_TO_TICKER: dict[str, str] = {}
_KAP_NAME_MAP_LOCK  = _threading.Lock()

# BIST kodu → KAP şirket adı (ters yönlü arama için)
_KAP_TICKER_MAP_BUILT = False


def _build_kap_name_map(html: str) -> None:
    """
    KAP ana sayfasının HTML'inden şirket adı → BIST ticker eşleşmesini çıkarır.
    Escape edilmiş JSON içinde (\\"stockCode\\":\\"THYAO\\"...\\"kapMemberTitle\\":\\"...\\"
    formatındaki veriyi parse eder.
    """
    global _KAP_TICKER_MAP_BUILT
    import re as _re

    # Örnek: \"stockCode\":\"THYAO\"...\"kapMemberTitle\":\"TÜRK HAVA YOLLARI A.O.\"
    # HTML'de tırnak işaretleri \\\" olarak escape edilmiş
    pairs = _re.findall(
        r'kapMemberTitle\\\":\\\"([^\\]+)\\\".*?stockCode\\\":\\\"([A-Z]{3,8})\\\"',
        html
    )
    if not pairs:
        # Ters sırayla dene
        pairs_rev = _re.findall(
            r'stockCode\\\":\\\"([A-Z]{3,8})\\\".*?kapMemberTitle\\\":\\\"([^\\]+)\\\"',
            html
        )
        pairs = [(title, code) for code, title in pairs_rev]

    with _KAP_NAME_MAP_LOCK:
        for title, code in pairs:
            key = title.lower().strip()
            _KAP_NAME_TO_TICKER[key] = code
            # Kısaltılmış adlar da ekle (A.Ş., A.O., vb. temizlenmiş)
            short = _re.sub(r'\s+(a\.?[şso]\.?|a\.?a\.?|ltd\.?|tic\.?|san\.?|ve?)\s*$', '', key, flags=_re.I).strip()
            if short != key and len(short) > 3:
                _KAP_NAME_TO_TICKER[short] = code

    _KAP_TICKER_MAP_BUILT = bool(pairs)
    if pairs:
        print(f"  [KAP] {len(pairs)} şirket adı→ticker eşleşmesi yüklendi")


def _kap_name_to_ticker(company_name: str) -> str | None:
    """
    KAP'taki şirket adından BIST ticker'ını döndürür.
    Önce tam eşleşme, sonra kısmi/prefix eşleşme dener.
    """
    name_low = company_name.lower().strip()
    with _KAP_NAME_MAP_LOCK:
        # 1. Tam eşleşme
        if name_low in _KAP_NAME_TO_TICKER:
            return _KAP_NAME_TO_TICKER[name_low]
        # 2. Prefix eşleşme (ör. "TAV Havalimanları" → "tav havalimanları holdıng a.ş.")
        for key, ticker in _KAP_NAME_TO_TICKER.items():
            if key.startswith(name_low) or name_low.startswith(key[:min(len(key), 8)]):
                return ticker
    # 3. Fallback: BIST_KEYWORDS sözlüğüne bak
    for kw, ticker in BIST_KEYWORDS.items():
        if kw in name_low:
            return ticker
    return None


class KAPFetcher:
    """
    Playwright Chromium ile KAP bildirim-sorgu sayfasını render eder,
    son bildirimleri çeker ve RabbitMQ'ya göndermek üzere hazırlar.
    Her 30 dakikada bir arka plan thread'inde çalışır.
    """
    CYCLE_MINUTES = 30
    # KAP ana sayfası — "Son Bildirimler" bölümü daha hızlı render olur ve
    # `/tr/Bildirim/{id}` linkleri server-side gelir. `/tr/bildirim-sorgu` ise
    # tamamen client-side React; içerik sadece kullanıcı arama yapınca yüklenir.
    KAP_URL = "https://www.kap.org.tr/tr/"

    def __init__(self, analyzer: "NewsAnalyzer"):
        self.analyzer   = analyzer
        self.seen_ids: set[str] = set()
        self._map_built = False
        print("  [KAP] Playwright KAP çekici hazır (30 dk'da bir çalışır)")

    def _kap_type_boost(self, subject: str, disc_type: str) -> tuple[float, float]:
        """
        Bildirim konusu ve türüne göre sentiment yönü ve kaynak ağırlığı döndürür.
        KAP bildirimleri RSS haberlerinden daha güvenilir (resmi açıklama) → ağırlık ≥ 1.4
        """
        combined = (subject + " " + disc_type).lower()
        boost   = 0.0
        weight  = 1.40   # KAP default: 1.4× (resmi kaynak)

        for kw, (b, w) in _KAP_TYPE_SIGNALS.items():
            if kw in combined:
                boost  += b
                weight  = max(weight, w * 1.2)  # KAP bonus × 1.2

        return round(max(-0.5, min(0.5, boost)), 3), round(min(2.0, weight), 2)

    async def _fetch_async(self) -> list[dict]:
        """
        Playwright ile KAP sayfasını render et ve bildirimleri çek.

        Strateji (sıraya göre denenir):
        1) Network interception — sayfa AJAX/fetch ile JSON çekiyorsa onu yakala.
           KAP'ın iç API yanıtı şirket+tür+tarih içerir; en sağlam yöntem.
        2) DOM tabanlı — sayfada `/tr/Bildirim/{id}` linklerini ve etrafındaki
           text'i parse et. CSS class'ları değişse bile linkler aynı kalır.
        3) Fallback: tablo selektörleri (eski yöntem).

        Audit 04/2026: Eski selektörler (`table tbody tr`) artık 0 sonuç döndürüyordu.
        KAP'ın React arayüzü <table> yerine flex/grid div'leri kullanıyor.
        """
        from playwright.async_api import async_playwright
        import re as _re

        items: list[dict] = []
        captured_json: list = []   # Network'ten yakalanan API yanıtları

        async with async_playwright() as pw:
            browser = await pw.chromium.launch(
                headless=True,
                args=["--no-sandbox", "--disable-dev-shm-usage",
                      "--disable-gpu", "--disable-software-rasterizer"],
            )
            ctx = await browser.new_context(
                locale="tr-TR",
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/122.0.0.0 Safari/537.36"
                ),
            )
            page = await ctx.new_page()

            # ── Strateji 1: Network response interception ────────────────────
            async def _on_response(resp):
                try:
                    url = resp.url.lower()
                    ctype = (resp.headers.get("content-type") or "").lower()
                    if "json" not in ctype:
                        return
                    if not any(k in url for k in ("disclosure", "bildirim", "memberlatest", "kap")):
                        return
                    data = await resp.json()
                    captured_json.append(data)
                except Exception:
                    pass

            page.on("response", lambda r: _asyncio.create_task(_on_response(r)))

            try:
                print("  [KAP] Sayfa yükleniyor...")
                # `networkidle` bazen KAP'ta hiç gerçekleşmiyor (WebSocket/heartbeat).
                # `domcontentloaded` daha güvenilir; içeriği sonradan ek timeout ile bekliyoruz.
                try:
                    await page.goto(self.KAP_URL, wait_until="domcontentloaded", timeout=30000)
                except Exception as ge:
                    print(f"  [KAP] goto uyarısı (devam ediyor): {ge}")

                # Şirket adı-ticker eşleşmesini bir kez yükle
                if not self._map_built:
                    html = await page.content()
                    _build_kap_name_map(html)
                    self._map_built = _KAP_TICKER_MAP_BUILT

                # JS render + AJAX için ek bekleme (5 sn yeterli olmalı)
                await page.wait_for_timeout(5000)

                # ── Strateji 1: Yakalanan JSON yanıtlarını parse et ──────────
                for batch in captured_json:
                    rows = batch if isinstance(batch, list) else (
                        batch.get("disclosures") or batch.get("data") or batch.get("results") or []
                        if isinstance(batch, dict) else []
                    )
                    for row in rows[:80] if isinstance(rows, list) else []:
                        if not isinstance(row, dict):
                            continue
                        # KAP API'sinin yaygın alan adları (varyasyonları dene)
                        company = (row.get("kapMemberTitle") or row.get("memberName")
                                   or row.get("companyName") or row.get("title") or "")
                        subject = (row.get("subject") or row.get("disclosureSubject")
                                   or row.get("summary") or "")
                        dtype   = (row.get("disclosureClass") or row.get("type")
                                   or row.get("category") or "")
                        date    = (row.get("publishDate") or row.get("disclosureDate")
                                   or row.get("date") or "")

                        if not company:
                            continue
                        if not (subject or dtype):
                            continue

                        disc_id = f"kap_{company}_{date}_{subject[:30]}"
                        if disc_id in self.seen_ids:
                            continue
                        self.seen_ids.add(disc_id)

                        ticker = _kap_name_to_ticker(company)
                        if not ticker:
                            continue

                        items.append({
                            "company": company, "ticker": ticker,
                            "subject": subject, "type": dtype, "date": str(date)[:19],
                        })

                if items:
                    print(f"  [KAP] ✓ Network interception ile {len(items)} bildirim yakalandı.")
                    return items

                # ── Strateji 2: DOM'da Bildirim linklerini ara ───────────────
                # Her bildirim sayfasında /tr/Bildirim/{ID} formatında bir link bulunur.
                from bs4 import BeautifulSoup
                html = await page.content()
                soup = BeautifulSoup(html, "html.parser")

                bildirim_links = soup.find_all("a", href=_re.compile(r"/tr/Bildirim/\d+"))
                print(f"  [KAP] DOM'da {len(bildirim_links)} bildirim linki bulundu")

                for link in bildirim_links[:60]:
                    # Link metni genelde "Şirket - Konu" veya benzer formatta
                    link_text = link.get_text(" ", strip=True)
                    if not link_text or len(link_text) < 5:
                        continue

                    # Üst container'ları kontrol et — şirket adı ve tarih genelde
                    # link'in kardeş veya parent div'lerinde olur
                    parent = link.find_parent(["div", "tr", "li"])
                    surrounding = parent.get_text(" | ", strip=True)[:300] if parent else link_text

                    # Şirket adı tespiti — link metni genelde "ŞİRKET BAŞLIK" başlar
                    # Önce surroundingdan bilinen şirket adını ara
                    company = ""
                    for nm in list(_KAP_NAME_TO_TICKER.keys())[:200]:  # ilk 200 ile hızlı match
                        if nm in surrounding:
                            company = nm
                            break
                    # Bulamadıysa, yine de işaretli ticker'ı bul
                    ticker = _kap_name_to_ticker(company) if company else _kap_name_to_ticker(link_text)
                    if not ticker:
                        # Yaygın olmayan şirketler atlanır
                        continue

                    # Tarih tespiti
                    date_match = _re.search(r"(\d{2}\.\d{2}\.\d{4}|\d{4}-\d{2}-\d{2})", surrounding)
                    date_val = date_match.group(1) if date_match else ""

                    subject = link_text[:200]
                    disc_id = f"kap_{ticker}_{date_val}_{subject[:30]}"
                    if disc_id in self.seen_ids:
                        continue
                    self.seen_ids.add(disc_id)

                    items.append({
                        "company": company or ticker,
                        "ticker":  ticker,
                        "subject": subject,
                        "type":    "",
                        "date":    date_val,
                    })

                if items:
                    print(f"  [KAP] ✓ DOM link parse ile {len(items)} bildirim yakalandı.")
                    return items

                # ── Strateji 3: Tablolar (eski yöntem, fallback) ─────────────
                tables = soup.find_all("table")
                if tables:
                    print(f"  [KAP] Fallback: {len(tables)} tablo deneniyor")
                    for table in tables:
                        for row in table.find_all("tr")[1:51]:
                            cells = row.find_all(["td", "th"])
                            if len(cells) < 3:
                                continue
                            cell_texts = [c.get_text(strip=True) for c in cells]
                            # İlk hücre şirket varsayımı
                            company_val = cell_texts[0]
                            subject_val = cell_texts[1] if len(cell_texts) > 1 else ""
                            ticker = _kap_name_to_ticker(company_val)
                            if not ticker or not subject_val:
                                continue
                            disc_id = f"kap_{ticker}_{subject_val[:30]}"
                            if disc_id in self.seen_ids:
                                continue
                            self.seen_ids.add(disc_id)
                            items.append({
                                "company": company_val, "ticker": ticker,
                                "subject": subject_val,
                                "type": cell_texts[2] if len(cell_texts) > 2 else "",
                                "date": "",
                            })

                if not items:
                    print("  [KAP] ✗ Hiçbir strateji bildirim üretmedi (KAP yapısı değişmiş olabilir).")

            except Exception as e:
                print(f"  [KAP] Render hatası: {e}")
            finally:
                await browser.close()

        return items

    def fetch(self) -> list[dict]:
        """Senkron wrapper — ana thread'den çağrılabilir."""
        try:
            loop = _asyncio.new_event_loop()
            _asyncio.set_event_loop(loop)
            return loop.run_until_complete(self._fetch_async())
        except Exception as e:
            print(f"  [KAP] fetch() hatası: {e}")
            return []
        finally:
            try:
                loop.close()
            except Exception:
                pass

    def process_disclosures(self, disclosures: list[dict]) -> list[dict]:
        """
        KAP bildirimlerini sentiment pipeline'a dönüştürür.
        KAP = resmi açıklama → kaynak ağırlığı 1.4-2.0× (RSS'ten çok daha güvenilir).
        """
        messages = []
        for d in disclosures:
            subject  = d.get("subject", "")
            dtype    = d.get("type", "")
            ticker   = d.get("ticker", "")
            company  = d.get("company", "")

            # Bildirim türü boost (temettü, zarar, sözleşme vb.)
            type_boost, src_weight = self._kap_type_boost(subject, dtype)

            # Türkçe BERT ile sentiment
            full_text = f"{company} - {subject}. {dtype}"
            compound, sentiment_label = self.analyzer.analyze_sentiment(
                full_text, is_tr_source=True
            )

            # Type boost ekle
            compound = round(max(-1.0, min(1.0, compound + type_boost)), 4)
            if compound > 0.15:
                sentiment_label = "BULLISH"
            elif compound < -0.15:
                sentiment_label = "BEARISH"
            else:
                sentiment_label = "NEUTRAL"

            weighted = round(max(-1.0, min(1.0, compound * src_weight)), 4)

            print(f"  [KAP] {ticker} | {subject[:50]}... → {sentiment_label} ({compound:+.2f} → {weighted:+.2f})")

            # Anomali tetikleyici: güçlü KAP sinyali → Oracle'ı hemen uyar
            if abs(weighted) >= 0.55:
                self.analyzer._fire_anomaly_trigger(ticker, weighted)

            messages.append({
                "source":           "KAP Bildirimleri",
                "headline":         f"[KAP] {company}: {subject}",
                "summary":          f"Bildirim türü: {dtype}. {subject}",
                "url":              KAPFetcher.KAP_URL,
                "entity":           ticker,
                "asset_type":       "BIST",
                "sentiment_score":  weighted,
                "sentiment_raw":    compound,
                "source_weight":    src_weight,
                "sentiment_label":  sentiment_label,
                "is_geopolitical":  False,
                "timestamp":        datetime.datetime.utcnow().isoformat(),
                # ── Faz 1 (ml v4): KAP scrape anlık olduğundan event_ts ≈ şimdi ──
                "guid":             f"kap:{ticker}:{subject}"[:512],
                "published_at":     datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "lang":             "tr",
                # ── Faz 3 (ml v4): olay tipolojisi + yenilik ──
                "event_type":       classify_event(full_text),
                "novelty":          NOVELTY.score_and_add(f"{company} {subject}"),
            })

        return messages


def connect_rabbitmq() -> pika.BlockingConnection:
    host = os.environ.get("RABBITMQ_HOST", "localhost")
    for attempt in range(15):
        try:
            # heartbeat=0: feedparser veya transformer model ağır olabilir;
            # kopma kontrolünü _ensure_connection() ile yapıyoruz.
            conn = pika.BlockingConnection(
                pika.ConnectionParameters(host=host, heartbeat=0, blocked_connection_timeout=300)
            )
            print(f"RabbitMQ bağlantısı kuruldu: {host}")
            return conn
        except Exception as e:
            print(f"RabbitMQ bekleniyor ({attempt + 1}/15): {e}")
            time.sleep(5)
    raise RuntimeError("RabbitMQ'ya bağlanılamadı")


# Global tutucular — uzun döngülerde bağlantı kopması olursa yeniden kurulur
_CONN: pika.BlockingConnection | None = None
_CHANNEL = None


def _ensure_connection() -> bool:
    """RabbitMQ bağlantısı kapanmışsa yeniden kurar."""
    global _CONN, _CHANNEL
    try:
        if _CONN is not None and _CONN.is_open and _CHANNEL is not None and _CHANNEL.is_open:
            return True
    except Exception:
        pass

    print("[RabbitMQ] Bağlantı kapalı, yeniden kuruluyor...")
    try:
        if _CONN is not None:
            try:
                _CONN.close()
            except Exception:
                pass
        _CONN = connect_rabbitmq()
        _CHANNEL = _CONN.channel()
        _CHANNEL.queue_declare(queue="news.analyzed", durable=True)
        print("[RabbitMQ] ✓ Yeniden bağlanıldı.")
        return True
    except Exception as e:
        print(f"[RabbitMQ] Yeniden bağlanma başarısız: {e}")
        _CHANNEL = None
        return False


def _publish_items(items: list[dict]) -> int:
    """Verilen item listesini RabbitMQ'ya gönderir, gönderilen sayıyı döner."""
    published = 0
    for item in items:
        if not _ensure_connection():
            print("  Yayımlama atlandı: RabbitMQ bağlantısı yok")
            break
        _CHANNEL.basic_publish(
            exchange="",
            routing_key="news.analyzed",
            body=json.dumps(item, ensure_ascii=False),
            properties=pika.BasicProperties(
                delivery_mode=2,
                content_type="application/json",
            ),
        )
        published += 1
    return published


def main():
    print("SerInvest Haber Analiz Motoru başlatılıyor...")
    # Docker ağ DNS'inin tamamen hazırlanması için kısa bekleme
    time.sleep(8)
    if not _ensure_connection():
        raise RuntimeError("İlk RabbitMQ bağlantısı kurulamadı")

    analyzer = NewsAnalyzer()
    kap_fetcher = KAPFetcher(analyzer)

    # ── KAP Arka Plan Döngüsü (her 30 dakikada bir) ───────────────────────────
    def kap_loop():
        # İlk çalışmayı RSS'in ilk taramasından sonraya ertele
        time.sleep(30)
        while True:
            try:
                print("[KAP] Bildirim taraması başlıyor...")
                disclosures = kap_fetcher.fetch()
                if disclosures:
                    messages = kap_fetcher.process_disclosures(disclosures)
                    published = _publish_items(messages)
                    print(f"[KAP] {published}/{len(messages)} bildirim kuyruğa gönderildi.")
                else:
                    print("[KAP] Yeni bildirim bulunamadı.")
            except Exception as e:
                print(f"[KAP] Döngü hatası: {e}")
            time.sleep(KAPFetcher.CYCLE_MINUTES * 60)

    kap_thread = _threading.Thread(target=kap_loop, daemon=True, name="kap-fetcher")
    kap_thread.start()
    print(f"[KAP] Arka plan iş parçacığı başlatıldı (her {KAPFetcher.CYCLE_MINUTES} dakikada bir).")

    # ── Ana RSS Döngüsü ────────────────────────────────────────────────────────
    try:
        while True:
            news_list = analyzer.fetch_and_analyze()
            published = _publish_items(news_list)
            print(f"  {published}/{len(news_list)} haber kuyruğa gönderildi.")
            print("Bir sonraki tarama 3 dakika sonra...")
            time.sleep(180)
    except KeyboardInterrupt:
        print("Durduruluyor...")
    finally:
        try:
            if _CONN is not None:
                _CONN.close()
        except Exception:
            pass


if __name__ == "__main__":
    main()
