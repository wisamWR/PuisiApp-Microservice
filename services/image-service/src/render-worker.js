/**
 * Entrypoint image-render-worker (T2.5).
 * Konsumsi poem.submitted dan poem.revised (q.image-render), render gambar
 * kutipan final ke S3, terbitkan poem.image.rendered.
 */
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buatKonsumen, buatLogger, buatPublisher, buatStoreTanpaDb, hubungkan } from '@puisiapp/events';
import { muatTemplate } from './render.js';
import { buatHandlerRender } from './render-handler.js';
import { buatKlienS3 } from './s3.js';
import { buatMetrik } from './metrik.js';

const namaLayanan = (process.env.SERVICE_NAME ??= 'image-render-worker');
const log = buatLogger(namaLayanan);
const metrik = buatMetrik(namaLayanan);
const folderTemplate =
  process.env.TEMPLATE_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets/templates');

const templates = await muatTemplate(folderTemplate);
const s3 = buatKlienS3();
try {
  await s3.cekBucket();
} catch (err) {
  log.warn('bucket S3 belum bisa diakses; render akan dicoba ulang', { bucket: s3.bucket, err });
}

const koneksi = await hubungkan({ log });
const publisher = await buatPublisher(koneksi);
const konsumen = await buatKonsumen({
  koneksi,
  log,
  antrean: 'q.image-render',
  ikatan: ['poem.submitted', 'poem.revised'],
  store: buatStoreTanpaDb(),
  // Render CPU-bound: ambil sedikit pesan sekaligus (backpressure).
  prefetch: Number(process.env.PREFETCH) || 2,
  handler: buatHandlerRender({ templates, s3, publisher, metrik, merek: process.env.MEREK }),
});

const server = http.createServer(async (req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"ok"}');
  } else if (req.url === '/metrics') {
    res.writeHead(200, { 'content-type': metrik.registry.contentType }).end(await metrik.registry.metrics());
  } else res.writeHead(404).end();
});
server.listen(Number(process.env.PORT ?? 8080), () => log.info('worker siap', { templates: templates.size }));

for (const sinyal of ['SIGTERM', 'SIGINT']) {
  process.on(sinyal, async () => {
    log.info('berhenti', { sinyal });
    server.close();
    await konsumen.berhenti().catch(() => {});
    await publisher.tutup().catch(() => {});
    await koneksi.close().catch(() => {});
    process.exit(0);
  });
}
