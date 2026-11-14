# Build context = root repositori (sama dengan register-service): butuh contracts/ dan libs/node/.
FROM node:24.22.2-alpine

ENV NODE_ENV=production \
    SERVICE_NAME=token-service \
    PORT=8080
WORKDIR /app

COPY contracts /app/contracts

COPY libs/node/package.json libs/node/package-lock.json /app/libs/node/
RUN cd /app/libs/node && npm ci --omit=dev --no-audit --no-fund
COPY libs/node/src /app/libs/node/src
COPY libs/node/sql /app/libs/node/sql

COPY services/token-service/package.json services/token-service/package-lock.json /app/services/token-service/
RUN cd /app/services/token-service && npm ci --omit=dev --no-audit --no-fund
COPY services/token-service /app/services/token-service

WORKDIR /app/services/token-service
USER node
EXPOSE 8080
CMD ["node", "src/index.js"]
