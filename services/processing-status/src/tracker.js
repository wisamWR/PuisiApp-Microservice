/**
 * Entrypoint processing-tracker (T2.7): worker tanpa basis data (status di
 * Redis), queue q.processing-tracker. HTTP hanya /health, /health/ready, /metrics.
 */
import http from 'node:http';
import client from 'prom-client';
import { buatKonsumen, buatLogger, buatPublisher, buatStoreTanpaDb, hubungkan } from '@puisiapp/events';
import { IKATAN, langkahAktif } from './langkah.js';
import { buatKeadaan, buatKlienRedis } from './keadaan.js';
import { buatHandlerTracker } from './handler-tracker.js';

const namaLayanan = (process.env.SERVICE_NAME ??= 'processing-tracker');
const log = buatLogger(namaLayanan);
const langkah = langkahAktif();

const registry = new client.Registry();
registry.setDefaultLabels({ service: namaLayanan });
client.collectDefaultMetrics({ register: registry });
const metrik = {
  langkah: new client.Counter({
    name: 'rasa_processing_steps_total',
    help: 'Langkah pemrosesan yang dicatat (baru = pertama kali, false = pengiriman ulang)',
    labelNames: ['langkah', 'baru'],
    registers: [registry],
  }),
};

const redis = buatKlienRedis();
redis.on('error', (err) => log.warn('galat Redis', { err }));
await redis.connect();
const keadaan = buatKeadaan(redis, { langkah });

const koneksi = await hubungkan({ log });
const publisher = await buatPublisher(koneksi);
const konsumen = await buatKonsumen({
  koneksi,
  log,
  antrean: 'q.processing-tracker',
  ikatan: [...IKATAN],
  store: buatStoreTanpaDb(),
  handler: buatHandlerTracker({ keadaan, publisher, langkah, metrik }),
});

const server = http.createServer(async (req, res) => {
  if (req.url === '/health' || req.url === '/health/live') {
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"ok"}');
  } else if (req.url === '/health/ready') {
    const siap = redis.isReady;
    res.writeHead(siap ? 200 : 503, { 'content-type': 'application/json' }).end(siap ? '{"status":"ok"}' : '{"status":"tidak_siap"}');
  } else if (req.url === '/metrics') {
    res.writeHead(200, { 'content-type': registry.contentType }).end(await registry.metrics());
  } else {
    res.writeHead(404).end();
  }
});
server.listen(Number(process.env.PORT ?? 8080), () => log.info('worker siap', { langkah }));

let berhenti = false;
for (const sinyal of ['SIGTERM', 'SIGINT']) {
  process.on(sinyal, async () => {
    if (berhenti) return;
    berhenti = true;
    log.info('berhenti', { sinyal });
    server.close();
    await konsumen.berhenti().catch(() => {});
    await publisher.tutup().catch(() => {});
    await koneksi.close().catch(() => {});
    await redis.close().catch(() => {});
    process.exit(0);
  });
}
