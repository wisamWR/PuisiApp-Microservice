FROM node:24.22.2-alpine

WORKDIR /app

COPY contracts ./contracts

COPY libs/node/package.json ./libs/node/package.json
COPY libs/node/package-lock.json ./libs/node/package-lock.json
RUN cd libs/node && npm ci --omit=dev

COPY libs/node/src ./libs/node/src
COPY libs/node/sql ./libs/node/sql

COPY services/bookmark-service/package.json ./services/bookmark-service/package.json

RUN cd services/bookmark-service && npm install --omit=dev

COPY services/bookmark-service ./services/bookmark-service

WORKDIR /app/services/bookmark-service

ENV NODE_ENV=production

USER node

EXPOSE 8080

CMD ["node", "src/index.js"]
