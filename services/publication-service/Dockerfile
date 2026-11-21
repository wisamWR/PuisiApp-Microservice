# Build context = root repositori (lihat infra/compose/poem.yml).
FROM node:24.22.2-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY contracts /app/contracts

COPY libs/node/package.json libs/node/package-lock.json /app/libs/node/
RUN cd /app/libs/node && npm ci --omit=dev --no-audit --no-fund
COPY libs/node/src /app/libs/node/src
COPY libs/node/sql /app/libs/node/sql

COPY services/publication-service/package.json services/publication-service/package-lock.json /app/services/publication-service/
RUN cd /app/services/publication-service && npm ci --omit=dev --no-audit --no-fund
COPY services/publication-service/src /app/services/publication-service/src
COPY services/publication-service/migrations /app/services/publication-service/migrations
COPY services/publication-service/scripts /app/services/publication-service/scripts

WORKDIR /app/services/publication-service
USER node
EXPOSE 8080
CMD ["node", "src/index.js"]
