/**
 * Entrypoint status-stream-service (T2.7). Boleh lebih dari satu replika:
 * setiap replika berlangganan Redis pub/sub sendiri.
 */
import { buatLogger } from '@puisiapp/events';
import { buatMetrik } from '@puisiapp/poem-common';
import { langkahAktif } from './langkah.js';
import { buatKeadaan, buatKlienRedis } from './keadaan.js';
import { buatPelanggan } from './pelanggan.js';
import { buatAppStream } from './stream-app.js';

const namaLayanan = (process.env.SERVICE_NAME ??= 'status-stream-service');
const log = buatLogger(namaLayanan);

const redis = buatKlienRedis();
redis.on('error', (err) => log.warn('galat Redis', { err }));
await redis.connect();
const subscriber = redis.duplicate();
subscriber.on('error', (err) => log.warn('galat Redis subscriber', { err }));
await subscriber.connect();

const keadaan = buatKeadaan(redis, { langkah: langkahAktif() });
const { app, tutupSemua } = buatAppStream({
  keadaan,
  pelanggan: buatPelanggan(subscriber),
  cekSiap: async () => {
    if (!redis.isReady || !subscriber.isReady) throw new Error('Redis belum siap');
  },
  log,
  metrik: buatMetrik(namaLayanan, { nama: 'rasa_status_stream_connections_total', bantuan: 'Koneksi SSE status pemrosesan' }),
});

const port = Number(process.env.PORT ?? 8080);
await app.listen({ host: '0.0.0.0', port });
log.info('http siap', { port });

let berhenti = false;
for (const sinyal of ['SIGTERM', 'SIGINT']) {
  process.on(sinyal, async () => {
    if (berhenti) return;
    berhenti = true;
    log.info('berhenti', { sinyal });
    tutupSemua();
    await app.close().catch(() => {});
    await subscriber.close().catch(() => {});
    await redis.close().catch(() => {});
    process.exit(0);
  });
}
