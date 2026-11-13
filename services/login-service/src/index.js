/**
 * login-service (T1.2).
 *   POST /api/auth/login   publik, dibatasi gateway (10 per menit per IP) dan penundaan 5 gagal per 15 menit.
 *   GET  /health
 * Konsumer: event user.registered dari queue q.login.user-registered -> tabel credentials.
 */
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { buatLogger, buatKonsumen, buatStorePg, hubungkan, jalankanMigrasi } from '@puisiapp/events';
import { loginDenganKredensial } from './login.js';
import { simpanKredensial } from './kredensial.js';
import { cookieAkses, cookieRefresh } from './cookie.js';

const log = buatLogger();
const folderIni = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8080;
const MAKS_BODY = 4 * 1024;

for (const nama of ['DATABASE_URL', 'TOKEN_SERVICE_URL']) {
  if (!process.env[nama]) throw new Error(`${nama} belum diisi`);
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });

await jalankanMigrasi(pool, { folder: path.join(folderIni, '../migrations'), outbox: false, log });

// Konsumer dinyalakan bila RabbitMQ dikonfigurasi (di compose selalu ada).
let konsumen = null;
if (process.env.RABBITMQ_HOST) {
  const koneksi = await hubungkan({ log });
  konsumen = await buatKonsumen({
    koneksi,
    log,
    antrean: 'q.login.user-registered',
    ikatan: ['user.registered'],
    store: buatStorePg(pool),
    handler: simpanKredensial,
  });
  log.info('konsumen user.registered aktif');
}

async function mintaToken(akun) {
  const res = await fetch(`${process.env.TOKEN_SERVICE_URL}/internal/tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sub: akun.id, username: akun.username, role: akun.role }),
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) throw new Error(`token-service membalas ${res.status}`);
  const { access_token, refresh_token } = await res.json();
  return { access_token, refresh_token };
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
  const url = new URL(req.url, 'http://local');

  if (req.method === 'GET' && url.pathname === '/health') {
    return kirimJson(res, 200, { status: 'ok' });
  }

  if (req.method !== 'POST' || url.pathname !== '/api/auth/login') {
    return kirimJson(res, 404, { error: 'tidak ditemukan' });
  }

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
