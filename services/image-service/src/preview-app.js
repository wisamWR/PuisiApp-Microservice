/**
 * Aplikasi HTTP image-preview-service (T2.5). Stateless: tanpa basis data,
 * template sudah ada di memori. Dipisah dari preview.js agar bisa diuji
 * dengan fastify.inject.
 */
import { createHash } from 'node:crypto';
import Fastify from 'fastify';
import { normalisasiTeks, renderJpeg, UKURAN, BATAS_TEKS } from './render.js';

// Naikkan bila desain template berubah, supaya ETag dan cache CDN ikut berubah.
export const VERSI_RENDER = '1';

/**
 * @param {object} d
 * @param {Map<string, object>} d.templates hasil muatTemplate()
 * @param {ReturnType<import('@puisiapp/events').buatLogger>} d.log
 * @param {{ registry: any, durasi: any }} [d.metrik]
 * @param {string} [d.merek]
 */
export function buatAppPratinjau(d) {
  const app = Fastify({ logger: false, requestIdHeader: 'x-request-id' });
  const daftar = [...d.templates.values()].map((t) => ({ id: t.id, nama: t.nama }));

  app.addHook('onResponse', async (req, reply) => {
    const route = req.routeOptions?.url ?? 'tidak_dikenal';
    d.metrik?.durasi.observe({ method: req.method, route, status_code: reply.statusCode }, reply.elapsedTime / 1000);
    if (route === '/api/images/preview' && reply.statusCode >= 400) {
      d.log.info('pratinjau ditolak', { status: reply.statusCode, correlation_id: req.id });
    }
  });

  const tolak = (reply, message) => reply.code(400).send({ error: 'validasi', message });

  app.get('/api/images/preview', async (req, reply) => {
    const { template, text } = /** @type {Record<string, string>} */ (req.query ?? {});
    const tpl = typeof template === 'string' ? d.templates.get(template) : undefined;
    if (!tpl) return tolak(reply, `Template harus salah satu dari: ${daftar.map((t) => t.id).join(', ')}`);
    const teks = normalisasiTeks(text);
    if (!teks) return tolak(reply, `Teks bait wajib diisi, maksimal ${BATAS_TEKS} karakter`);

    // Hasil deterministik: ETag dari masukan, sehingga browser dan CDN bisa memakai 304.
    const etag = `"${createHash('sha1').update(`${VERSI_RENDER}|${tpl.id}|${teks}`).digest('base64url')}"`;
    reply.header('ETag', etag);
    reply.header('Cache-Control', 'public, max-age=86400');
    if (req.headers['if-none-match'] === etag) return reply.code(304).send();

    const jpeg = await renderJpeg(tpl, teks, UKURAN.pratinjau, { kualitas: 72, merek: d.merek });
    return reply.type('image/jpeg').send(jpeg);
  });

  app.get('/api/images/templates', async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=300');
    return daftar;
  });

  app.get('/health', async () => ({ status: 'ok', templates: daftar.length }));
  app.get('/metrics', async (_req, reply) => {
    if (!d.metrik) return reply.code(404).send();
    reply.header('content-type', d.metrik.registry.contentType);
    return d.metrik.registry.metrics();
  });

  return app;
}
