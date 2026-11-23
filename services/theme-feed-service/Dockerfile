FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=8080

WORKDIR /app

COPY libs/node /app/libs/node
COPY services/theme-feed-service/package.json /app/services/theme-feed-service/package.json
WORKDIR /app/services/theme-feed-service
RUN npm install --omit=dev

COPY services/theme-feed-service/src /app/services/theme-feed-service/src

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/health || exit 1

CMD ["node", "src/index.js"]
