# Build context = root repositori (lihat infra/compose/poem.yml).
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

COPY services/poem-query-service/package.json services/poem-query-service/package-lock.json /app/services/poem-query-service/
RUN cd /app/services/poem-query-service && npm ci --omit=dev --no-audit --no-fund
COPY services/poem-query-service/src /app/services/poem-query-service/src
COPY services/poem-query-service/migrations /app/services/poem-query-service/migrations
COPY services/poem-query-service/scripts /app/services/poem-query-service/scripts

WORKDIR /app/services/poem-query-service
USER node
EXPOSE 8080
CMD ["node", "src/index.js"]
