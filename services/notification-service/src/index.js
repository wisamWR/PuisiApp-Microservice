/**
 * notification-service (T2.8): konsumen q.notification + API notifikasi.
 * Hanya menulis ke notif_db; tidak menerbitkan event (tanpa outbox).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { buatKonsumen, buatLogger, buatStorePg, hubungkan, jalankanMigrasi } from '@puisiapp/events';
import { buatMetrik } from '@puisiapp/poem-common';
import { buatApp } from './app.js';
import { IKATAN, buatHandler } from './handler.js';
import * as repo from './repo.js';

const namaLayanan = (process.env.SERVICE_NAME ??= 'notification-service');
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

const koneksi = await hubungkan({ log });
const konsumen = await buatKonsumen({
  koneksi,
  log,
  antrean: 'q.notification',
  ikatan: IKATAN,
  // Kunci per aggregate_id: event satu puisi diproses berurutan.
  store: buatStorePg(pool),
  handler: buatHandler(),
});

const app = buatApp({
  repo: {
    daftar: (q) => repo.daftar(pool, q),
    jumlahBelumDibaca: (u) => repo.jumlahBelumDibaca(pool, u),
    tandaiDibaca: (q) => repo.tandaiDibaca(pool, q),
    tandaiSemua: (u) => repo.tandaiSemua(pool, u),
  },
  cekSiap: async () => {
    await pool.query('SELECT 1');
  },
  log,
  metrik: buatMetrik(namaLayanan, { nama: 'rasa_notifications_api_total', bantuan: 'Permintaan API notifikasi' }),
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
    await pool.end().catch(() => {});
    process.exit(0);
  });
}
