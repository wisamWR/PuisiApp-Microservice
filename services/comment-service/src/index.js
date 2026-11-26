import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { createClient } from 'redis';

import {
  buatLogger,
  buatKonsumen,
  buatStorePg,
  buatEvent,
  simpanDenganOutbox,
  GalatPermanen,
  hubungkan,
  jalankanMigrasi,
} from '@puisiapp/events';

const log = buatLogger();
const folderIni = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL belum diisi');
}

// Koneksi PostgreSQL.
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

// Koneksi Redis untuk rate limiter per pengguna.
const redisClient = createClient({
  socket: {
    host: process.env.REDIS_HOST || 'redis',
    port: Number(process.env.REDIS_PORT || 6379),
  },
  password: process.env.REDIS_PASSWORD,
});

redisClient.on('error', (err) => {
  log.error('Redis connection error', {
    message: err.message,
  });
});

await redisClient.connect();

log.info('Redis rate limiter berhasil terhubung');


// 1. Migrasi database dan tabel outbox standar.
await jalankanMigrasi(pool, {
  folder: path.join(folderIni, '../migrations'),
  outbox: true,
  log,
});

// 2. Hubungkan ke RabbitMQ.
const koneksi = await hubungkan({ log });

// 3. Konsumsi event publikasi puisi.
const statusEvent = {
  'poem.published': 'PUBLISHED',
  'poem.hidden': 'HIDDEN',
  'poem.deleted': 'DELETED',
};

const konsumen = await buatKonsumen({
  koneksi,
  log,
  antrean: 'q.comment-service',
  ikatan: Object.keys(statusEvent),
  store: buatStorePg(pool),
  prefetch: Number(process.env.PREFETCH) || 10,

  // Ambil versi status puisi yang sudah tersimpan.
  versiTersimpan: async (event, { tx }) => {
    const { rows } = await tx.query(
      `SELECT aggregate_version
       FROM poem_publication_status
       WHERE poem_id = $1
       FOR UPDATE`,
      [event.aggregate_id],
    );

    return rows[0]?.aggregate_version;
  },

  // Simpan perubahan status publikasi puisi.
  handler: async (event, { tx, log: logEvent }) => {
    const status = statusEvent[event.event_type];

    if (!status) {
      throw new GalatPermanen(
        `Event publikasi tidak dikenal: ${event.event_type}`,
      );
    }

    await tx.query(
      `INSERT INTO poem_publication_status
         (poem_id, status, aggregate_version)
       VALUES ($1, $2, $3)
       ON CONFLICT (poem_id) DO UPDATE
       SET status = EXCLUDED.status,
           aggregate_version = EXCLUDED.aggregate_version,
           updated_at = now()
       WHERE poem_publication_status.aggregate_version
             <= EXCLUDED.aggregate_version`,
      [
        event.aggregate_id,
        status,
        event.aggregate_version,
      ],
    );

    logEvent.info('status publikasi puisi diperbarui', {
      poem_id: event.aggregate_id,
      status,
      aggregate_version: event.aggregate_version,
    });
  },
});

// 4. Health check.
const port = Number(process.env.PORT ?? 8080);

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, {
      'content-type': 'application/json',
    });

    res.end(JSON.stringify({
      status: 'ok',
      service: process.env.SERVICE_NAME,
    }));

    return;
  }

  res.writeHead(404).end();
});

server.listen(port, () => {
  log.info('comment-service siap', { port });
});

// 5. Graceful shutdown.
let berhenti = false;


async function matikan(sinyal) {
  if (berhenti) return;
  berhenti = true;

  log.info('menerima sinyal, berhenti', { sinyal });

  server.close();

  await konsumen.berhenti()
    .catch((err) => log.error('gagal menghentikan konsumen', { err }));

  await koneksi.close().catch(() => {});
  await pool.end().catch(() => {});
  await redisClient.quit().catch(() => {});

  process.exit(0);
}

process.on('SIGTERM', () => matikan('SIGTERM'));
process.on('SIGINT', () => matikan('SIGINT'));

// ------------------------------------------------------------------
// API GET dan POST komentar

function bersihkanHtml(teks) {
  return teks
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, '')
    .trim();
}

function kirimJson(res, status, data) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
  });
  res.end(JSON.stringify(data));
}

// Rate limiter: maksimal 10 request per user dalam 60 detik.
async function batasiRequest(userId) {
  const key = `rate-limit:comment:${userId}`;

  const jumlah = await redisClient.eval(
    `
      local jumlah = redis.call('INCR', KEYS[1])

      if jumlah == 1 then
        redis.call('EXPIRE', KEYS[1], 60)
      end

      return jumlah
    `,
    {
      keys: [key],
      arguments: [],
    },
  );

  return Number(jumlah) <= 10;
}

function bacaBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let terlaluBesar = false;

    req.on('data', (chunk) => {
      if (terlaluBesar) return;

      body += chunk.toString('utf8');

      if (Buffer.byteLength(body, 'utf8') > 16384) {
        terlaluBesar = true;
        reject(new Error('BODY_TOO_LARGE'));
      }
    });

    req.on('end', () => {
      if (terlaluBesar) return;

      try {
        resolve(JSON.parse(body || '{}'));
      } catch {
        reject(new Error('INVALID_JSON'));
      }
    });

    req.on('error', (err) => {
      if (!terlaluBesar) reject(err);
    });
  });
}


server.removeAllListeners('request');

server.on('request', async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const userId = req.headers['x-user-id'];
  const userRole = req.headers['x-user-role'];
  const correlationId = req.headers['x-request-id'];

  try {
    // Rate limit maksimal 10 request per menit per pengguna.
    const endpointKomentar =
      /^\/api\/poems\/[^/]+\/comments$/.test(url.pathname) ||
      /^\/api\/comments\/[^/]+$/.test(url.pathname) ||
      /^\/api\/comments\/[^/]+\/report$/.test(url.pathname);

    if (
      endpointKomentar &&
      ['GET', 'POST', 'DELETE'].includes(req.method)
    ) {
      if (!userId) {
        return kirimJson(res, 401, {
          error: 'Autentikasi diperlukan',
        });
      }

      const diizinkan = await batasiRequest(userId);

      if (!diizinkan) {
        return kirimJson(res, 429, {
          error: 'Terlalu banyak permintaan. Coba lagi dalam satu menit.',
        });
      }
    }

    if (url.pathname === '/health' && req.method === 'GET') {
      return kirimJson(res, 200, {
        status: 'ok',
        service: process.env.SERVICE_NAME,
      });
    }

    // POST: membuat komentar.
        // Identifikasi endpoint daftar komentar.
    const daftar = url.pathname.match(
      /^\/api\/poems\/([^/]+)\/comments$/,
    );

    // GET: daftar komentar.
    if (daftar && req.method === 'GET') {
      const poemId = decodeURIComponent(daftar[1]);
      const page = Math.max(
        1,
        Number(url.searchParams.get('page')) || 1,
      );
      const limit = 10;
      const offset = (page - 1) * limit;

      const statusPuisi = await pool.query(
        `SELECT status FROM poem_publication_status
         WHERE poem_id = $1`,
        [poemId],
      );

      if (statusPuisi.rows[0]?.status !== 'PUBLISHED') {
        return kirimJson(res, 404, {
          error: 'Puisi tidak tersedia',
        });
      }

      const hasil = await pool.query(
        `SELECT id, poem_id, user_id, content, created_at
         FROM comments
         WHERE poem_id = $1 AND deleted_at IS NULL
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [poemId, limit, offset],
      );

      return kirimJson(res, 200, {
        page,
        limit,
        comments: hasil.rows,
      });
    }
    if (daftar && req.method === 'POST') {
      if (!userId) {
        return kirimJson(res, 401, {
          error: 'Autentikasi diperlukan',
        });
      }

      const poemId = decodeURIComponent(daftar[1]);
      const body = await bacaBody(req);
      const content = bersihkanHtml(
        typeof body.content === 'string' ? body.content : '',
      );

      if (!content || content.length > 1000) {
        return kirimJson(res, 400, {
          error: 'Komentar harus berisi 1-1000 karakter',
        });
      }

      const commentId = randomUUID();
      const createdAt = new Date().toISOString();

      const hasil = await simpanDenganOutbox(
        pool,
        async (tx) => {
          const statusPuisi = await tx.query(
            `SELECT status FROM poem_publication_status
             WHERE poem_id = $1 FOR UPDATE`,
            [poemId],
          );

          if (statusPuisi.rows[0]?.status !== 'PUBLISHED') {
            const error = new Error('PUISI_TIDAK_TERSEDIA');
            error.statusCode = 404;
            throw error;
          }

          await tx.query(
            `INSERT INTO comments
             (id, poem_id, user_id, content, created_at)
             VALUES ($1, $2, $3, $4, $5)`,
            [commentId, poemId, userId, content, createdAt],
          );

          const event = buatEvent(
            'comment.created',
            commentId,
            1,
            {
              comment_id: commentId,
              poem_id: poemId,
              user_id: userId,
              content,
              created_at: createdAt,
            },
            {
              correlationId: correlationId || undefined,
            },
          );

          return {
            hasil: {
              id: commentId,
              poem_id: poemId,
              user_id: userId,
              content,
              created_at: createdAt,
            },
            event,
          };
        },
      );

      return kirimJson(res, 201, hasil);
    }

    // DELETE: menghapus komentar milik sendiri atau oleh moderator.
    const hapus = url.pathname.match(/^\/api\/comments\/([^/]+)$/);

    if (hapus && req.method === 'DELETE') {
      if (!userId) {
        return kirimJson(res, 401, {
          error: 'Autentikasi diperlukan',
        });
      }

      const commentId = decodeURIComponent(hapus[1]);
      const deletedAt = new Date().toISOString();

      const hasil = await simpanDenganOutbox(pool, async (tx) => {
        const komentar = await tx.query(
          `SELECT id, poem_id, user_id
           FROM comments
           WHERE id = $1 AND deleted_at IS NULL
           FOR UPDATE`,
          [commentId],
        );

        if (komentar.rowCount === 0) {
          const error = new Error('COMMENT_NOT_FOUND');
          error.statusCode = 404;
          throw error;
        }

        const data = komentar.rows[0];

        if (data.user_id !== userId && userRole !== 'moderator') {
          const error = new Error('FORBIDDEN');
          error.statusCode = 403;
          throw error;
        }

        await tx.query(
          `UPDATE comments
           SET deleted_at = $1
           WHERE id = $2`,
          [deletedAt, commentId],
        );

        const event = buatEvent(
          'comment.deleted',
          commentId,
          2,
          {
            comment_id: commentId,
            poem_id: data.poem_id,
            user_id: data.user_id,
            deleted_at: deletedAt,
          },
          {
            correlationId: correlationId || undefined,
          },
        );

        return {
          hasil: {
            message: 'Komentar berhasil dihapus',
            comment_id: commentId,
          },
          event,
        };
      });
      return kirimJson(res, 200, hasil);
    }


    // POST: melaporkan komentar untuk ditinjau moderator.
    const laporkan = url.pathname.match(
      /^\/api\/comments\/([^/]+)\/report$/
    );

    if (laporkan && req.method === 'POST') {
      if (!userId) {
        return kirimJson(res, 401, {
          error: 'Autentikasi diperlukan',
        });
      }

      const commentId = decodeURIComponent(laporkan[1]);
      const body = await bacaBody(req);
      const reason =
        typeof body.reason === 'string' ? body.reason.trim() : '';

      if (reason.length > 500) {
        return kirimJson(res, 400, {
          error: 'Alasan laporan maksimal 500 karakter',
        });
      }

      const reportId = randomUUID();
      const reportedAt = new Date().toISOString();

      const hasil = await simpanDenganOutbox(pool, async (tx) => {
        const komentar = await tx.query(
          `SELECT id, poem_id
           FROM comments
           WHERE id = $1 AND deleted_at IS NULL
           FOR UPDATE`,
          [commentId],
        );

        if (komentar.rowCount === 0) {
          const error = new Error('COMMENT_NOT_FOUND');
          error.statusCode = 404;
          throw error;
        }

        const data = komentar.rows[0];

        const event = buatEvent(
          'comment.reported',
          reportId,
          1,
          {
            report_id: reportId,
            comment_id: commentId,
            poem_id: data.poem_id,
            reporter_id: userId,
            ...(reason ? { reason } : {}),
            reported_at: reportedAt,
          },
          {
            correlationId: correlationId || undefined,
          },
        );

        return {
          hasil: {
            message: 'Laporan berhasil dikirim untuk ditinjau',
            report_id: reportId,
          },
          event,
        };
      });

      return kirimJson(res, 202, hasil);
    }

    return kirimJson(res, 404, {
      error: 'Endpoint tidak ditemukan',
    });

  } catch (error) {
    log.error('gagal memproses request komentar', {
      message: error.message,
    });

    if (error.message === 'INVALID_JSON') {
      return kirimJson(res, 400, { error: 'JSON tidak valid' });
    }

    if (error.message === 'BODY_TOO_LARGE') {
      return kirimJson(res, 413, { error: 'Body terlalu besar' });
    }

    const pesanError = {
      400: 'Permintaan tidak valid',
      401: 'Silakan login terlebih dahulu',
      403: 'Anda tidak memiliki izin untuk menghapus komentar ini',
      404: 'Komentar atau puisi tidak ditemukan',
      409: 'Konflik data',
    };

    return kirimJson(res, error.statusCode || 500, {
      error: pesanError[error.statusCode] || 'Terjadi kesalahan server',
    });
  }
});
