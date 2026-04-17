FROM python:3.11-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1
ENV TRANSFORMERS_CACHE=/app/.cache

COPY requirements.txt .

# Install CPU-only torch (much smaller than full torch ~700MB vs ~2.5GB)
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu && \
    pip install --no-cache-dir -r requirements.txt

# Pre-download the multilingual sentiment model at build time so container starts fast
RUN python -c "\
from transformers import pipeline; \
print('Downloading multilingual sentiment model...'); \
pipeline('sentiment-analysis', model='lxyuan/distilbert-base-multilingual-cased-sentiments-student', device=-1); \
print('Model cached successfully.')"

ENV TRANSFORMERS_OFFLINE=1

COPY . .

CMD ["python", "main.py"]
