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
import { ambilRiwayat } from './repo.js';

const namaLayanan = process.env.SERVICE_NAME ?? 'authorship-query-service';
const log = buatLogger(namaLayanan);
const folderIni = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL belum diisi');
}
if (!process.env.POEM_READ_DATABASE_URL) {
  throw new Error('POEM_READ_DATABASE_URL belum diisi');
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 2000,
  statement_timeout: 5000,
});

const poemPool = new pg.Pool({
  connectionString: process.env.POEM_READ_DATABASE_URL,
  max: 5,
  connectionTimeoutMillis: 2000,
  statement_timeout: 5000,
});

pool.on('error', (err) => log.error('Galat authorship database', { err }));
poemPool.on('error', (err) => log.error('Galat poem read database', { err }));

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
  cekPemilik: async (poemId, userId) => {
    const hasil = await poemPool.query(
      'SELECT 1 FROM poem WHERE poem_id = $1 AND author_id = $2 LIMIT 1',
      [poemId, userId],
    );
    return hasil.rowCount > 0;
  },
  cekSiap: async () => {
    await pool.query('SELECT 1');
    await poemPool.query('SELECT 1');
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
    await poemPool.end().catch(() => {});

    process.exit(0);
  });
}
