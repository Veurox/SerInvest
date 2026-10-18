# =============================================================================
# SerInvest arayüzü — üç aşama (18.10.2026)
#
# Eskiden günlük kullanımda da Vite GELİŞTİRME sunucusu çalışıyordu; Windows
# bind-mount'ta dosya izleme yoklamayla yapıldığı için konteyner boştayken
# sürekli ~%13 işlemci yakıyordu (fan, pil).
#
#   dev   — HMR ile geliştirme. docker-compose.dev.yml bu aşamayı seçer.
#   build — üretim derlemesi (tsc + vite build).
#   prod  — derlenmiş statik site, nginx. docker-compose.yml VARSAYILANI.
#
# Yönetici anahtarı derleme anında koda gömülür (Vite import.meta.env) —
# geliştirme sunucusunda da aynısı oluyordu. Port yalnız 127.0.0.1'e açık.
# =============================================================================

FROM node:22-alpine AS dev
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "3000"]

FROM dev AS build
ARG VITE_ADMIN_API_KEY
ENV VITE_ADMIN_API_KEY=$VITE_ADMIN_API_KEY
RUN npm run build

FROM nginx:1.27-alpine AS prod
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 3000
