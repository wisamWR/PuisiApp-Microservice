# Build context = root repositori (lihat infra/compose/contoh.yml), karena
# image membutuhkan contracts/ dan libs/node/ di samping kode layanan.
# Struktur folder di image sama dengan repositori supaya pustaka menemukan
# /app/contracts tanpa konfigurasi tambahan.
FROM node:24.22.2-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY contracts /app/contracts

COPY libs/node/package.json libs/node/package-lock.json /app/libs/node/
RUN cd /app/libs/node && npm ci --omit=dev --no-audit --no-fund
COPY libs/node/src /app/libs/node/src
COPY libs/node/sql /app/libs/node/sql

COPY services/example-consumer/package.json services/example-consumer/package-lock.json /app/services/example-consumer/
RUN cd /app/services/example-consumer && npm ci --omit=dev --no-audit --no-fund
COPY services/example-consumer /app/services/example-consumer

WORKDIR /app/services/example-consumer
USER node
EXPOSE 8080
CMD ["node", "src/index.js"]
