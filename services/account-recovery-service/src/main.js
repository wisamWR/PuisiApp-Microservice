import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createClient } from 'redis';
import {
  buatLogger,
  jalankanMigrasi,
  buatKonsumen,
  buatStorePg,
  hubungkan,
} from '@puisiapp/events';
import {
  tanganiUserRegistered,
  verifikasiEmail,
  mintaResetPassword,
  resetPassword,
  RecoveryError,
} from './service.js';

const { Pool } = pg;
const log = buatLogger();
const PORT = Number(process.env.PORT) || 8080;
const MAKS_BODY = 16 * 1024;
const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:8080';

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

export function createApp(pool, deps = {}) {
  return createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://local');

    if (req.method === 'GET' && url.pathname === '/health') {
      return kirimJson(res, 200, { status: 'ok', service: 'account-recovery-service' });
    }

    if (req.method !== 'POST') {
      return kirimJson(res, 404, { error: 'tidak ditemukan' });
    }

    let body;
    try {
      body = JSON.parse((await bacaBody(req)) || '{}');
    } catch {
      return kirimJson(res, 400, { error: 'JSON tidak valid' });
    }

    const ctx = { correlationId: req.headers['x-request-id'] };

    try {
      if (url.pathname === '/api/auth/verify-email') {
        const hasil = await verifikasiEmail(pool, body.token);
        return kirimJson(res, 200, hasil);
      }

      if (url.pathname === '/api/auth/forgot-password') {
        await mintaResetPassword(pool, body.email, ctx, APP_BASE_URL);
        return kirimJson(res, 202, {
          status: 'accepted',
          message: 'Jika email terdaftar, tautan pemulihan telah dikirim.',
        });
      }

      if (url.pathname === '/api/auth/reset-password') {
        const hasil = await resetPassword(
          pool,
          { token: body.token, password: body.password },
          { redis: deps.redis },
        );
        return kirimJson(res, 200, hasil);
      }

      return kirimJson(res, 404, { error: 'tidak ditemukan' });
    } catch (err) {
      if (err instanceof RecoveryError) {
        return kirimJson(res, err.status, { error: err.message });
      }
      log.error('galat account-recovery-service', { galat: err.name, pesan: err.message });
      return kirimJson(res, 500, { error: 'galat internal' });
    }
  });
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL belum diisi');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });

  await jalankanMigrasi(pool, {
    folder: fileURLToPath(new URL('../migrations', import.meta.url)),
    outbox: true,
    log,
  });

  let redis = null;
  if (process.env.REDIS_URL) {
    redis = createClient({ url: process.env.REDIS_URL });
    redis.on('error', (err) => log.error('redis galat', { pesan: err.message }));
    await redis.connect();
  }

  let tutupKonsumen = null;
  if (process.env.RABBITMQ_HOST || process.env.AMQP_URL) {
    const koneksi = await hubungkan({ log });
    const konsumen = await buatKonsumen({
      koneksi,
      log,
      antrean: 'q.account-recovery',
      ikatan: ['user.registered'],
      store: buatStorePg(pool),
      handler: async (event, ctx) => {
        if (event.event_type === 'user.registered') {
          await tanganiUserRegistered(event, ctx, APP_BASE_URL);
        }
      },
    });
    tutupKonsumen = () => konsumen.tutup?.() ?? konsumen.close?.();
  }

  const server = createApp(pool, { redis });
  server.listen(PORT, () => log.info('account-recovery-service siap', { port: PORT }));

  async function berhenti() {
    server.close();
    if (tutupKonsumen) await tutupKonsumen().catch(() => {});
    if (redis) await redis.quit().catch(() => {});
    await pool.end().catch(() => {});
    process.exit(0);
  }
  process.on('SIGTERM', berhenti);
  process.on('SIGINT', berhenti);
}

if (process.env.NODE_ENV !== 'test') {
  main().catch((err) => {
    log.error('account-recovery-service gagal start', { galat: err.name, pesan: err.message });
    process.exit(1);
  });
}
