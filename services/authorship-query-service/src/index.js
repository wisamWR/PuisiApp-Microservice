import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import {
  buatKonsumen,
  buatLogger,
  buatStorePg,
  hubungkan,
  jalankanMigrasi,
} from '@puisiapp/events';

import { buatApp } from './app.js';
import { IKATAN, proyeksikan } from './proyeksi.js';
import { ambilRiwayat, cekPemilik } from './repo.js';

const namaLayanan = process.env.SERVICE_NAME ?? 'authorship-query-service';
const log = buatLogger(namaLayanan);
const folderIni = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL belum diisi');
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 2000,
  statement_timeout: 5000,
  // Batas di sisi klien: statement_timeout tidak berlaku bila server beku/tak menjawab.
  query_timeout: 6_000,
});

pool.on('error', (err) => log.error('Galat authorship database', { err }));

await jalankanMigrasi(pool, {
  folder: path.join(folderIni, '../migrations'),
  log,
});

const koneksi = await hubungkan({ log });

const konsumen = await buatKonsumen({
  koneksi,
  log,
  antrean: 'q.authorship-query',
  ikatan: IKATAN,
  store: buatStorePg(pool),
  handler: async (event, { tx }) => {
    await proyeksikan(tx, event);
  },
});

const app = buatApp({
  ambilRiwayat: (poemId) => ambilRiwayat(pool, poemId),
  cekPemilik: (poemId, userId) => cekPemilik(pool, poemId, userId),
  cekSiap: async () => {
    await pool.query('SELECT 1');
  },
  log,
});

const port = Number(process.env.PORT ?? 8080);
await app.listen({ host: '0.0.0.0', port });
log.info('HTTP authorship query siap', { port });

let berhenti = false;

for (const sinyal of ['SIGTERM', 'SIGINT']) {
  process.on(sinyal, async () => {
    if (berhenti) return;
    berhenti = true;
    log.info('Menghentikan authorship-query-service', { sinyal });

    await app.close().catch(() => {});
    await konsumen.berhenti().catch(() => {});
    await koneksi.close().catch(() => {});
    await pool.end().catch(() => {});

    process.exit(0);
  });
}
