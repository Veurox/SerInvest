FROM python:3.11-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1

# LightGBM için OpenMP runtime gerekli
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /app/models

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["python", "main.py"]
