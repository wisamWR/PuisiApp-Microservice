/**
 * poem-delete-service (T2.4): proses API (DELETE /api/poems/{id}) dan proses
 * konsumen (salinan kepemilikan) dalam satu layanan dengan satu database.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { buatKonsumen, buatLogger, buatStorePg, hubungkan, jalankanMigrasi } from '@puisiapp/events';
import { buatMetrik } from '@puisiapp/poem-common';
import { buatApp } from './app.js';
import { hapusPuisi, tanganiEventKepemilikan } from './repo.js';

const namaLayanan = (process.env.SERVICE_NAME ??= 'poem-delete-service');
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
await jalankanMigrasi(pool, { folder: path.join(folderIni, '../migrations'), outbox: true, log });

const koneksi = await hubungkan({ log });
const konsumen = await buatKonsumen({
  koneksi,
  log,
  antrean: 'q.poem-delete',
  ikatan: ['poem.submitted', 'poem.revised'],
  store: buatStorePg(pool),
  handler: tanganiEventKepemilikan,
});

const app = buatApp({
  hapusPuisi: (p) => hapusPuisi(pool, p),
  cekSiap: async () => { await pool.query('SELECT 1'); },
  log,
  metrik: buatMetrik(namaLayanan, { nama: 'rasa_poem_deletions_total', bantuan: 'Penghapusan puisi menurut hasil' }),
});
const port = Number(process.env.PORT ?? 8080);
await app.listen({ host: '0.0.0.0', port });
log.info('http siap', { port });

let berhenti = false;
for (const sinyal of ['SIGTERM', 'SIGINT']) {
  process.on(sinyal, async () => {
    if (berhenti) return;
    berhenti = true;
    log.info('berhenti', { sinyal });
    await app.close().catch(() => {});
    await konsumen.berhenti().catch(() => {});
    await koneksi.close().catch(() => {});
    await pool.end().catch(() => {});
    process.exit(0);
  });
}
