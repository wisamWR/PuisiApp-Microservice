/**
 * Logika murni suara: validasi nilai, bobot akun, dan pembentukan vote.cast.
 */
import { buatEvent, uuidv5 } from '@puisiapp/events';

/** Namespace UUIDv5 tetap untuk event_id vote.cast (jangan diubah: id harus stabil). */
export const NAMESPACE_VOTE = '5b0c2f4e-8a1d-4f7b-9e3c-2d6a9b1c7e40';

export const NILAI_SAH = new Set([1, -1, 0]);

/** Body PUT: { "nilai": 1 | -1 | 0 }. @returns {number|null} */
export function bacaNilai(body) {
  const nilai = body?.nilai;
  return Number.isInteger(nilai) && NILAI_SAH.has(nilai) ? nilai : null;
}

/** Bobot suara: akun berumur kurang dari 24 jam diberi bobot rendah (anti-brigading). */
export function bobotSuara(akunBaru, bobotAkunBaru) {
  return akunBaru ? bobotAkunBaru : 1;
}

/** Tampilan publik: skor gabungan saja. Rincian naik/turun hanya untuk penulis. */
export function tampilanSkor({ poemId, up, down, nilai, pemilik }) {
  const isi = {
    poem_id: poemId,
    nilai,
    skor: up - down,
    jumlah_suara: up + down,
    pemilik,
    dapat_memilih: !pemilik,
  };
  if (pemilik) {
    isi.naik = up;
    isi.turun = down;
  }
  return isi;
}

/**
 * vote.cast: aggregate_id = poem_id, aggregate_version = seq. event_id
 * deterministik dari (poem_id, seq), sehingga penerbitan ulang tidak
 * menggandakan suara di konsumen.
 */
export function buatEventVote({ poemId, userId, lama, baru, seq, bobot, waktu, correlationId, traceparent }) {
  const eventId = uuidv5(`vote.cast:${poemId}:${seq}`, NAMESPACE_VOTE);
  return buatEvent(
    'vote.cast',
    poemId,
    seq,
    {
      vote_id: eventId,
      poem_id: poemId,
      user_id: userId,
      vote_value: baru,
      previous_value: lama,
      weight: bobot,
      sequence: seq,
      cast_at: waktu.toISOString(),
    },
    { eventId, correlationId, traceparent, occurredAt: waktu },
  );
}
