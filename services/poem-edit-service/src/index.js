/**
 * poem-edit-service (T2.4): proses API (PUT /api/poems/{id}) dan proses
 * konsumen (salinan kepemilikan) dalam satu layanan dengan satu database.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { buatKonsumen, buatLogger, buatStorePg, hubungkan, jalankanMigrasi } from '@puisiapp/events';
import { buatMetrik } from '@puisiapp/poem-common';
import { buatApp } from './app.js';
import { simpanRevisi, tanganiEventKepemilikan } from './repo.js';

const namaLayanan = (process.env.SERVICE_NAME ??= 'poem-edit-service');
const log = buatLogger(namaLayanan);
const folderIni = path.dirname(fileURLToPath(import.meta.url));
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL belum diisi');
const templateSah = (process.env.TEMPLATE_SAH ?? 'latar1,latar2,latar3').split(',').map((t) => t.trim()).filter(Boolean);

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
  antrean: 'q.poem-edit',
  ikatan: ['poem.submitted', 'poem.deleted'],
  store: buatStorePg(pool),
  handler: tanganiEventKepemilikan,
});

const app = buatApp({
  simpanRevisi: (p) => simpanRevisi(pool, p),
  cekSiap: async () => { await pool.query('SELECT 1'); },
  templateSah,
  log,
  metrik: buatMetrik(namaLayanan, { nama: 'rasa_poem_revisions_total', bantuan: 'Revisi puisi menurut hasil' }),
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
