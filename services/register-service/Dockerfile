# Build context = root repositori (sama dengan example-consumer): butuh contracts/ dan libs/node/.
FROM node:24.22.2-alpine

ENV NODE_ENV=production \
    SERVICE_NAME=register-service \
    PORT=3000
WORKDIR /app

COPY contracts /app/contracts

COPY libs/node/package.json libs/node/package-lock.json /app/libs/node/
RUN cd /app/libs/node && npm ci --omit=dev --no-audit --no-fund
COPY libs/node/src /app/libs/node/src
COPY libs/node/sql /app/libs/node/sql

COPY services/register-service/package.json services/register-service/package-lock.json /app/services/register-service/
RUN cd /app/services/register-service && npm ci --omit=dev --no-audit --no-fund
COPY services/register-service /app/services/register-service

WORKDIR /app/services/register-service
USER node
EXPOSE 3000
CMD ["node", "src/index.js"]
