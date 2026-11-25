/**
 * vote-service (T9.1): suara upvote/downvote atomik di Redis.
 *
 * Proses API : PUT/GET /api/poems/{id}/vote (src/app.js), menerbitkan vote.cast
 *              langsung ke RabbitMQ (tanpa outbox: Redis adalah sumber
 *              kebenaran sementara, vote-persist-worker menyimpannya permanen).
 * Proses konsumen: salinan pemilik/status puisi dan umur akun (src/proyeksi.js)
 *              di queue q.vote-service.
 */
import { buatKonsumen, buatLogger, buatPublisher, buatStoreTanpaDb, hubungkan } from '@puisiapp/events';
import { buatMetrik } from '@puisiapp/poem-common';
import { buatApp } from './app.js';
import { IKATAN, proyeksikan } from './proyeksi.js';
import { buatKlienRedis, buatToko } from './toko.js';

const namaLayanan = (process.env.SERVICE_NAME ??= 'vote-service');
const log = buatLogger(namaLayanan);

const angka = (nama, bawaan) => {
  const n = Number(process.env[nama]);
  return Number.isFinite(n) && n > 0 ? n : bawaan;
};

const redis = await buatKlienRedis({ url: process.env.REDIS_URL, log });
const toko = buatToko(redis);

const koneksi = await hubungkan({ log });
const publisher = await buatPublisher(koneksi);
const konsumen = await buatKonsumen({
  koneksi,
  log,
  antrean: 'q.vote-service',
  ikatan: IKATAN,
  store: buatStoreTanpaDb(),
  handler: async (event) => {
    await proyeksikan(toko, event);
  },
});

const app = buatApp({
  toko,
  terbitkan: (event) => publisher.terbitkan(event),
  cekSiap: async () => {
    if (!toko.siap()) throw new Error('Redis belum siap');
  },
  log,
  metrik: buatMetrik(namaLayanan, {
    nama: 'rasa_votes_total',
    bantuan: 'Permintaan suara menurut hasil (diterima, sama, pemilik, belum_terbit, tidak_ada, rate_limit, gagal_terbit)',
  }),
  opsi: {
    ratePerMenit: angka('VOTE_RATE_PER_MENIT', 30),
    bobotAkunBaru: Math.min(1, angka('VOTE_BOBOT_AKUN_BARU', 0.5)),
  },
});
const port = Number(process.env.PORT ?? 8080);
await app.listen({ host: '0.0.0.0', port });
log.info('http siap', { port, ikatan: IKATAN });

let berhenti = false;
for (const sinyal of ['SIGTERM', 'SIGINT']) {
  process.on(sinyal, async () => {
    if (berhenti) return;
    berhenti = true;
    log.info('berhenti', { sinyal });
    await app.close().catch(() => {});
    await konsumen.berhenti().catch(() => {});
    await koneksi.close().catch(() => {});
    await redis.quit().catch(() => {});
    process.exit(0);
  });
}
