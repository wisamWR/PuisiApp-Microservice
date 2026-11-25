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

COPY services/authorship-query-service/package.json /app/services/authorship-query-service/
WORKDIR /app/services/authorship-query-service
RUN npm install --omit=dev --no-audit --no-fund

COPY services/authorship-query-service/src ./src
COPY services/authorship-query-service/migrations ./migrations

USER node
EXPOSE 8080
CMD ["node", "src/index.js"]
