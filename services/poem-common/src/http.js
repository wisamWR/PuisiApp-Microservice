/**
 * Helper HTTP bersama layanan tulis puisi (Fastify): log dan metrik per
 * permintaan, penanganan galat seragam, /health, /health/live,
 * /health/ready, /metrics, dan pembacaan identitas dari gateway.
 */
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { traceIdDari } from '@puisiapp/events';

/** Fastify dengan aturan yang sama untuk semua layanan tulis puisi. */
export function buatFastify() {
  const app = Fastify({
    logger: false,
    bodyLimit: 64 * 1024,
    requestIdHeader: 'x-request-id', // X-Request-Id gateway = correlation id
    genReqId: () => randomUUID(),
  });
  app.removeContentTypeParser('text/plain'); // hanya JSON
  return app;
}

export const kirimGalat = (reply, kode, error, message, tambahan = {}) =>
  reply.code(kode).send({ error, message, ...tambahan });

/**
 * Identitas pengguna dari header gateway (X-User-Id). Nilai dari klien tidak
 * pernah sampai ke layanan karena gateway selalu menimpanya.
 * @returns {string|null}
 */
export function idPengguna(req) {
  const id = req.headers['x-user-id'];
  return typeof id === 'string' && id && id.length <= 64 ? id : null;
}

/** Konteks event dari permintaan: correlation_id dan traceparent. */
export function konteksEvent(req) {
  return {
    correlationId: req.id,
    traceparent: typeof req.headers.traceparent === 'string' ? req.headers.traceparent : undefined,
  };
}

/**
 * Pasang hook log/metrik, penanganan galat, dan rute kesehatan.
 * @param {import('fastify').FastifyInstance} app
 * @param {object} d
 * @param {{ info: Function, error: Function }} d.log
 * @param {() => Promise<void>} d.cekSiap   lempar galat bila dependensi belum siap
 * @param {{ registry: any, durasi: any }} [d.metrik]
 */
export function pasangDasar(app, d) {
  app.addHook('onResponse', async (req, reply) => {
    const route = req.routeOptions?.url ?? 'tidak_dikenal';
    d.metrik?.durasi.observe({ method: req.method, route, status_code: reply.statusCode }, reply.elapsedTime / 1000);
    if (route.startsWith('/health') || route === '/metrics') return;
    d.log.info('permintaan selesai', {
      method: req.method,
      route,
      status: reply.statusCode,
      rt_ms: Math.round(reply.elapsedTime),
      correlation_id: req.id,
      trace_id: traceIdDari(req.headers.traceparent),
    });
  });

  app.setErrorHandler((err, req, reply) => {
    if (err.code === 'FST_ERR_CTP_BODY_TOO_LARGE') return kirimGalat(reply, 413, 'terlalu_besar', 'Body maksimal 64 KB');
    if (err.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
      return kirimGalat(reply, 415, 'media_tidak_didukung', 'Content-Type harus application/json');
    }
    if (err.statusCode === 400) return kirimGalat(reply, 400, 'json_tidak_valid', 'Body bukan JSON yang valid');
    d.log.error('galat tak terduga', { err, correlation_id: req.id });
    return kirimGalat(reply, 500, 'galat_internal', 'Terjadi kesalahan, coba lagi');
  });

  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/health/live', async () => ({ status: 'ok' }));
  app.get('/health/ready', async (_req, reply) => {
    try {
      await d.cekSiap();
      return { status: 'ok' };
    } catch {
      return reply.code(503).send({ status: 'tidak_siap' });
    }
  });
  app.get('/metrics', async (_req, reply) => {
    if (!d.metrik) return reply.code(404).send();
    reply.header('content-type', d.metrik.registry.contentType);
    return d.metrik.registry.metrics();
  });
}

/** Pola UUID untuk path /api/poems/{id}. */
export const POLA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
