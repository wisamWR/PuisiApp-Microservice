import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createClient } from 'redis';
import { buatLogger, buatKonsumen, buatPoolBaca, buatStorePg, hubungkan, jalankanMigrasi } from '@puisiapp/events';
import { buatAppHttp, buatRepoPg } from './http.js';
import { buatMetrikHttp } from './metrics.js';
import { buatIndeksFeed } from './indeks-redis.js';
import { buatHandlerEvent, EVENT_DIKONSUMSI } from './konsumen-event.js';

const serviceName = process.env.SERVICE_NAME || 'mood-feed-service';
const log = buatLogger(serviceName);
const folderIni = path.dirname(fileURLToPath(import.meta.url));
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL belum diisi');
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX) || 10,
  connectionTimeoutMillis: 2000,
  statement_timeout: 5000,
  // Batas di sisi klien: statement_timeout tidak berlaku bila server beku/tak menjawab.
  query_timeout: 6_000,
});
pool.on('error', (err) => log.error('galat koneksi idle PostgreSQL', { err }));

// GET detail emosi ke replika hot standby bila DATABASE_REPLICA_URL diisi; cadangan ke primary.
const poolReplika = process.env.DATABASE_REPLICA_URL
  ? new pg.Pool({
      connectionString: process.env.DATABASE_REPLICA_URL,
      max: Number(process.env.DB_POOL_MAX) || 10,
      connectionTimeoutMillis: 2000,
      statement_timeout: 5000,
      query_timeout: 6_000,
    })
  : null;
poolReplika?.on('error', (err) => log.error('galat koneksi idle PostgreSQL replika', { err }));
const poolBaca = buatPoolBaca({ primary: pool, replika: poolReplika, log });

await jalankanMigrasi(pool, { folder: path.join(folderIni, '../migrations'), outbox: false, log });

const redisUrl =
  process.env.REDIS_URL ||
  `redis://:${encodeURIComponent(process.env.REDIS_PASSWORD || '')}@${process.env.REDIS_HOST}:${process.env.REDIS_PORT || 6379}`;
const redisClient = createClient({ url: redisUrl });
redisClient.on('error', (err) => log.warn('galat koneksi redis', { err: String(err) }));
await redisClient.connect();

const repo = buatRepoPg(poolBaca);
const indeks = buatIndeksFeed(redisClient);
// Indeks dibangun ulang dari primary saat start supaya tidak tertinggal replika.
await indeks.bangunUlangSemua(await buatRepoPg(pool).ambilSemuaPuisiTerbit());

const koneksi = await hubungkan({ log });
const { versiTersimpan, handler } = buatHandlerEvent({ indeks, log });
const konsumen = await buatKonsumen({ koneksi, log, antrean: `q.${serviceName}`, ikatan: EVENT_DIKONSUMSI, store: buatStorePg(pool), versiTersimpan, handler });

const port = Number(process.env.PORT ?? 8080);
const metrik = buatMetrikHttp(serviceName);
const server = buatAppHttp({ repo, indeks, serviceName, metrik, cekDb: () => poolBaca.query('SELECT 1') });
server.listen(port, () => log.info('mood-feed-service berjalan', { port }));

let berhenti = false;
async function matikan(sinyal) {
  if (berhenti) return;
  berhenti = true;
  server.close();
  await konsumen.berhenti().catch(() => {});
  await koneksi.close().catch(() => {});
  await redisClient.quit().catch(() => {});
  await pool.end().catch(() => {});
  await poolReplika?.end().catch(() => {});
  process.exit(0);
}
process.on('SIGTERM', () => matikan('SIGTERM'));
process.on('SIGINT', () => matikan('SIGINT'));
