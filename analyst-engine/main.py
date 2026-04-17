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
import time
import datetime
import os
import feedparser
from transformers import pipeline as hf_pipeline

# ── BIST Ticker Sözlüğü ────────────────────────────────────────────────────────
BIST_KEYWORDS = {
    "thyao": "THYAO", "türk hava": "THYAO", "turkish airlines": "THYAO", "thy ": "THYAO",
    "garan": "GARAN", "garanti bankası": "GARAN", "garanti bank": "GARAN",
    "akbnk": "AKBNK", "akbank": "AKBNK",
    "eregl": "EREGL", "erdemir": "EREGL",
    "sise": "SISE", "şişecam": "SISE", "sisecam": "SISE",
    "kchol": "KCHOL", "koç holding": "KCHOL", "koc holding": "KCHOL",
    "arclk": "ARCLK", "arçelik": "ARCLK", "arcelik": "ARCLK",
    "bimas": "BIMAS", "bim mağaza": "BIMAS",
    "asels": "ASELS", "aselsan": "ASELS",
    "froto": "FROTO", "ford otosan": "FROTO",
    "tuprs": "TUPRS", "tüpraş": "TUPRS", "tupras": "TUPRS",
    "sasa": "SASA", "sasa polyester": "SASA",
    "sahol": "SAHOL", "sabancı holding": "SAHOL", "sabanci": "SAHOL",
    "ttkom": "TTKOM", "türk telekom": "TTKOM", "turk telekom": "TTKOM",
    "tcell": "TCELL", "turkcell": "TCELL",
    "pgsus": "PGSUS", "pegasus": "PGSUS",
    "mgros": "MGROS", "migros": "MGROS",
    "ekgyo": "EKGYO", "emlak gyo": "EKGYO", "emlak konut": "EKGYO",
    "halkb": "HALKB", "halkbank": "HALKB",
    "vakbn": "VAKBN", "vakıfbank": "VAKBN", "vakifbank": "VAKBN",
    "ykbnk": "YKBNK", "yapı kredi": "YKBNK", "yapi kredi": "YKBNK",
    "petkm": "PETKM", "petkim": "PETKM",
    "krdmd": "KRDMD", "kardemir": "KRDMD",
    "dohol": "DOHOL", "doğan holding": "DOHOL", "dogan holding": "DOHOL",
    "ccola": "CCOLA", "coca-cola içecek": "CCOLA",
    "isctr": "ISCTR", "iş bankası": "ISCTR", "isbank": "ISCTR",
    "toaso": "TOASO", "tofaş": "TOASO", "tofas": "TOASO",
    "vestl": "VESTL", "vestel": "VESTL",
}

COMMODITY_KEYWORDS = {
    "gold": "XAUUSD", "altın": "XAUUSD", "xau": "XAUUSD", "gold price": "XAUUSD",
    "silver": "XAGUSD", "gümüş": "XAGUSD", "xag": "XAGUSD",
    "oil": "BRENTOIL", "petrol": "BRENTOIL", "brent": "BRENTOIL", "crude": "BRENTOIL",
    "natural gas": "NATGAS", "doğalgaz": "NATGAS", "natural gas": "NATGAS",
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
    # Türkçe Kaynaklar
    "AA Ekonomi":        "https://www.aa.com.tr/tr/rss/default?cat=ekonomi",
    "Bloomberg HT":      "https://www.bloomberght.com/rss",
    "Dünya Gazetesi":    "https://www.dunya.com/rss/dunya_gunceli.xml",
    "Investing.com TR":  "https://tr.investing.com/rss/news_25.rss",
    # İngilizce Kaynaklar
    "CNBC Economy":      "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258",
    "CNBC Markets":      "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=15839069",
    "CNBC World":        "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100727362",
    "Investing.com Comm":"https://tr.investing.com/rss/news_11.rss",
    "MarketWatch":       "https://feeds.content.dowjones.io/public/rss/mw_realtimeheadlines",
}

JEOPOLITIK_KEYWORDS = [
    "war", "savaş", "conflict", "çatışma", "sanction", "yaptırım",
    "geopolitic", "jeopolitik", "nato", "un security", "bm güvenlik",
    "election", "seçim", "government", "hükümet", "central bank", "merkez",
    "crisis", "kriz", "recession", "durgunluk", "gdp", "büyüme",
    "inflation", "enflasyon", "interest rate", "faiz",
    "fed meeting", "fomc", "tcmb toplantı",
]


