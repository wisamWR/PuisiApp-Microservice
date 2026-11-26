/**
 * register-service (T1.1): POST /api/auth/register.
 * Jalur sinkron: validasi -> simpan akun + outbox -> 201. Event dikirim
 * outbox-relay (T0.3) ke RabbitMQ setelah transaksi commit.
 */
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { buatLogger, jalankanMigrasi } from '@puisiapp/events';
import { validasiRegistrasi } from './validasi.js';
import { daftarAkun, GalatDuplikat } from './daftar.js';
import { ubahPeran } from './ubahPeran.js';
import { hapusAkun } from './hapus.js';
import { cariAkun } from './cari.js';
import { validasiPeran } from './peran.js';
import { buatMetrikHttp } from './metrics.js';

const log = buatLogger();
const folderIni = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8080;
const metrik = buatMetrikHttp('register-service');
const MAKS_BODY = 16 * 1024;

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL belum diisi');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });

// outbox: true -> tabel outbox + publication untuk relay (T0.3)
await jalankanMigrasi(pool, { folder: path.join(folderIni, '../migrations'), outbox: true, log });

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
  let rute = 'tidak_dikenal';
  res.once('finish', () => metrik.catatRequest(req.method, rute, res.statusCode, mulai));
  const url = new URL(req.url, 'http://local');

  if (req.method === 'GET' && url.pathname === '/metrics') {
    const body = "# HELP register_service_up up\n# TYPE register_service_up gauge\nregister_service_up 1\n";
    res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
    return res.end(body);
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    rute = '/health';
    return kirimJson(res, 200, { status: 'ok' });
  }

  if (req.method === 'GET' && url.pathname === '/metrics') {
    rute = '/metrics';
    return metrik.layaniMetrics(res);
  }

  // Ubah peran (T1.7): hanya admin. Gateway sudah menolak non-admin; layanan memeriksa lagi.
  const cocokPeran = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/role$/);
  if (cocokPeran && req.method === 'PUT') {
    rute = '/api/admin/users/:id/role';
    if (req.headers['x-user-role'] !== 'admin') {
      // Catat peran yang diterima untuk diagnosis (tanpa token atau kata sandi).
      log.warn('ubah peran ditolak', { peran_diterima: req.headers['x-user-role'] ?? null, id_pemanggil: req.headers['x-user-id'] ?? null });
      return kirimJson(res, 403, { error: 'forbidden' });
    }
    if (!/^[0-9a-f-]{36}$/i.test(cocokPeran[1])) return kirimJson(res, 404, { error: 'akun tidak ditemukan' });
    let body;
    try {
      body = JSON.parse((await bacaBody(req)) || '{}');
    } catch {
      return kirimJson(res, 400, { error: 'JSON tidak valid' });
    }
    const v = validasiPeran(body);
    if (!v.ok) return kirimJson(res, 400, { error: 'input tidak valid', details: v.errors });
    const hasil = await ubahPeran(pool, cocokPeran[1], v.role, { correlationId: req.headers['x-request-id'] });
    if (hasil.status === 'tidak_ada') return kirimJson(res, 404, { error: 'akun tidak ditemukan' });
    return kirimJson(res, 200, hasil.akun);
  }

  // Hapus akun (T1.7): pemilik saja, konfirmasi kata sandi wajib.
  if (req.method === 'DELETE' && url.pathname === '/api/me') {
    rute = '/api/me';
    const id = req.headers['x-user-id'];
    if (!id) return kirimJson(res, 401, { error: 'unauthorized' });
    let body;
    try {
      body = JSON.parse((await bacaBody(req)) || '{}');
    } catch {
      return kirimJson(res, 400, { error: 'JSON tidak valid' });
    }
    if (typeof body.password !== 'string' || !body.password) {
      return kirimJson(res, 400, { error: 'kata sandi wajib diisi' });
    }
    const hasil = await hapusAkun(pool, id, body.password, { correlationId: req.headers['x-request-id'] });
    if (hasil.status === 'tidak_ada') return kirimJson(res, 404, { error: 'akun tidak ditemukan' });
    if (hasil.status === 'sudah') return kirimJson(res, 409, { error: 'akun sudah dihapus' });
    if (hasil.status === 'salah') return kirimJson(res, 403, { error: 'kata sandi salah' });
    return kirimJson(res, 202, { status: 'pending' }, {
      'Set-Cookie': [
        'access_token=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
        'refresh_token=; Path=/api/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
      ],
    });
  }

  // Cari pengguna untuk admin (T1.7). Gateway sudah memeriksa peran admin; layanan memeriksa lagi.
  if (req.method === 'GET' && url.pathname === '/api/admin/users') {
    rute = '/api/admin/users';
    if (req.headers['x-user-role'] !== 'admin') return kirimJson(res, 403, { error: 'forbidden' });
    const q = (url.searchParams.get('q') ?? '').trim();
    if (q.length < 1 || q.length > 50) return kirimJson(res, 400, { error: 'parameter q wajib diisi (1 sampai 50 karakter)' });
    return kirimJson(res, 200, { items: await cariAkun(pool, q) });
  }

  if (req.method !== 'POST' || url.pathname !== '/api/auth/register') {
    if (url.pathname === '/api/auth/register') rute = '/api/auth/register'; else rute = url.pathname;
    return kirimJson(res, 404, { error: 'tidak ditemukan' });
  }

  let body;
  try {
    body = JSON.parse(await bacaBody(req) || '{}');
  } catch {
    // Jangan catat isi body: bisa berisi kata sandi.
    return kirimJson(res, 400, { error: 'JSON tidak valid' });
  }

  rute = '/api/auth/register';
  const v = validasiRegistrasi(body);
  if (!v.ok) return kirimJson(res, 400, { error: 'input tidak valid', details: v.errors });

  try {
    const akun = await daftarAkun(pool, v.data, {
      correlationId: req.headers['x-request-id'],
    });
    log.info('akun dibuat', { akun_id: akun.id });
    return kirimJson(res, 201, { id: akun.id, username: akun.username });
  } catch (err) {
    if (err instanceof GalatDuplikat) return kirimJson(res, 409, { error: err.message });
    log.error('registrasi gagal', { galat: err.name, pesan: err.message });
    return kirimJson(res, 500, { error: 'galat internal' });
  }
});

server.listen(PORT, () => log.info('register-service siap', { port: PORT }));

function berhenti() {
  server.close(() => pool.end().then(() => process.exit(0)));
}
process.on('SIGTERM', berhenti);
process.on('SIGINT', berhenti);
