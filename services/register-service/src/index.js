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

const log = buatLogger();
const folderIni = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8080;
const MAKS_BODY = 16 * 1024;

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL belum diisi');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });

// outbox: true -> tabel outbox + publication untuk relay (T0.3)
await jalankanMigrasi(pool, { folder: path.join(folderIni, '../migrations'), outbox: true, log });

function kirimJson(res, status, body) {
  const teks = JSON.stringify(body);
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
  const url = new URL(req.url, 'http://local');

  if (req.method === 'GET' && url.pathname === '/health') {
    return kirimJson(res, 200, { status: 'ok' });
  }

  if (req.method !== 'POST' || url.pathname !== '/api/auth/register') {
    return kirimJson(res, 404, { error: 'tidak ditemukan' });
  }

  let body;
  try {
    body = JSON.parse(await bacaBody(req) || '{}');
  } catch {
    // Jangan catat isi body: bisa berisi kata sandi.
    return kirimJson(res, 400, { error: 'JSON tidak valid' });
  }

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
