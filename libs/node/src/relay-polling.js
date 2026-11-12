/**
 * Relay outbox cadangan berbasis polling (rencana cadangan T0.3, Tabel 15.1
 * laporan). Dipakai bila Debezium tidak dapat dijalankan. Format tabel outbox
 * sama, sehingga kode layanan tidak berubah saat relay diganti.
 *
 * Setiap putaran:
 *   BEGIN
 *   SELECT ... FROM outbox ORDER BY created_at LIMIT n FOR UPDATE SKIP LOCKED
 *   publish ke outbox.relay (routing key = event_type) dengan publisher confirm
 *   DELETE baris yang sudah terkonfirmasi
 *   COMMIT
 *
 * SKIP LOCKED membuat beberapa replika relay aman berjalan bersamaan. Bila
 * proses mati setelah publish tetapi sebelum COMMIT, baris diterbitkan ulang
 * (at-least-once) dan konsumen idempoten menyaring duplikatnya.
 *
 * Jangan menjalankan relay polling dan Debezium untuk database yang sama.
 */
import { buatLogger } from './log.js';
import { opsiPesan, publishDenganKonfirmasi } from './publisher.js';
import { EXCHANGE_RELAY } from './topologi.js';

const tidur = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Satu putaran relay. Mengembalikan jumlah event yang diterbitkan.
 * @param {import('pg').Pool} pool
 * @param {import('amqplib').ConfirmChannel} ch
 * @param {number} ukuranBatch
 */
export async function relaySatuPutaran(pool, ch, ukuranBatch = 100) {
  const tx = await pool.connect();
  try {
    await tx.query('BEGIN');
    const { rows } = await tx.query(
      `SELECT event_id, event_type, payload FROM outbox
       ORDER BY created_at, event_id
       LIMIT $1 FOR UPDATE SKIP LOCKED`,
      [ukuranBatch],
    );
    if (rows.length === 0) {
      await tx.query('COMMIT');
      return 0;
    }
    await Promise.all(
      rows.map((r) =>
        publishDenganKonfirmasi(
          ch,
          EXCHANGE_RELAY,
          r.event_type,
          Buffer.from(JSON.stringify(r.payload), 'utf8'),
          opsiPesan(r.payload),
        ),
      ),
    );
    await tx.query('DELETE FROM outbox WHERE event_id = ANY($1::uuid[])', [rows.map((r) => r.event_id)]);
    await tx.query('COMMIT');
    return rows.length;
  } catch (err) {
    await tx.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    tx.release();
  }
}

/**
 * Jalankan relay polling sampai berhenti() dipanggil.
 * @param {object} o
 * @param {import('pg').Pool} o.pool
 * @param {import('amqplib').ChannelModel} o.koneksi
 * @param {number} [o.intervalMs]  jeda saat outbox kosong, default 200 ms
 * @param {number} [o.ukuranBatch] default 100
 * @param {ReturnType<typeof buatLogger>} [o.log]
 */
export async function jalankanRelayPolling(o) {
  const log = o.log ?? buatLogger();
  const intervalMs = o.intervalMs ?? 200;
  const ch = await o.koneksi.createConfirmChannel();
  let jalan = true;

  const selesai = (async () => {
    while (jalan) {
      try {
        const n = await relaySatuPutaran(o.pool, ch, o.ukuranBatch);
        if (n > 0) log.debug('event outbox diterbitkan', { jumlah: n });
        else await tidur(intervalMs);
      } catch (err) {
        log.error('putaran relay gagal, dicoba lagi', { err });
        await tidur(Math.max(intervalMs, 1000));
      }
    }
  })();

  log.info('relay polling berjalan', { interval_ms: intervalMs });
  return {
    async berhenti() {
      jalan = false;
      await selesai;
      await ch.close().catch(() => {});
    },
  };
}

/**
 * Hapus baris outbox lama. Hanya untuk mode Debezium (relay polling sudah
 * menghapus barisnya sendiri). Publication hanya menerbitkan INSERT, jadi
 * DELETE tidak menghasilkan event.
 * @param {import('pg').Pool} pool
 * @param {{ umurJam?: number }} [opsi] default 24 jam
 */
export async function bersihkanOutbox(pool, opsi = {}) {
  const { rowCount } = await pool.query(
    `DELETE FROM outbox WHERE created_at < now() - make_interval(hours => $1)`,
    [opsi.umurJam ?? 24],
  );
  return rowCount;
}
