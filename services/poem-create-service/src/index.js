/**
 * poem-create-service (T2.1).
 *
 * POST /api/poems -> validasi -> submission + outbox poem.submitted (satu
 * transaksi) -> 202. Penerbitan ke RabbitMQ dikerjakan outbox-relay-submission.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { buatLogger, jalankanMigrasi } from '@puisiapp/events';
import { buatApp } from './app.js';
import { buatMetrik } from '@puisiapp/poem-common';
import { simpanPengajuan } from './repo.js';

const namaLayanan = process.env.SERVICE_NAME ?? 'poem-create-service';
process.env.SERVICE_NAME = namaLayanan;
const log = buatLogger(namaLayanan);
const folderIni = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL belum diisi');
const templateSah = (process.env.TEMPLATE_SAH ?? 'latar1,latar2,latar3')
  .split(',')
  .map((t) => t.trim())
  .filter(Boolean);

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX) || 10,
  connectionTimeoutMillis: 2000,
  statement_timeout: 5000,
});
pool.on('error', (err) => log.error('galat koneksi idle PostgreSQL', { err }));

await jalankanMigrasi(pool, { folder: path.join(folderIni, '../migrations'), outbox: true, log });

const app = buatApp({
  simpanPengajuan: (p) => simpanPengajuan(pool, p),
  cekDb: async () => {
    await pool.query('SELECT 1');
  },
  templateSah,
  log,
  metrik: buatMetrik(namaLayanan),
});

const port = Number(process.env.PORT ?? 8080);
await app.listen({ host: '0.0.0.0', port });
log.info('http siap', { port, template_sah: templateSah });

let berhenti = false;
async function matikan(sinyal) {
  if (berhenti) return;
  berhenti = true;
  log.info('berhenti', { sinyal });
  await app.close().catch(() => {}); // menunggu permintaan berjalan selesai
  await pool.end().catch(() => {});
  process.exit(0);
}
process.on('SIGTERM', () => matikan('SIGTERM'));
process.on('SIGINT', () => matikan('SIGINT'));
