/**
 * Konsumen idempoten dengan retry dan DLQ.
 *
 * Urutan untuk setiap pesan:
 *   1. Parse dan validasi amplop. Tidak valid -> DLQ (poison message).
 *   2. store.proses(): lewati bila event_id sudah tercatat (duplikat).
 *   3. Lewati bila versiTersimpan > aggregate_version (event basi), tetap dicatat.
 *   4. Jalankan handler di dalam transaksi yang sama, lalu commit.
 *   5. ack.
 *
 * Bila handler gagal:
 *   - GalatPermanen                 -> DLQ tanpa retry
 *   - galat lain, percobaan < maks  -> exchange retry.delayed dengan jeda acak
 *                                      0..dasar*faktor^n ms (full jitter:
 *                                      <=2 dtk, <=8 dtk, <=32 dtk), lalu ack
 *   - percobaan habis               -> DLQ
 */
import { validasiEvent } from './kontrak.js';
import { apakahPermanen } from './galat.js';
import { buatLogger, traceIdDari } from './log.js';
import { pastikanAntrean, EXCHANGE_RETRY } from './topologi.js';
import { publishDenganKonfirmasi } from './publisher.js';

export const HEADER_PERCOBAAN = 'x-percobaan';

export const BAWAAN = Object.freeze({
  prefetch: 10,
  maksPercobaan: 3,
  jedaDasarMs: 2000,
  faktor: 4,
});

function angkaEnv(nama, cadangan) {
  const nilai = Number(process.env[nama]);
  return Number.isFinite(nilai) && nilai > 0 ? nilai : cadangan;
}

/**
 * Logika pemrosesan satu pesan, terpisah dari channel supaya mudah diuji.
 *
 * @param {import('amqplib').ConsumeMessage} pesan
 * @param {object} d
 * @param {{ proses: Function }} d.store
 * @param {(event: any, ctx: any) => Promise<void>} d.handler
 * @param {(event: any, ctx: any) => Promise<number|null|undefined>} [d.versiTersimpan]
 * @param {() => void} d.ack
 * @param {() => void} d.keDlq              nack tanpa requeue -> dead-letter
 * @param {() => void} d.kembalikan         nack dengan requeue (cadangan bila retry gagal diterbitkan)
 * @param {(percobaanBaru: number, jedaMs: number) => Promise<void>} d.jadwalkanUlang
 * @param {ReturnType<typeof buatLogger>} d.log
 * @param {number} d.maksPercobaan
 * @param {number} d.jedaDasarMs
 * @param {number} d.faktor
 * @param {() => number} [d.acak]
 * @returns {Promise<'diproses'|'duplikat'|'basi'|'retry'|'dlq'|'tidak_valid'|'dikembalikan'>}
 */
export async function tanganiPesan(pesan, d) {
  let event;
  try {
    event = validasiEvent(JSON.parse(pesan.content.toString('utf8')));
  } catch (err) {
    d.log.error('pesan tidak valid, dipindah ke DLQ', { message_id: pesan.properties?.messageId, err });
    d.keDlq();
    return 'tidak_valid';
  }

  const percobaan = Number(pesan.properties?.headers?.[HEADER_PERCOBAAN] ?? 0) || 0;
  const log = d.log.anak({
    event_id: event.event_id,
    event_type: event.event_type,
    correlation_id: event.correlation_id,
    trace_id: traceIdDari(event.traceparent),
    aggregate_id: event.aggregate_id,
    aggregate_version: event.aggregate_version,
  });

  try {
    const hasil = await d.store.proses(event, async (ctxStore) => {
      if (d.versiTersimpan) {
        const tersimpan = await d.versiTersimpan(event, ctxStore);
        if (tersimpan != null && tersimpan > event.aggregate_version) {
          log.warn('event basi diabaikan', { versi_tersimpan: tersimpan });
          return 'basi';
        }
      }
      await d.handler(event, { ...ctxStore, log, percobaan });
      return 'diproses';
    });
    if (hasil === 'duplikat') log.info('event duplikat diabaikan');
    else if (hasil === 'diproses') log.debug('event diproses');
    d.ack();
    return hasil;
  } catch (err) {
    if (apakahPermanen(err)) {
      log.error('galat permanen, dipindah ke DLQ', { err, percobaan });
      d.keDlq();
      return 'dlq';
    }
    if (percobaan >= d.maksPercobaan) {
      log.error('percobaan habis, dipindah ke DLQ', { err, percobaan });
      d.keDlq();
      return 'dlq';
    }
    const acak = d.acak ?? Math.random;
    const jedaMs = Math.floor(acak() * d.jedaDasarMs * d.faktor ** percobaan);
    try {
      await d.jadwalkanUlang(percobaan + 1, jedaMs);
      log.warn('galat sementara, dijadwalkan ulang', { err, percobaan: percobaan + 1, jeda_ms: jedaMs });
      d.ack();
      return 'retry';
    } catch (errRetry) {
      log.error('gagal menjadwalkan retry, pesan dikembalikan ke queue', { err: errRetry });
      d.kembalikan();
      return 'dikembalikan';
    }
  }
}

