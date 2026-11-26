/**
 * poem-query-service (T2.3): sisi baca puisi (CQRS).
 *
 * Proses konsumen: 14 jenis event -> read model poem_read_db (q.poem-query),
 * lalu hapus cache detail puisi yang berubah setelah commit.
 * Proses API: GET /api/poems/{id} (cache-aside Redis) dan GET /api/poems (publik / per penulis).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { buatKonsumen, buatLogger, buatStorePg, hubungkan, jalankanMigrasi } from '@puisiapp/events';
import { buatMetrik } from '@puisiapp/poem-common';
import { buatApp } from './app.js';
import { buatCache, denganInvalidasi } from './cache.js';
import { IKATAN, proyeksikan, targetDari } from './proyeksi.js';
import { ambilBundel, daftarMilik, daftarPenulis, poemIdPenulis } from './repo.js';

const namaLayanan = (process.env.SERVICE_NAME ??= 'poem-query-service');
const log = buatLogger(namaLayanan);
const folderIni = path.dirname(fileURLToPath(import.meta.url));
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL belum diisi');

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX) || 10,
  connectionTimeoutMillis: 2000,
  statement_timeout: 5000,
});
pool.on('error', (err) => log.error('galat koneksi idle PostgreSQL', { err }));
await jalankanMigrasi(pool, { folder: path.join(folderIni, '../migrations'), log });

const cache = await buatCache({ log });

const koneksi = await hubungkan({ log });
const konsumen = await buatKonsumen({
  koneksi,
  log,
  antrean: 'q.poem-query',
  ikatan: IKATAN,
  store: denganInvalidasi(buatStorePg(pool), {
    cache,
    log,
    targetDari: async (event) => {
      const t = targetDari(event);
      return t.poemId ? [t.poemId] : poemIdPenulis(pool, t.userId);
    },
  }),
  handler: async (event, { tx }) => {
    await proyeksikan(tx, event);
  },
});

const app = buatApp({
  ambilBundel: (id) => ambilBundel(pool, id),
  daftarPenulis: (q) => daftarPenulis(pool, q),
  daftarMilik: (q) => daftarMilik(pool, q),
  cache,
  cekSiap: async () => {
    await pool.query('SELECT 1');
  },
  log,
  metrik: buatMetrik(namaLayanan, {
    nama: 'rasa_poem_query_cache_total',
    bantuan: 'Baca detail puisi menurut asal data (hit = Redis, miss = basis data)',
  }),
});
const port = Number(process.env.PORT ?? 8080);
await app.listen({ host: '0.0.0.0', port });
log.info('http siap', { port, ikatan: IKATAN.length });

let berhenti = false;
for (const sinyal of ['SIGTERM', 'SIGINT']) {
  process.on(sinyal, async () => {
    if (berhenti) return;
    berhenti = true;
    log.info('berhenti', { sinyal });
    await app.close().catch(() => {});
    await konsumen.berhenti().catch(() => {});
    await koneksi.close().catch(() => {});
    await cache.tutup();
    await pool.end().catch(() => {});
    process.exit(0);
  });
}
