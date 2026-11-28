/**
 * bookmark-service (T3.4)
 *   GET    /api/me/bookmarks?page=&size=   daftar simpanan pengguna (wajib login)
 *   GET    /api/me/bookmarks/{poem_id}     { saved: boolean } (wajib login)
 *   PUT    /api/me/bookmarks/{poem_id}     simpan, idempoten, 204
 *   DELETE /api/me/bookmarks/{poem_id}     batal simpan, idempoten, 204
 *   GET    /p/{poem_id}                    HTML meta Open Graph untuk tautan bagikan (publik)
 */
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createClient } from 'redis';
import { buatLogger, buatKonsumen, buatStorePg, hubungkan, jalankanMigrasi } from '@puisiapp/events';
import { tanganiPuisi, tanganiHapusAkun } from './handler.js';
import { ambilPratinjau, htmlPratinjau, kunciCache } from './bagikan.js';

const log = buatLogger();
const folderIni = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL belum diisi');
const POEM_QUERY_HOST = process.env.POEM_QUERY_HOST || 'poem-query-service:8080';
const APP_BASE_URL = (process.env.APP_BASE_URL || 'http://localhost:8080').replace(/\/$/, '');
const PORT = Number(process.env.PORT || 8080);

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
await jalankanMigrasi(pool, { folder: path.join(folderIni, '../migrations') });

// Redis hanya cache pratinjau. Bila mati, pratinjau tetap dilayani langsung dari poem-query.
let redis = null;
if (process.env.REDIS_HOST) {
  redis = createClient({
    socket: { host: process.env.REDIS_HOST, port: Number(process.env.REDIS_PORT || 6379) },
    password: process.env.REDIS_PASSWORD || undefined,
  });
  redis.on('error', (err) => log.warn('redis bermasalah', { err: err.message }));
  redis.connect().catch((err) => log.warn('redis belum terhubung', { err: err.message }));
}
const hapusCache = async (poemId) => {
  if (redis?.isReady) await redis.del(kunciCache(poemId)).catch(() => {});
};

if (process.env.RABBITMQ_HOST || process.env.AMQP_URL) {
  const koneksi = await hubungkan({ log });
  const store = buatStorePg(pool);
  await buatKonsumen({
    koneksi,
    log,
    antrean: 'q.bookmark-service',
    ikatan: ['poem.submitted', 'poem.revised', 'poem.published', 'poem.held', 'poem.hidden', 'poem.deleted'],
    store,
    handler: (event, ctx) => tanganiPuisi(event, { ...ctx, hapusCache }),
  });
  await buatKonsumen({
    koneksi,
    log,
    antrean: 'q.bookmark-service.akun',
    ikatan: ['user.deleted'],
    store,
    handler: tanganiHapusAkun,
  });
}

const POLA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RUTE_SATU = /^\/api\/me\/bookmarks\/([^/]+)$/;
const RUTE_BAGIKAN = /^\/p\/([^/]+)$/;

function kirimJson(res, status, isi) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(isi));
}
const galat = (res, status, error, message) => kirimJson(res, status, { error, message });

function bilanganBulat(nilai, bawaan, min, maks) {
  if (nilai === null || nilai === undefined || nilai === '') return bawaan;
  const n = Number(nilai);
  if (!Number.isInteger(n) || n < min || n > maks) return null;
  return n;
}

async function daftarSimpanan(userId, page, size) {
  // Puisi yang ditahan, disembunyikan, atau dihapus tidak tampil. Puisi yang event-nya belum
  // tiba tetap tampil (judul null) agar simpanan baru tidak terlihat hilang.
  const saring = `b.user_id = $1 AND coalesce(s.status, 'PROCESSING') NOT IN ('HELD', 'HIDDEN', 'DELETED')`;
  const { rows: total } = await pool.query(
    `SELECT count(*)::int AS n FROM bookmark b LEFT JOIN puisi_simpan s USING (poem_id) WHERE ${saring}`,
    [userId],
  );
  const { rows } = await pool.query(
    `SELECT b.poem_id, b.dibuat_at, s.judul, s.kutipan, s.status
     FROM bookmark b LEFT JOIN puisi_simpan s USING (poem_id)
     WHERE ${saring}
     ORDER BY b.dibuat_at DESC, b.poem_id
     LIMIT $2 OFFSET $3`,
    [userId, size, (page - 1) * size],
  );
  return {
    items: rows.map((r) => ({
      poem_id: r.poem_id,
      title: r.judul,
      quote_text: r.kutipan,
      status: r.status ?? 'PROCESSING',
      saved_at: r.dibuat_at.toISOString(),
    })),
    total: total[0].n,
    page,
    size,
  };
}

