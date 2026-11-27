import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import {
  buatLogger,
  buatKonsumen,
  buatStorePg,
  hubungkan,
  jalankanMigrasi,
} from '@puisiapp/events';
import { tanganiPuisi, tanganiProfil, tanganiPendaftaran } from './handler.js';
import { cariPuisi, cariPenulis } from './cari.js';

const log = buatLogger();
const folderIni = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL belum diisi');
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });

await jalankanMigrasi(pool, { folder: path.join(folderIni, '../migrations') });

if (process.env.RABBITMQ_HOST) {
  const koneksi = await hubungkan({ log });
  const store = buatStorePg(pool);

  await buatKonsumen({
    koneksi,
    log,
    antrean: 'q.search-service',
    ikatan: ['poem.submitted', 'poem.revised', 'poem.published', 'poem.hidden', 'poem.deleted', 'poem.keywords.extracted'],
    store,
    handler: tanganiPuisi,
  });
  await buatKonsumen({
    koneksi,
    log,
    antrean: 'q.search-service.profil',
    ikatan: ['user.registered', 'user.profile.updated'],
    store,
    // Satu antrean, dua jenis event: user.registered mengisi nama awal, user.profile.updated menimpa nama.
    handler: (event, ctx) => (event.event_type === 'user.registered'
      ? tanganiPendaftaran(event, ctx)
      : tanganiProfil(event, ctx)),
  });
}

const POLA_TIDAK_VALID = { error: 'parameter_tidak_valid' };

function kirimJson(res, status, isi) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(isi));
}

function bilanganBulat(nilai, bawaan, min, maks) {
  if (nilai === null || nilai === undefined || nilai === '') return bawaan;
  const n = Number(nilai);
  if (!Number.isInteger(n) || n < min || n > maks) return null;
  return n;
}

const PORT = Number(process.env.PORT || 8080);
http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');

    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end('{"status":"ok"}');
    }

    if (url.pathname === '/api/search' && req.method === 'GET') {
      const userId = req.headers['x-user-id'];
      if (!userId) return kirimJson(res, 401, { error: 'unauthorized', message: 'Silakan masuk terlebih dahulu' });

      const q = (url.searchParams.get('q') || '').trim();
      const type = url.searchParams.get('type') || 'poem';
      const page = bilanganBulat(url.searchParams.get('page'), 1, 1, 10_000);
      const size = bilanganBulat(url.searchParams.get('size'), 20, 1, 50);

      if (!q || q.length > 100 || !['poem', 'author'].includes(type) || page === null || size === null) {
        return kirimJson(res, 400, { ...POLA_TIDAK_VALID, message: 'q wajib (maks 100), type poem|author, page>=1, size 1..50' });
      }

      try {
        const hasil = type === 'poem'
          ? await cariPuisi(pool, { q, page, size })
          : await cariPenulis(pool, { q, page, size });
        return kirimJson(res, 200, { type, ...hasil, page, size });
      } catch (err) {
        log.error('pencarian gagal', { err: err.message });
        return kirimJson(res, 500, { error: 'internal', message: 'Pencarian gagal' });
      }
    }

    res.writeHead(404);
    res.end();
  })
  .listen(PORT, () => log.info('search-service siap', { port: PORT }));
