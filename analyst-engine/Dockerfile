FROM python:3.11-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1
ENV TRANSFORMERS_CACHE=/app/.cache
ENV PLAYWRIGHT_BROWSERS_PATH=/app/.playwright

COPY requirements.txt .

# Install CPU-only torch (much smaller than full torch ~700MB vs ~2.5GB)
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu && \
    pip install --no-cache-dir -r requirements.txt

# Playwright Chromium + sistem bağımlılıkları
# KAP (Kamuyu Aydınlatma Platformu) client-side rendered — headless browser zorunlu
RUN playwright install chromium --with-deps

# Pre-download sentiment models at build time so container starts fast
# 1) Çok dilli DistilBERT — İngilizce/global haberler için
# 2) Türkçe BERT — Türkçe finansal haberler için (BIST duyarlılığı çok daha iyi)
RUN python -c "\
from transformers import pipeline; \
print('Downloading multilingual sentiment model...'); \
pipeline('sentiment-analysis', model='lxyuan/distilbert-base-multilingual-cased-sentiments-student', device=-1); \
print('Downloading Turkish sentiment model...'); \
pipeline('sentiment-analysis', model='savasy/bert-base-turkish-sentiment-cased', top_k=None, device=-1); \
print('Both models cached successfully.')"

ENV TRANSFORMERS_OFFLINE=1

COPY . .

CMD ["python", "main.py"]
