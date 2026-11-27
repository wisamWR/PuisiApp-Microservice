FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=8080

WORKDIR /app

COPY contracts /app/contracts
COPY libs/node/package*.json /app/libs/node/
RUN cd /app/libs/node && npm install --omit=dev --no-audit --no-fund
COPY libs/node/src /app/libs/node/src
COPY libs/node/sql /app/libs/node/sql

COPY services/theme-feed-service/package*.json /app/services/theme-feed-service/
RUN cd /app/services/theme-feed-service && npm install --omit=dev --no-audit --no-fund

COPY services/theme-feed-service/src /app/services/theme-feed-service/src

WORKDIR /app/services/theme-feed-service

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/health || exit 1

CMD ["node", "src/index.js"]
