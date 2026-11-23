/**
 * vote-persist-worker (T9.2): penyimpanan suara write-behind.
 *
 * q.vote-persist (vote.cast) -> batch maksimal BATCH_MAKS pesan atau
 * BATCH_JEDA_MS -> UPSERT vote_db dalam satu transaksi -> ack.
 * Konsumen tidak memakai buatKonsumen pustaka karena butuh ack per batch,
 * tetapi topologi queue (DLQ, delivery limit) sama: pastikanAntrean.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { buatLogger, hubungkan, jalankanMigrasi, pastikanAntrean } from '@puisiapp/events';
import { buatFastify, buatMetrik, pasangDasar } from '@puisiapp/poem-common';
import { buatPengumpul } from './batch.js';
import { simpanBatch } from './repo.js';

const namaLayanan = (process.env.SERVICE_NAME ??= 'vote-persist-worker');
const log = buatLogger(namaLayanan);
const folderIni = path.dirname(fileURLToPath(import.meta.url));
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL belum diisi');

const angka = (nama, bawaan) => {
  const n = Number(process.env[nama]);
  return Number.isInteger(n) && n > 0 ? n : bawaan;
};
const MAKS = angka('BATCH_MAKS', 200);
const JEDA_MS = angka('BATCH_JEDA_MS', 1000);
const ANTREAN = 'q.vote-persist';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 4,
  connectionTimeoutMillis: 2000,
  statement_timeout: 10_000,
});
pool.on('error', (err) => log.error('galat koneksi idle PostgreSQL', { err }));
await jalankanMigrasi(pool, { folder: path.join(folderIni, '../migrations'), standar: false, log });

const metrik = buatMetrik(namaLayanan, {
  nama: 'rasa_vote_persist_messages_total',
  bantuan: 'Pesan vote.cast menurut hasil (disimpan, dikembalikan, dlq)',
});

const koneksi = await hubungkan({ log });
const ch = await koneksi.createChannel();
// prefetch >= ukuran batch: tanpa ini batch tidak pernah penuh.
await ch.prefetch(MAKS);
await pastikanAntrean(ch, ANTREAN, ['vote.cast']);

const pengumpul = buatPengumpul({
  maks: MAKS,
  jedaMs: JEDA_MS,
  log,
  simpan: async (baris) => {
    const t0 = performance.now();
    const berubah = await simpanBatch(pool, baris);
    log.debug('batch disimpan', { baris: baris.length, berubah, ms: Math.round(performance.now() - t0) });
  },
  ack: (pesan) => {
    ch.ack(pesan);
    metrik.pengajuan.inc({ hasil: 'disimpan' });
  },
  kembalikan: (pesan) => {
    ch.nack(pesan, false, true);
    metrik.pengajuan.inc({ hasil: 'dikembalikan' });
  },
  keDlq: (pesan) => {
    ch.nack(pesan, false, false);
    metrik.pengajuan.inc({ hasil: 'dlq' });
  },
});

const { consumerTag } = await ch.consume(ANTREAN, (pesan) => pesan && pengumpul.tambah(pesan), { noAck: false });
log.info('konsumen batch berjalan', { antrean: ANTREAN, maks: MAKS, jeda_ms: JEDA_MS });

const app = buatFastify();
pasangDasar(app, {
  log,
  metrik,
  cekSiap: async () => {
    await pool.query('SELECT 1');
  },
});
const port = Number(process.env.PORT ?? 8080);
await app.listen({ host: '0.0.0.0', port });

let berhenti = false;
for (const sinyal of ['SIGTERM', 'SIGINT']) {
  process.on(sinyal, async () => {
    if (berhenti) return;
    berhenti = true;
    log.info('berhenti', { sinyal });
    await ch.cancel(consumerTag).catch(() => {});
    await pengumpul.selesai().catch(() => {}); // batch terakhir disimpan dan di-ack dulu
    await ch.close().catch(() => {});
    await koneksi.close().catch(() => {});
    await app.close().catch(() => {});
    await pool.end().catch(() => {});
    log.info('berhenti bersih', pengumpul.statistik);
    process.exit(0);
  });
}
