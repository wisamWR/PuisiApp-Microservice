/**
 * Entrypoint image-preview-service (T2.5): GET /api/images/preview.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buatLogger } from '@puisiapp/events';
import { muatTemplate } from './render.js';
import { buatAppPratinjau } from './preview-app.js';
import { buatMetrik } from './metrik.js';

const namaLayanan = (process.env.SERVICE_NAME ??= 'image-preview-service');
const log = buatLogger(namaLayanan);
const folderTemplate =
  process.env.TEMPLATE_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets/templates');

const t0 = performance.now();
const templates = await muatTemplate(folderTemplate);
log.info('template dimuat ke memori', { jumlah: templates.size, ms: Math.round(performance.now() - t0) });

const app = buatAppPratinjau({ templates, log, metrik: buatMetrik(namaLayanan), merek: process.env.MEREK });
const port = Number(process.env.PORT ?? 8080);
await app.listen({ host: '0.0.0.0', port });
log.info('http siap', { port });

for (const sinyal of ['SIGTERM', 'SIGINT']) {
  process.on(sinyal, async () => {
    log.info('berhenti', { sinyal });
    await app.close().catch(() => {});
    process.exit(0);
  });
}