/**
 * Mulai mengonsumsi satu queue.
 *
 * @param {object} o
 * @param {import('amqplib').ChannelModel} o.koneksi
 * @param {string} o.antrean           mis. "q.poem-query"
 * @param {string[]} o.ikatan          event_type yang dikonsumsi
 * @param {(event: import('./amplop.js').Event, ctx: { tx?: import('pg').PoolClient, log: any, percobaan: number }) => Promise<void>} o.handler
 * @param {{ proses: Function }} o.store   buatStorePg(pool) atau buatStoreTanpaDb()
 * @param {(event: import('./amplop.js').Event, ctx: any) => Promise<number|null|undefined>} [o.versiTersimpan]
 *        versi entitas yang sudah tersimpan; event dengan versi lebih kecil diabaikan
 * @param {number} [o.prefetch]        default env PREFETCH atau 10
 * @param {number} [o.maksPercobaan]   default 3
 * @param {number} [o.jedaDasarMs]     default 2000
 * @param {number} [o.faktor]          default 4
 * @param {ReturnType<typeof buatLogger>} [o.log]
 */
export async function buatKonsumen(o) {
  const log = (o.log ?? buatLogger()).anak({ queue: o.antrean });
  const prefetch = o.prefetch ?? angkaEnv('PREFETCH', BAWAAN.prefetch);
  const pengaturan = {
    maksPercobaan: o.maksPercobaan ?? BAWAAN.maksPercobaan,
    jedaDasarMs: o.jedaDasarMs ?? BAWAAN.jedaDasarMs,
    faktor: o.faktor ?? BAWAAN.faktor,
  };

  const ch = await o.koneksi.createConfirmChannel();
  await ch.prefetch(prefetch);
  await pastikanAntrean(ch, o.antrean, o.ikatan);

  const sedangDiproses = new Set();

  const { consumerTag } = await ch.consume(
    o.antrean,
    (pesan) => {
      if (!pesan) return; // consumer dibatalkan broker
      const kerja = tanganiPesan(pesan, {
        ...pengaturan,
        store: o.store,
        handler: o.handler,
        versiTersimpan: o.versiTersimpan,
        log,
        ack: () => ch.ack(pesan),
        keDlq: () => ch.nack(pesan, false, false),
        kembalikan: () => ch.nack(pesan, false, true),
        jadwalkanUlang: (percobaanBaru, jedaMs) =>
          publishDenganKonfirmasi(ch, EXCHANGE_RETRY, o.antrean, pesan.content, {
            ...pesan.properties,
            persistent: true,
            headers: {
              ...(pesan.properties.headers ?? {}),
              [HEADER_PERCOBAAN]: percobaanBaru,
              'x-delay': jedaMs,
            },
          }),
      }).catch((err) => log.error('galat tak terduga di konsumen', { err }));
      sedangDiproses.add(kerja);
      kerja.finally(() => sedangDiproses.delete(kerja));
    },
    { noAck: false },
  );

  log.info('konsumen berjalan', { prefetch, ikatan: o.ikatan });

  return {
    /** Graceful shutdown: berhenti mengambil pesan, tunggu yang sedang diproses, tutup channel. */
    async berhenti() {
      await ch.cancel(consumerTag);
      await Promise.allSettled([...sedangDiproses]);
      await ch.close();
      log.info('konsumen berhenti');
    },
  };
}
