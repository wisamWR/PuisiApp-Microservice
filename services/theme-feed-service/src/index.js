import { buatLogger, buatStorePg, buatStoreTanpaDb, hubungkan } from '@puisiapp/events';
import pg from 'pg';
import { createClient } from 'redis';
import { buatServerHttp } from './http.js';
import { buatIndeksTema } from './indeks-tema.js';
import { mulaiKonsumenThemeFeed } from './konsumen-event.js';

const log = buatLogger(process.env.SERVICE_NAME || 'theme-feed');
const port = Number.parseInt(process.env.PORT || '8080', 10);
const redisUrl =
  process.env.REDIS_URL ||
  `redis://${process.env.REDIS_HOST || 'redis'}:${process.env.REDIS_PORT || '6379'}`;

const redis = createClient({
  url: redisUrl,
  password: process.env.REDIS_PASSWORD || undefined,
});
redis.on('error', (err) => log.error('galat koneksi Redis', { err }));
await redis.connect();

const indeksTema = buatIndeksTema(redis);
const server = buatServerHttp({ indeksTema });

server.listen(port, '0.0.0.0', () => {
  log.info('theme-feed HTTP aktif', { port });
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
