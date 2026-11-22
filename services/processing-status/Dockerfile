# Build context = root repositori (lihat infra/compose/poem.yml).
# Satu image, dua entrypoint: processing-tracker (src/tracker.js) dan
# status-stream-service (src/stream.js).
FROM node:24.22.2-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY contracts /app/contracts

COPY libs/node/package.json libs/node/package-lock.json /app/libs/node/
RUN cd /app/libs/node && npm ci --omit=dev --no-audit --no-fund
COPY libs/node/src /app/libs/node/src
COPY libs/node/sql /app/libs/node/sql

COPY services/poem-common/package.json services/poem-common/package-lock.json /app/services/poem-common/
RUN cd /app/services/poem-common && npm ci --omit=dev --no-audit --no-fund
COPY services/poem-common/src /app/services/poem-common/src

COPY services/processing-status/package.json services/processing-status/package-lock.json /app/services/processing-status/
RUN cd /app/services/processing-status && npm ci --omit=dev --no-audit --no-fund
COPY services/processing-status/src /app/services/processing-status/src

WORKDIR /app/services/processing-status
USER node
EXPOSE 8080
CMD ["node", "src/stream.js"]
