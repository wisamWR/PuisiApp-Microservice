/**
 * profile-service (T1.5).
 *   GET /api/profiles/{id}   publik (gateway membatasi hanya GET)
 *   GET /api/profiles/me     wajib login: X-User-Id dari gateway
 *   PUT /api/profiles/me     wajib login: ubah nama tampil dan bio milik sendiri
 * Konsumer: user.registered -> buat profil awal.
 */
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { buatKonsumen, buatLogger, buatStorePg, hubungkan, jalankanMigrasi } from '@puisiapp/events';
import { validasiProfil } from './validasi.js';
import { ambilProfil, buatProfilAwal, ubahProfil } from './profil.js';
import { buatMetrikHttp } from './metrics.js';

const log = buatLogger();
const folderIni = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8080;
const metrik = buatMetrikHttp('profile-service');
const MAKS_BODY = 8 * 1024;
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL belum diisi');
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX) || 10,
  connectionTimeoutMillis: 2000,
  statement_timeout: 5000,
  // Batas di sisi klien: statement_timeout tidak berlaku bila server beku/tak menjawab.
  query_timeout: 6_000,
});
pool.on('error', (err) => log.error('galat koneksi idle PostgreSQL', { err }));

await jalankanMigrasi(pool, { folder: path.join(folderIni, '../migrations'), outbox: true, log });

let konsumen = null;
if (process.env.RABBITMQ_HOST) {
  const koneksi = await hubungkan({ log });
  konsumen = await buatKonsumen({
    koneksi,
    log,
    antrean: 'q.profile.user-registered',
    ikatan: ['user.registered'],
    store: buatStorePg(pool),
    handler: buatProfilAwal,
  });
  log.info('konsumen user.registered aktif');
}

function kirimJson(res, status, body) {
  const teks = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(teks),
  });
  res.end(teks);
}

function bacaBody(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const bagian = [];
    req.on('data', (c) => {
      total += c.length;
      if (total > MAKS_BODY) {
        reject(new Error('body terlalu besar'));
        req.destroy();
        return;
      }
      bagian.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(bagian).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const mulai = performance.now();
  let rute = 'tidak_dikenal';
  res.once('finish', () => metrik.catatRequest(req.method, rute, res.statusCode, mulai));
  const url = new URL(req.url, 'http://local');
  const idPengguna = req.headers['x-user-id'];

  try {

    if (req.method === 'GET' && url.pathname === '/health') {
      rute = '/health';
      return kirimJson(res, 200, { status: 'ok' });
    }
    // Readiness: ikut memeriksa PostgreSQL. Dipakai healthcheck Docker (dan nanti load balancer),
    // sehingga layanan yang kehilangan DB ditandai unhealthy tanpa harus restart.
    if (req.method === 'GET' && url.pathname === '/health/ready') {
      rute = '/health/ready';
      try {
        await pool.query('SELECT 1');
        return kirimJson(res, 200, { status: 'ok' });
      } catch {
        return kirimJson(res, 503, { status: 'db_tidak_siap' });
      }
    }

    if (req.method === 'GET' && url.pathname === '/metrics') {
      rute = '/metrics';
      return metrik.layaniMetrics(res);
    }

    if (url.pathname === '/api/profiles/me') {
      rute = '/api/profiles/me';
      if (!idPengguna) return kirimJson(res, 401, { error: 'unauthorized' });

      if (req.method === 'GET') {
        const profil = await ambilProfil(pool, idPengguna);
        // role diambil dari X-User-Role (hasil verifikasi token di gateway), bukan dari
        // tabel profil: frontend memakainya untuk memulihkan sesi setelah halaman di-reload.
        const role = req.headers['x-user-role'] || 'writer';
        return profil ? kirimJson(res, 200, { ...profil, role }) : kirimJson(res, 404, { error: 'profil tidak ditemukan' });
      }

      if (req.method === 'PUT') {
        let body;
        try {
          body = JSON.parse((await bacaBody(req)) || '{}');
        } catch {
          return kirimJson(res, 400, { error: 'JSON tidak valid' });
        }
        const v = validasiProfil(body);
        if (!v.ok) return kirimJson(res, 400, { error: 'input tidak valid', details: v.errors });

        const hasil = await ubahProfil(pool, idPengguna, v.data, {
          correlationId: req.headers['x-request-id'],
        });
        return hasil ? kirimJson(res, 200, hasil) : kirimJson(res, 404, { error: 'profil tidak ditemukan' });
      }

      return kirimJson(res, 405, { error: 'metode tidak diizinkan' });
    }

    const cocokId = url.pathname.match(/^\/api\/profiles\/([^/]+)$/);
    if (cocokId) {
      rute = '/api/profiles/:id';
      if (req.method !== 'GET') return kirimJson(res, 405, { error: 'metode tidak diizinkan' });
      if (!RE_UUID.test(cocokId[1])) return kirimJson(res, 404, { error: 'profil tidak ditemukan' });
      const profil = await ambilProfil(pool, cocokId[1]);
      return profil ? kirimJson(res, 200, profil) : kirimJson(res, 404, { error: 'profil tidak ditemukan' });
    }

    rute = url.pathname;
    return kirimJson(res, 404, { error: 'tidak ditemukan' });
  } catch (err) {
    log.error('permintaan gagal', { galat: err.name, pesan: err.message });
    return kirimJson(res, 500, { error: 'galat internal' });
  }
});

server.listen(PORT, () => log.info('profile-service siap', { port: PORT }));

async function berhenti() {
  server.close();
  if (konsumen) await konsumen.berhenti?.();
  await pool.end();
  process.exit(0);
}
process.on('SIGTERM', berhenti);
process.on('SIGINT', berhenti);
