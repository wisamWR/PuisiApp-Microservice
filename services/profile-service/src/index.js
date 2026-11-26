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

const log = buatLogger();
const folderIni = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8080;
const MAKS_BODY = 8 * 1024;
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL belum diisi');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });

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
  const url = new URL(req.url, 'http://local');
  const idPengguna = req.headers['x-user-id'];

  try {
  if (req.method === 'GET' && url.pathname === '/metrics') {
    const body = "# HELP profile_service_up up\n# TYPE profile_service_up gauge\nprofile_service_up 1\n";
    res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
    return res.end(body);
  }

    if (req.method === 'GET' && url.pathname === '/health') {
      return kirimJson(res, 200, { status: 'ok' });
    }

    if (url.pathname === '/api/profiles/me') {
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
      if (req.method !== 'GET') return kirimJson(res, 405, { error: 'metode tidak diizinkan' });
      if (!RE_UUID.test(cocokId[1])) return kirimJson(res, 404, { error: 'profil tidak ditemukan' });
      const profil = await ambilProfil(pool, cocokId[1]);
      return profil ? kirimJson(res, 200, profil) : kirimJson(res, 404, { error: 'profil tidak ditemukan' });
    }

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
