FROM node:24-alpine

ENV NODE_ENV=production \
    PORT=8080

WORKDIR /app

COPY services/_template-node/package*.json ./

RUN npm ci --omit=dev \
    && npm cache clean --force

COPY services/_template-node/src ./src
COPY services/_template-node/migrations ./migrations

RUN addgroup -S appgroup \
    && adduser -S appuser -G appgroup \
    && chown -R appuser:appgroup /app

USER appuser

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:8080/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "src/main.js"]
