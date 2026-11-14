FROM node:24.22.2-alpine

ENV NODE_ENV=production

WORKDIR /app

COPY contracts /app/contracts

COPY libs/node/package.json libs/node/package-lock.json /app/libs/node/
RUN cd /app/libs/node && npm ci --omit=dev --no-audit --no-fund

COPY libs/node/src /app/libs/node/src
COPY libs/node/sql /app/libs/node/sql

COPY services/_template-node/package.json services/_template-node/package-lock.json /app/services/_template-node/
RUN cd /app/services/_template-node && npm ci --omit=dev --no-audit --no-fund

COPY services/_template-node /app/services/_template-node

WORKDIR /app/services/_template-node

USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:8080/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "src/main.js"]