/**
 * Handler konsumen q.publication: baca keadaan -> putuskan -> simpan dengan
 * optimistic locking -> tulis event keluar ke outbox. Semua di dalam satu
 * transaksi yang dibuka store (bersama pencatatan processed_event), sehingga
 * perubahan status dan event keluar tersimpan bersama atau tidak sama sekali.
 */
import { GalatPermanen, eventTurunan, tulisOutbox } from '@puisiapp/events';
import { poemIdDariEvent, putuskan } from './mesin.js';
import { ambil, simpan } from './repo.js';

export const IKATAN = ['poem.submitted', 'poem.revised', 'poem.deleted', 'poem.similarity.scored', 'case.decided'];

const POLA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class GalatTunda extends Error {
  constructor(alasan) {
    super(`event ditunda: ${alasan}`);
    this.name = 'GalatTunda';
  }
}

/**
 * @param {object} [d]
 * @param {{ transisi: { inc: Function } }} [d.metrik]
 * @param {() => Date} [d.sekarang]
 */
export function buatHandler(d = {}) {
  return async function tangani(event, { tx, log }) {
    const poemId = poemIdDariEvent(event);
    if (typeof poemId !== 'string' || !POLA_UUID.test(poemId)) {
      throw new GalatPermanen(`poem_id bukan UUID: ${poemId}`);
    }

    const lama = await ambil(tx, poemId);
    const putusan = putuskan(lama, event, { sekarang: d.sekarang });
    const ringkas = {
      poem_id: poemId,
      status_lama: lama?.status ?? null,
      alasan: putusan.alasan,
      decision: event.payload?.decision,
    };
    d.metrik?.transisi.inc({ event_type: event.event_type, aksi: putusan.aksi });

    switch (putusan.aksi) {
      case 'tunda':
        // Bukan GalatPermanen: konsumen menjadwalkan ulang (2, 8, 32 dtk), lalu DLQ.
        throw new GalatTunda(putusan.alasan);
      case 'tolak':
        log.warn('transisi tidak sah ditolak', ringkas);
        return;
      case 'basi':
        log.info('event basi diabaikan', ringkas);
        return;
      case 'abaikan':
        log.info('event diabaikan', ringkas);
        return;
      default:
        break;
    }

    await simpan(tx, lama, putusan.keadaan);
    for (const k of putusan.keluaran ?? []) {
      await tulisOutbox(
        tx,
        eventTurunan(event, k.jenis, k.payload, { aggregateId: poemId, aggregateVersion: k.versi }),
        { aggregateType: 'poem' },
      );
    }
    log.info('status publikasi berubah', {
      ...ringkas,
      status_baru: putusan.keadaan.status,
      versi: putusan.keadaan.versi,
      versi_tampil: putusan.keadaan.versi_tampil,
      terbit: (putusan.keluaran ?? []).map((k) => k.jenis),
    });
  };
}
