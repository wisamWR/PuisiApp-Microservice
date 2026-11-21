/**
 * publication-service (T2.2): worker mesin status publikasi.
 *
 * Konsumsi poem.submitted, poem.revised, poem.deleted, poem.similarity.scored,
 * dan case.decided (q.publication). Tulis status ke publication_db dan
 * poem.published / poem.held / poem.hidden ke outbox dalam satu transaksi.
 * Penerbitan ke RabbitMQ dikerjakan outbox-relay-publication.
 *
 * HTTP hanya untuk /health, /health/ready, dan /metrics.
 */
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { buatKonsumen, buatLogger, buatStorePg, hubungkan, jalankanMigrasi } from '@puisiapp/events';
import { IKATAN, buatHandler } from './handler.js';
import { buatMetrik } from './metrik.js';

const namaLayanan = (process.env.SERVICE_NAME ??= 'publication-service');
const log = buatLogger(namaLayanan);
const metrik = buatMetrik(namaLayanan);
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
  antrean: 'q.publication',
  ikatan: IKATAN,
  store: buatStorePg(pool),
  handler: buatHandler({ metrik }),
});

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/health' || req.url === '/health/live') {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"ok"}');
    } else if (req.url === '/health/ready') {
      await pool.query('SELECT 1');
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"ok"}');
    } else if (req.url === '/metrics') {
      res.writeHead(200, { 'content-type': metrik.registry.contentType }).end(await metrik.registry.metrics());
    } else {
      res.writeHead(404).end();
    }
  } catch {
    res.writeHead(503, { 'content-type': 'application/json' }).end('{"status":"tidak_siap"}');
  }
});
const port = Number(process.env.PORT ?? 8080);
server.listen(port, () => log.info('worker siap', { port, ikatan: IKATAN }));

let berhenti = false;
for (const sinyal of ['SIGTERM', 'SIGINT']) {
  process.on(sinyal, async () => {
    if (berhenti) return;
    berhenti = true;
    log.info('berhenti', { sinyal });
    server.close();
    await konsumen.berhenti().catch(() => {});
    await koneksi.close().catch(() => {});
    await pool.end().catch(() => {});
    process.exit(0);
  });
}
