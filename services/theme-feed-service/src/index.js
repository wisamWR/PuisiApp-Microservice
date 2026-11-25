import { buatLogger, buatStorePg, buatStoreTanpaDb, hubungkan } from '@puisiapp/events';
import pg from 'pg';
import { createClient } from 'redis';
import { CircuitBreaker } from './circuit-breaker.js';
import { buatServerHttp } from './http.js';
import { buatIndeksTema } from './indeks-tema.js';
import { mulaiKonsumenThemeFeed } from './konsumen-event.js';

const log = buatLogger(process.env.SERVICE_NAME || 'theme-feed');
const port = Number.parseInt(process.env.PORT || '8080', 10);
const redisUrl =
  process.env.REDIS_URL ||
  `redis://${process.env.REDIS_HOST || 'redis'}:${process.env.REDIS_PORT || '6379'}`;

// Mekanisme Retry dengan Exponential Backoff pada koneksi Redis
const redis = createClient({
  url: redisUrl,
  password: process.env.REDIS_PASSWORD || undefined,
  socket: {
    connectTimeout: 3000,
    reconnectStrategy(retries) {
      const delay = Math.min(retries * 200, 3000);
      log.warn('mencoba menyambung ulang Redis (retry)', { retries, delayMs: delay });
      return delay;
    },
  },
});
redis.on('error', (err) => log.error('galat koneksi Redis', { err }));
await redis.connect();

const circuitBreaker = new CircuitBreaker({
  nama: 'redis-theme-feed',
  errorThreshold: Number.parseInt(process.env.CB_ERROR_THRESHOLD || '3', 10),
  resetTimeoutMs: Number.parseInt(process.env.CB_RESET_TIMEOUT_MS || '5000', 10),
});

const indeksTema = buatIndeksTema(redis);
const server = buatServerHttp({ indeksTema, circuitBreaker });

server.listen(port, '0.0.0.0', () => {
  log.info('theme-feed HTTP aktif dengan Circuit Breaker', { port });
});

let pgPool = null;
let store = null;
if (process.env.DATABASE_URL) {
  pgPool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  store = buatStorePg(pgPool);
}

try {
  const koneksi = await hubungkan({ log });
  await mulaiKonsumenThemeFeed({
    koneksi,
    store: store || buatStoreTanpaDb(),
    indeksTema,
    log,
    prefetch: Number.parseInt(process.env.PREFETCH || '10', 10),
  });
} catch (err) {
  log.warn('konsumen RabbitMQ belum terhubung saat start awal', { err });
}
