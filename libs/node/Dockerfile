# Image alat bersama dari libs/node (build context = root repositori):
#   - bin/pasang-topologi.js : topologi RabbitMQ dari contracts/routing.json (default)
#   - bin/relay-polling.js   : relay outbox cadangan bila Debezium tidak dipakai
FROM node:24.22.2-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY contracts /app/contracts
COPY libs/node/package.json libs/node/package-lock.json /app/libs/node/
RUN cd /app/libs/node && npm ci --omit=dev --no-audit --no-fund
COPY libs/node/src /app/libs/node/src
COPY libs/node/sql /app/libs/node/sql
COPY libs/node/bin /app/libs/node/bin

WORKDIR /app/libs/node
USER node
CMD ["node", "bin/pasang-topologi.js"]