class NewsAnalyzer:
    def __init__(self):
        print("Çok dilli duygu analizi modeli yükleniyor...")
        self.sentiment = hf_pipeline(
            "sentiment-analysis",
            model="lxyuan/distilbert-base-multilingual-cased-sentiments-student",
            top_k=None,
            device=-1,
        )
        self.seen_guids: set[str] = set()
        print("Model başarıyla yüklendi.")

    def detect_asset(self, text: str) -> tuple[str, str]:
        text_lower = text.lower()

        for kw, ticker in BIST_KEYWORDS.items():
            if kw in text_lower:
                return ticker, "BIST"

        for kw, asset in COMMODITY_KEYWORDS.items():
            if kw in text_lower:
                return asset, "COMMODITY"

        for kw, asset in MACRO_KEYWORDS.items():
            if kw in text_lower:
                return asset, "MACRO"

        return "GLOBAL", "GENERAL"

    def detect_geopolitical(self, text: str) -> bool:
        text_lower = text.lower()
        return any(kw in text_lower for kw in JEOPOLITIK_KEYWORDS)

    def analyze_sentiment(self, text: str) -> tuple[float, str]:
        try:
            results = self.sentiment(text[:512])[0]
            scores = {r["label"].lower(): r["score"] for r in results}
            compound = scores.get("positive", 0) - scores.get("negative", 0)
            compound = round(compound, 4)

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

    def fetch_and_analyze(self) -> list[dict]:
        messages = []
        print(f"\n[{datetime.datetime.now().strftime('%H:%M:%S')}] Haberler taranıyor...")

        for source_name, url in RSS_FEEDS.items():
            try:
                feed = feedparser.parse(url)
                for entry in feed.entries[:8]:
                    guid = entry.get("id", entry.get("link", ""))
                    if not guid or guid in self.seen_guids:
                        continue
                    self.seen_guids.add(guid)

                    title = getattr(entry, "title", "")
                    summary = getattr(entry, "summary", "")
                    full_text = f"{title}. {summary}"

                    entity, asset_type = self.detect_asset(full_text)
                    compound, sentiment_label = self.analyze_sentiment(full_text)
                    is_geopolitical = self.detect_geopolitical(full_text)

                    print(f"  [{source_name}] {title[:55]}... → {entity} | {sentiment_label} ({compound:+.2f})")

                    messages.append({
                        "source": source_name,
                        "headline": title,
                        "summary": summary[:600],
                        "url": entry.get("link", ""),
                        "entity": entity,
                        "asset_type": asset_type,
                        "sentiment_score": compound,
                        "sentiment_label": sentiment_label,
                        "is_geopolitical": is_geopolitical,
                        "timestamp": datetime.datetime.utcnow().isoformat(),
                    })
            except Exception as e:
                print(f"  HATA [{source_name}]: {e}")

        # Eski GUID'leri temizle (bellek sızıntısını önle)
        if len(self.seen_guids) > 5000:
            self.seen_guids = set(list(self.seen_guids)[-2000:])

        return messages


def connect_rabbitmq() -> pika.BlockingConnection:
    host = os.environ.get("RABBITMQ_HOST", "localhost")
    for attempt in range(15):
        try:
            conn = pika.BlockingConnection(
                pika.ConnectionParameters(host=host, heartbeat=600, blocked_connection_timeout=300)
            )
            print(f"RabbitMQ bağlantısı kuruldu: {host}")
            return conn
        except pika.exceptions.AMQPConnectionError:
            print(f"RabbitMQ hazır değil, tekrar deneniyor ({attempt + 1}/15)...")
            time.sleep(5)
    raise RuntimeError("RabbitMQ'ya bağlanılamadı")


def main():
    print("SerInvest Haber Analiz Motoru başlatılıyor...")
    conn = connect_rabbitmq()
    channel = conn.channel()
    channel.queue_declare(queue="news.analyzed", durable=True)

    analyzer = NewsAnalyzer()

    try:
        while True:
            news_list = analyzer.fetch_and_analyze()
            for item in news_list:
                channel.basic_publish(
                    exchange="",
                    routing_key="news.analyzed",
                    body=json.dumps(item, ensure_ascii=False),
                    properties=pika.BasicProperties(
                        delivery_mode=2,
                        content_type="application/json",
                    ),
                )
            print(f"  {len(news_list)} haber kuyruğa gönderildi.")
            print("Bir sonraki tarama 3 dakika sonra...")
            time.sleep(180)
    except KeyboardInterrupt:
        print("Durduruluyor...")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
