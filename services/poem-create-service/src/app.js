/**
 * Aplikasi HTTP poem-create-service. Dependensi disuntikkan (repo, cekDb)
 * sehingga rute bisa diuji dengan fastify.inject tanpa basis data.
 */
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { traceIdDari } from '@puisiapp/events';
import { validasiPengajuan, hashPengajuan, POLA_IDEMPOTENCY_KEY } from '@puisiapp/poem-common';

/**
 * @param {object} d
 * @param {(p: object) => Promise<{ jenis: string, puisi?: object }>} d.simpanPengajuan
 * @param {() => Promise<void>} d.cekDb             lempar galat bila basis data tidak siap
 * @param {string[]} d.templateSah
 * @param {ReturnType<import('@puisiapp/events').buatLogger>} d.log
 * @param {ReturnType<import('@puisiapp/poem-common').buatMetrik>} [d.metrik]
 */
export function buatApp(d) {
  const app = Fastify({
    logger: false,
    bodyLimit: 64 * 1024,
    // X-Request-Id dari gateway menjadi id permintaan (correlation id).
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
  });

  // Hanya JSON yang diterima; Content-Type lain dijawab 415.
  app.removeContentTypeParser('text/plain');

  const galat = (reply, kode, error, message, tambahan = {}) =>
    reply.code(kode).send({ error, message, ...tambahan });

  // ------------------------------------------------------------ log dan metrik per permintaan
  app.addHook('onResponse', async (req, reply) => {
    const route = req.routeOptions?.url ?? 'tidak_dikenal';
    const detik = reply.elapsedTime / 1000;
    d.metrik?.durasi.observe({ method: req.method, route, status_code: reply.statusCode }, detik);
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
    if (err.code === 'FST_ERR_CTP_BODY_TOO_LARGE') return galat(reply, 413, 'terlalu_besar', 'Body maksimal 64 KB');
    if (err.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
      return galat(reply, 415, 'media_tidak_didukung', 'Content-Type harus application/json');
    }
    if (err.statusCode === 400) return galat(reply, 400, 'json_tidak_valid', 'Body bukan JSON yang valid');
    d.log.error('galat tak terduga', { err, correlation_id: req.id });
    return galat(reply, 500, 'galat_internal', 'Terjadi kesalahan, coba lagi');
  });

  // ------------------------------------------------------------ POST /api/poems
  app.post('/api/poems', async (req, reply) => {
    const authorId = req.headers['x-user-id'];
    if (typeof authorId !== 'string' || !authorId || authorId.length > 64) {
      return galat(reply, 401, 'unauthorized', 'Wajib login');
    }

    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || !POLA_IDEMPOTENCY_KEY.test(key)) {
      d.metrik?.pengajuan.inc({ hasil: 'tidak_valid' });
      return galat(reply, 400, 'validasi', 'Header Idempotency-Key wajib (8-64 karakter A-Z a-z 0-9 _ -)', {
        rincian: [{ field: 'Idempotency-Key', pesan: 'Wajib diisi, dibuat sekali per draf' }],
      });
    }

    const v = validasiPengajuan(req.body, { templateSah: d.templateSah });
    if (!v.ok) {
      d.metrik?.pengajuan.inc({ hasil: 'tidak_valid' });
      return galat(reply, 400, 'validasi', 'Isi puisi tidak valid', { rincian: v.rincian });
    }

    const hasil = await d.simpanPengajuan({
      authorId,
      idempotencyKey: key,
      hash: hashPengajuan(v.data),
      data: v.data,
      konteks: {
        correlationId: req.id,
        traceparent: typeof req.headers.traceparent === 'string' ? req.headers.traceparent : undefined,
      },
    });
    d.metrik?.pengajuan.inc({ hasil: hasil.jenis });

    if (hasil.jenis === 'konflik') {
      return galat(reply, 409, 'idempotency_key_bentrok', 'Idempotency-Key sudah dipakai untuk isi puisi yang berbeda');
    }
    if (hasil.jenis === 'ulang') reply.header('Idempotent-Replayed', 'true');
    reply.header('Location', `/api/poems/${hasil.puisi.poem_id}`);
    return reply.code(202).send(hasil.puisi);
  });

  // ------------------------------------------------------------ kesehatan dan metrik
  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/health/live', async () => ({ status: 'ok' }));
  app.get('/health/ready', async (_req, reply) => {
    try {
      await d.cekDb();
      return { status: 'ok' };
    } catch {
      return reply.code(503).send({ status: 'db_tidak_siap' });
    }
  });
  app.get('/metrics', async (_req, reply) => {
    if (!d.metrik) return reply.code(404).send();
    reply.header('content-type', d.metrik.registry.contentType);
    return d.metrik.registry.metrics();
  });

  return app;
}
