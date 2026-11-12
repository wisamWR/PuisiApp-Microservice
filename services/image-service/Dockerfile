# image-service: satu image, dua entrypoint (laporan Bab 14.1)
#   image-preview-service : node src/preview.js
#   image-render-worker   : node src/render-worker.js
# Build context = root repositori.
FROM node:24.22.2-alpine

# Font untuk teks gambar kutipan (template memakai DejaVu Serif dan DejaVu Sans).
RUN apk add --no-cache fontconfig font-dejavu && fc-cache -f

ENV NODE_ENV=production
WORKDIR /app

COPY contracts /app/contracts

COPY libs/node/package.json libs/node/package-lock.json /app/libs/node/
RUN cd /app/libs/node && npm ci --omit=dev --no-audit --no-fund
COPY libs/node/src /app/libs/node/src
COPY libs/node/sql /app/libs/node/sql

COPY services/image-service/package.json services/image-service/package-lock.json /app/services/image-service/
RUN cd /app/services/image-service && npm ci --omit=dev --no-audit --no-fund
COPY services/image-service/src /app/services/image-service/src
COPY services/image-service/assets /app/services/image-service/assets

WORKDIR /app/services/image-service
USER node
EXPOSE 8080
CMD ["node", "src/preview.js"]
