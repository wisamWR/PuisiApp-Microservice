FROM node:24.22.2-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY contracts /app/contracts
COPY libs/node/package*.json /app/libs/node/
RUN cd /app/libs/node && npm install --omit=dev --no-audit --no-fund
COPY libs/node/src /app/libs/node/src
COPY libs/node/sql /app/libs/node/sql
COPY services/mood-feed-service/package.json /app/services/mood-feed-service/
RUN cd /app/services/mood-feed-service && npm install --omit=dev --no-audit --no-fund
COPY services/mood-feed-service /app/services/mood-feed-service
WORKDIR /app/services/mood-feed-service
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:8080/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "src/index.js"]
