/**
 * Handler processing-tracker (consume-process-publish-ack, tanpa outbox):
 *
 *   poem.submitted / revised  -> mulai versi, simpan pemilik
 *   hasil worker (6 jenis)    -> tandai langkah, terbitkan poem.processing.updated;
 *                                bila semua langkah versi itu selesai, terbitkan
 *                                poem.processing.completed
 *   poem.published / held / hidden / deleted -> status publikasi
 *
 * Setiap perubahan diumumkan ke Redis pub/sub (kanal status:{poem_id}) agar
 * semua replika status-stream-service meneruskannya ke browser.
 *
 * Idempoten: event keluar memakai event_id deterministik. updated diturunkan
 * dari event hasil (eventTurunan); completed memakai UUIDv5 dari poem_id dan
 * versi, sehingga langkah terakhir yang tiba bersamaan atau dikirim ulang
 * menghasilkan event yang sama dan konsumen hilir menyaring duplikatnya.
 */
import { buatEvent, eventTurunan, uuidv5 } from '@puisiapp/events';
import { EVENT_LANGKAH, EVENT_MULAI, EVENT_PUBLIKASI, poemIdDari, statusProses, versiDari } from './langkah.js';

/** Namespace UUIDv5 untuk poem.processing.completed. */
export const NAMESPACE_SELESAI = '3f0e7c9a-6b2d-5c1e-9a4f-2d8b7e6c5a10';

/**
 * @param {object} d
 * @param {ReturnType<import('./keadaan.js').buatKeadaan>} d.keadaan
 * @param {{ terbitkan: Function }} d.publisher
 * @param {string[]} d.langkah    langkah aktif
 * @param {() => Date} [d.sekarang]
 * @param {{ langkah: { inc: Function } }} [d.metrik]
 */
export function buatHandlerTracker(d) {
  const sekarang = () => (d.sekarang ? d.sekarang() : new Date()).toISOString();
  const producer = process.env.SERVICE_NAME ?? 'processing-tracker';

  async function umumkan(poemId) {
    const hasil = await d.keadaan.snapshot(poemId);
    if (hasil) await d.keadaan.umumkan(poemId, hasil.snapshot);
  }

  return async function tangani(event, { log }) {
    const poemId = poemIdDari(event);
    const versi = versiDari(event);
    const t = sekarang();

    if (EVENT_MULAI.includes(event.event_type)) {
      await d.keadaan.mulai(poemId, versi, event.payload?.author_id ?? '', t);
      await umumkan(poemId);
      return;
    }

    const status = EVENT_PUBLIKASI[event.event_type];
    if (status) {
      if (await d.keadaan.publikasi(poemId, status, event.occurred_at, t)) await umumkan(poemId);
      return;
    }

    const langkah = EVENT_LANGKAH[event.event_type];
    if (!langkah) return;
    if (!d.langkah.includes(langkah)) {
      log.debug('langkah tidak aktif, diabaikan', { langkah });
      return;
    }

    const baru = await d.keadaan.langkahSelesai(poemId, versi, langkah, t);
    d.metrik?.langkah.inc({ langkah, baru: String(baru) });
    const selesai = await d.keadaan.langkahVersi(poemId, versi);
    const lengkap = selesai.length === d.langkah.length;

    // Diterbitkan juga saat pengiriman ulang (baru = false): event_id sama, jadi
    // aman, dan event yang hilang karena crash sebelum publish tetap terkirim.
    await d.publisher.terbitkan(
      eventTurunan(
        event,
        'poem.processing.updated',
        { poem_id: poemId, status: statusProses(versi, false), stage: langkah },
        { aggregateId: poemId, aggregateVersion: versi },
      ),
    );

    if (lengkap) {
      const selesaiAt = await d.keadaan.tandaiSelesai(poemId, versi, t);
      await d.publisher.terbitkan(
        buatEvent(
          'poem.processing.completed',
          poemId,
          versi,
          { poem_id: poemId, completed_at: selesaiAt, status: 'COMPLETED' },
          {
            producer,
            eventId: uuidv5(`${producer}:poem.processing.completed:${poemId}:${versi}`, NAMESPACE_SELESAI),
            correlationId: event.correlation_id,
            causationId: event.event_id,
            traceparent: event.traceparent,
          },
        ),
      );
      log.info('pemrosesan selesai', { poem_id: poemId, versi });
    }
    await umumkan(poemId);
  };
}
