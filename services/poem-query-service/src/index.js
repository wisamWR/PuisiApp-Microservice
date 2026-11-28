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
import { buatKonsumen, buatLogger, buatPoolBaca, buatStorePg, hubungkan, jalankanMigrasi } from '@puisiapp/events';
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
  // Batas di sisi klien: statement_timeout tidak berlaku bila server beku/tak menjawab.
  query_timeout: 6_000,
});
pool.on('error', (err) => log.error('galat koneksi idle PostgreSQL', { err }));

// Baca (GET) ke replika hot standby bila DATABASE_REPLICA_URL diisi; cadangan ke primary.
// Proyeksi konsumen dan migrasi tetap menulis ke primary lewat `pool`.
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
  ambilBundel: (id) => ambilBundel(poolBaca, id),
  daftarPenulis: (q) => daftarPenulis(poolBaca, q),
  daftarMilik: (q) => daftarMilik(poolBaca, q),
  cache,
  // Siap selama jalur baca bisa dilayani (replika atau primary).
  cekSiap: async () => {
    await poolBaca.query('SELECT 1');
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
    await poolReplika?.end().catch(() => {});
    process.exit(0);
  });
}
