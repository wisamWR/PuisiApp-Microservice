FROM node:22-alpine

ENV NODE_ENV=production

WORKDIR /app

COPY contracts /app/contracts

COPY libs/node/package.json libs/node/package-lock.json /app/libs/node/
RUN cd /app/libs/node && npm ci --omit=dev --no-audit --no-fund

COPY libs/node/src /app/libs/node/src
COPY libs/node/sql /app/libs/node/sql

COPY services/account-recovery-service/package.json /app/services/account-recovery-service/
RUN cd /app/services/account-recovery-service && npm install --omit=dev --no-audit --no-fund

COPY services/account-recovery-service /app/services/account-recovery-service

WORKDIR /app/services/account-recovery-service

USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "src/main.js"]
