/**
 * Koneksi ke RabbitMQ.
 *
 * Strategi pemulihan sengaja sederhana: bila koneksi putus setelah berjalan,
 * proses keluar dengan kode 1 dan Docker (restart: unless-stopped) menyalakan
 * ulang container. Pesan yang belum di-ack dikirim ulang broker dan ditangani
 * konsumen idempoten, sehingga tidak ada state yang perlu dipulihkan manual.
 */
import amqp from 'amqplib';
import { buatLogger } from './log.js';

/**
 * URL AMQP dari variabel lingkungan: AMQP_URL, atau disusun dari
 * RABBITMQ_HOST, RABBITMQ_PORT, RABBITMQ_USER, RABBITMQ_PASS, RABBITMQ_VHOST.
 */
export function urlAmqpDariEnv(env = process.env) {
  if (env.AMQP_URL) return env.AMQP_URL;
  const wajib = ['RABBITMQ_HOST', 'RABBITMQ_USER', 'RABBITMQ_PASS'];
  const kurang = wajib.filter((k) => !env[k]);
  if (kurang.length) throw new Error(`Variabel RabbitMQ belum diisi: ${kurang.join(', ')}`);
  const user = encodeURIComponent(env.RABBITMQ_USER);
  const pass = encodeURIComponent(env.RABBITMQ_PASS);
  const vhost = encodeURIComponent(env.RABBITMQ_VHOST ?? '/');
  return `amqp://${user}:${pass}@${env.RABBITMQ_HOST}:${env.RABBITMQ_PORT ?? 5672}/${vhost}`;
}

const tidur = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {object} [opsi]
 * @param {string} [opsi.url]           default urlAmqpDariEnv()
 * @param {number} [opsi.maksPercobaan] percobaan koneksi awal, default 10
 * @param {boolean} [opsi.keluarSaatPutus] default true
 * @param {ReturnType<typeof buatLogger>} [opsi.log]
 */
export async function hubungkan(opsi = {}) {
  const url = opsi.url ?? urlAmqpDariEnv();
  const log = opsi.log ?? buatLogger();
  const maks = opsi.maksPercobaan ?? 10;
  const keluarSaatPutus = opsi.keluarSaatPutus ?? true;
  const namaKoneksi = process.env.SERVICE_NAME ?? 'tanpa-nama';

  for (let i = 1; ; i++) {
    try {
      const koneksi = await amqp.connect(url, {
        clientProperties: { connection_name: namaKoneksi },
      });
      let ditutupSengaja = false;
      const tutupAsli = koneksi.close.bind(koneksi);
      koneksi.close = async () => {
        ditutupSengaja = true;
        return tutupAsli();
      };
      koneksi.on('error', (err) => log.error('koneksi RabbitMQ error', { err }));
      koneksi.on('close', () => {
        if (ditutupSengaja) return;
        log.error('koneksi RabbitMQ terputus');
        if (keluarSaatPutus) process.exit(1);
      });
      log.info('terhubung ke RabbitMQ');
      return koneksi;
    } catch (err) {
      if (i >= maks) throw err;
      const jeda = Math.min(1000 * 2 ** (i - 1), 10_000);
      log.warn('gagal terhubung ke RabbitMQ, mencoba lagi', { percobaan: i, jeda_ms: jeda, err });
      await tidur(jeda);
    }
  }
}
