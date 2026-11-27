import { createServer } from 'node:http';
import pg from 'pg';
import {
  buatLogger,
  buatKonsumen,
  buatStorePg,
  hubungkan,
  jalankanMigrasi,
} from '@puisiapp/events';
import { buatTransportSmtp, susunPesanEmail } from './mailer.js';

const { Pool } = pg;
const log = buatLogger();
const PORT = Number(process.env.PORT) || 8080;
const SMTP_FROM = process.env.SMTP_FROM || 'PuisiApp <no-reply@puisiapp.local>';

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL belum diisi');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  const transporter = buatTransportSmtp();

  await jalankanMigrasi(pool, { outbox: false, log });

  const healthServer = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'email-worker' }));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'tidak ditemukan' }));
  });

  healthServer.listen(PORT, () => log.info('email-worker health siap', { port: PORT }));

  const koneksi = await hubungkan({ log });
  const konsumen = await buatKonsumen({
    koneksi,
    log,
    antrean: 'q.email-worker',
    ikatan: ['email.send.requested'],
    store: buatStorePg(pool),
    handler: async (event) => {
      const pesan = susunPesanEmail(event.payload, SMTP_FROM);
      await transporter.sendMail(pesan);
      log.info('email terkirim', {
        event_id: event.event_id,
        template: event.payload?.template,
        to: pesan.to,
      });
    },
  });

  async function berhenti() {
    healthServer.close();
    await (konsumen.tutup?.() ?? konsumen.close?.())?.catch(() => {});
    await pool.end().catch(() => {});
    process.exit(0);
  }
  process.on('SIGTERM', berhenti);
  process.on('SIGINT', berhenti);
}

if (process.env.NODE_ENV !== 'test') {
  main().catch((err) => {
    log.error('email-worker gagal start', { galat: err.name, pesan: err.message });
    process.exit(1);
  });
}
