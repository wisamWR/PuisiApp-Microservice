/**
 * ranking-worker (T9.3): skor peringkat Wilson.
 *
 * q.ranking (vote.cast) -> hitungan berbobot di Redis (ranking-store) ->
 * batas bawah Wilson z = 1,96 -> poem.score.updated bila berubah berarti.
 * Diterbitkan langsung ke RabbitMQ (pola consume-process-publish-ack):
 * event_id deterministik dari event sumber, konsumen hilir menyaring duplikat.
 */
import { buatKonsumen, buatLogger, buatPublisher, buatStoreTanpaDb, hubungkan } from '@puisiapp/events';
import { buatFastify, buatMetrik, pasangDasar } from '@puisiapp/poem-common';
import { buatPenangan } from './peringkat.js';
import { buatKlienRedis, buatToko } from './toko.js';

const namaLayanan = (process.env.SERVICE_NAME ??= 'ranking-worker');
const log = buatLogger(namaLayanan);
const ambang = Number(process.env.WILSON_AMBANG ?? 0.001);

const redis = await buatKlienRedis({ url: process.env.REDIS_URL, log });
const toko = buatToko(redis);
const metrik = buatMetrik(namaLayanan, {
  nama: 'rasa_ranking_votes_total',
  bantuan: 'vote.cast yang diproses ranking-worker (diterbitkan = poem.score.updated terbit, tetap = di bawah ambang)',
});

const koneksi = await hubungkan({ log });
const publisher = await buatPublisher(koneksi);
const tangani = buatPenangan({ toko, terbitkan: (e) => publisher.terbitkan(e), ambang });
const konsumen = await buatKonsumen({
  koneksi,
  log,
  antrean: 'q.ranking',
  ikatan: ['vote.cast'],
  store: buatStoreTanpaDb(),
  handler: async (event) => {
    const h = await tangani(event);
    metrik.pengajuan.inc({ hasil: h.diterbitkan ? 'diterbitkan' : 'tetap' });
  },
});

const app = buatFastify();
pasangDasar(app, {
  log,
  metrik,
  cekSiap: async () => {
    if (!toko.siap()) throw new Error('Redis belum siap');
  },
});
const port = Number(process.env.PORT ?? 8080);
await app.listen({ host: '0.0.0.0', port });
log.info('ranking-worker siap', { port, ambang });

let berhenti = false;
for (const sinyal of ['SIGTERM', 'SIGINT']) {
  process.on(sinyal, async () => {
    if (berhenti) return;
    berhenti = true;
    log.info('berhenti', { sinyal });
    await konsumen.berhenti().catch(() => {});
    await koneksi.close().catch(() => {});
    await app.close().catch(() => {});
    await redis.quit().catch(() => {});
    process.exit(0);
  });
}
