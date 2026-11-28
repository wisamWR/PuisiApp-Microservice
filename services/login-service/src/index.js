/**
 * login-service (T1.2).
 *   POST /api/auth/login   publik, dibatasi gateway (10 per menit per IP) dan penundaan 5 gagal per 15 menit.
 *   GET  /health
 * Konsumer: event user.credentials.created dari queue q.login.user-credentials -> tabel credentials.
 */
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { buatLogger, buatKonsumen, buatStorePg, hubungkan, jalankanMigrasi } from '@puisiapp/events';
import { loginDenganKredensial } from './login.js';
import { simpanKredensial, ubahPeranKredensial, hapusKredensial, perbaruiKataSandi } from './kredensial.js';
import { cookieAkses, cookieRefresh } from './cookie.js';
import { buatMetrikHttp } from './metrics.js';
import { buatKlienToken, TokenServiceUnavailableError } from './token-client.js';

const log = buatLogger();
const folderIni = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8080;
const metrik = buatMetrikHttp('login-service');
const MAKS_BODY = 4 * 1024;

for (const nama of ['DATABASE_URL', 'TOKEN_SERVICE_URL']) {
  if (!process.env[nama]) throw new Error(`${nama} belum diisi`);
}
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX) || 10,
  connectionTimeoutMillis: 2000,
  statement_timeout: 5000,
  // Batas di sisi klien: statement_timeout tidak berlaku bila server beku/tak menjawab.
  query_timeout: 6_000,
});
pool.on('error', (err) => log.error('galat koneksi idle PostgreSQL', { err }));

await jalankanMigrasi(pool, { folder: path.join(folderIni, '../migrations'), outbox: false, log });

// Konsumer dinyalakan bila RabbitMQ dikonfigurasi (di compose selalu ada).
let konsumen = null;
if (process.env.RABBITMQ_HOST) {
  const koneksi = await hubungkan({ log });
  konsumen = await buatKonsumen({
    koneksi,
    log,
    antrean: 'q.login.user-credentials',
    ikatan: ['user.credentials.created'],
    store: buatStorePg(pool),
    handler: simpanKredensial,
  });
  await buatKonsumen({
    koneksi,
    log,
    antrean: 'q.login.user-password-reset',
    ikatan: ['user.password.reset'],
    store: buatStorePg(pool),
    handler: perbaruiKataSandi,
  });
  await buatKonsumen({
    koneksi,
    log,
    antrean: 'q.login.user-role-changed',
    ikatan: ['user.role.changed'],
    store: buatStorePg(pool),
    handler: ubahPeranKredensial,
  });
  await buatKonsumen({
    koneksi,
    log,
    antrean: 'q.login.user-deleted',
    ikatan: ['user.deleted'],
    store: buatStorePg(pool),
    handler: hapusKredensial,
  });
  log.info('konsumen user.credentials.created aktif');
}

const klienToken = buatKlienToken({
  baseUrl: process.env.TOKEN_SERVICE_URL,
  log,
});

async function mintaToken(akun) {
  return klienToken.mintaToken(akun);
}

function kirimJson(res, status, body, header = {}) {
  const teks = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(teks),
    ...header,
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
  const url = new URL(req.url, 'http://local');
  let rute = 'tidak_dikenal';
  res.once('finish', () => {
    metrik.catatRequest(req.method, rute, res.statusCode, mulai);
  });


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

  if (req.method !== 'POST' || url.pathname !== '/api/auth/login') {
    rute = url.pathname;
    return kirimJson(res, 404, { error: 'tidak ditemukan' });
  }
  rute = '/api/auth/login';

  let body;
  try {
    body = JSON.parse((await bacaBody(req)) || '{}');
  } catch {
    // Jangan catat isi body: bisa berisi kata sandi.
    return kirimJson(res, 400, { error: 'JSON tidak valid' });
  }
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!username || !password) return kirimJson(res, 400, { error: 'username dan password wajib diisi' });

  try {
    const hasil = await loginDenganKredensial(pool, username, password);
    if (hasil.status === 429) {
      return kirimJson(res, 429, { error: 'terlalu banyak percobaan, coba lagi nanti' }, { 'Retry-After': String(hasil.tungguDetik) });
    }
    if (hasil.status === 401) {
      return kirimJson(res, 401, { error: 'username atau password salah' });
    }
    const { access_token, refresh_token } = await mintaToken(hasil.akun);
    log.info('login berhasil', { akun_id: hasil.akun.id });
    return kirimJson(res, 200, { username: hasil.akun.username, role: hasil.akun.role }, {
      'Set-Cookie': [cookieAkses(access_token), cookieRefresh(refresh_token)],
    });
  } catch (err) {
    if (err instanceof TokenServiceUnavailableError) {
      log.warn('token-service gagal / fail-closed 503', { alasan: err.reason, pesan: err.message });
      return kirimJson(
        res,
        503,
        { error: 'layanan autentikasi sedang tidak tersedia', alasan: err.reason },
        { 'Retry-After': String(err.retryAfterSec || 5) }
      );
    }
    log.error('login gagal diproses', { galat: err.name, pesan: err.message });
    return kirimJson(res, 500, { error: 'galat internal' });
  }
});

server.listen(PORT, () => log.info('login-service siap', { port: PORT }));

async function berhenti() {
  server.close();
  if (konsumen) await konsumen.berhenti?.();
  await pool.end();
  process.exit(0);
}
process.on('SIGTERM', berhenti);
process.on('SIGINT', berhenti);