async function layani(req, res) {
  const url = new URL(req.url, 'http://x');
  const jalur = url.pathname;

  if (jalur === '/health') return kirimJson(res, 200, { status: 'ok' });

  const bagikan = jalur.match(RUTE_BAGIKAN);
  if (bagikan && (req.method === 'GET' || req.method === 'HEAD')) {
    const poemId = bagikan[1].toLowerCase();
    if (!POLA_UUID.test(poemId)) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('Tidak ditemukan');
    }
    // Status dari event sendiri lebih dulu: cache Redis atau poem-query bisa tertinggal
    // beberapa detik setelah puisi ditahan, disembunyikan, atau dihapus.
    const { rows: st } = await pool.query('SELECT status FROM puisi_simpan WHERE poem_id = $1', [poemId]);
    const tertutup = st[0] && ['HELD', 'HIDDEN', 'DELETED'].includes(st[0].status);
    let data = null;
    if (!tertutup) {
      try {
        data = await ambilPratinjau({ redis, poemQueryHost: POEM_QUERY_HOST, log }, poemId);
      } catch {
        data = null; // poem-query tidak bisa dihubungi: tetap alihkan ke SPA, tanpa meta puisi
      }
    }
    res.writeHead(data ? 200 : 404, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=300',
    });
    return res.end(req.method === 'HEAD' ? undefined : htmlPratinjau({ appBaseUrl: APP_BASE_URL, poemId, data }));
  }

  if (jalur !== '/api/me/bookmarks' && !RUTE_SATU.test(jalur)) {
    res.writeHead(404);
    return res.end();
  }

  const userId = req.headers['x-user-id'];
  if (!userId) return galat(res, 401, 'unauthorized', 'Silakan masuk terlebih dahulu');

  if (jalur === '/api/me/bookmarks') {
    if (req.method !== 'GET') return galat(res, 405, 'method_not_allowed', 'Hanya GET');
    const page = bilanganBulat(url.searchParams.get('page'), 1, 1, 10_000);
    const size = bilanganBulat(url.searchParams.get('size'), 20, 1, 50);
    if (page === null || size === null) return galat(res, 400, 'parameter_tidak_valid', 'page>=1, size 1..50');
    return kirimJson(res, 200, await daftarSimpanan(userId, page, size));
  }

  const poemId = jalur.match(RUTE_SATU)[1].toLowerCase();
  if (!POLA_UUID.test(poemId)) return galat(res, 404, 'tidak_ditemukan', 'Puisi tidak ditemukan');

  if (req.method === 'GET') {
    const { rowCount } = await pool.query('SELECT 1 FROM bookmark WHERE user_id = $1 AND poem_id = $2', [userId, poemId]);
    return kirimJson(res, 200, { poem_id: poemId, saved: rowCount > 0 });
  }
  if (req.method === 'PUT') {
    const { rows } = await pool.query(
      `SELECT status FROM puisi_simpan WHERE poem_id = $1`,
      [poemId],
    );
    if (rows[0] && ['HIDDEN', 'DELETED'].includes(rows[0].status)) {
      return galat(res, 404, 'tidak_ditemukan', 'Puisi tidak ditemukan');
    }
    await pool.query(
      'INSERT INTO bookmark (user_id, poem_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [userId, poemId],
    );
    res.writeHead(204);
    return res.end();
  }
  if (req.method === 'DELETE') {
    await pool.query('DELETE FROM bookmark WHERE user_id = $1 AND poem_id = $2', [userId, poemId]);
    res.writeHead(204);
    return res.end();
  }
  return galat(res, 405, 'method_not_allowed', 'Metode tidak didukung');
}

http
  .createServer((req, res) => {
    layani(req, res).catch((err) => {
      log.error('permintaan gagal', { err: err.message, path: req.url });
      if (!res.headersSent) galat(res, 500, 'internal', 'Terjadi kesalahan');
      else res.end();
    });
  })
  .listen(PORT, () => log.info('bookmark-service siap', { port: PORT }));
