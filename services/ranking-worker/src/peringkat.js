/**
 * Penanganan vote.cast:
 *   1. terapkan suara ke hitungan berbobot (atomik, abaikan seq lama/duplikat)
 *   2. hitung Wilson dari hitungan berbobot
 *   3. klaim penerbitan bila Wilson berubah lebih dari ambang (bawaan 0,001),
 *      atau skor berubah selama Wilson masih 0 (belum ada suara positif)
 *   4. terbitkan poem.score.updated; bila gagal, klaim dibatalkan dan pesan
 *      dicoba ulang (retry pustaka). Langkah 2-4 tetap dijalankan untuk
 *      pesan duplikat, sehingga percobaan ulang setelah gagal terbit tetap
 *      menerbitkan skor.
 */
import { eventTurunan, GalatPermanen } from '@puisiapp/events';
import { wilson } from './wilson.js';

const bulat = (x) => Number(x.toFixed(6));

/**
 * @param {object} d
 * @param {ReturnType<import('./toko.js').buatToko>} d.toko
 * @param {(event: any) => Promise<void>} d.terbitkan
 * @param {number} [d.ambang]
 */
export function buatPenangan(d) {
  const ambang = d.ambang ?? 0.001;

  return async function tangani(event) {
    const p = event.payload ?? {};
    if (![1, -1, 0].includes(p.vote_value) || !Number.isInteger(p.sequence) || !(p.weight > 0 && p.weight <= 1)) {
      throw new GalatPermanen('payload vote.cast tidak valid');
    }
    const poemId = String(p.poem_id);
    const h = await d.toko.terapkan(poemId, String(p.user_id), p.vote_value, p.weight, p.sequence);

    const w = bulat(wilson(h.wup, h.wdown));
    const k = await d.toko.klaim(poemId, w, ambang, h.up - h.down);
    if (!k.klaim) return { diterbitkan: false, wilson: w, ...h };

    const skor = eventTurunan(
      event,
      'poem.score.updated',
      {
        poem_id: poemId,
        score: h.up - h.down,
        vote_count: h.up + h.down,
        up: h.up,
        down: h.down,
        wilson_score: w,
        updated_at: p.cast_at,
      },
      { aggregateId: poemId, aggregateVersion: Math.max(1, h.seq) },
    );
    try {
      await d.terbitkan(skor);
    } catch (err) {
      await d.toko.batalKlaim(poemId, w, h.up - h.down, k.sebelumnya).catch(() => {});
      throw err;
    }
    return { diterbitkan: true, wilson: w, ...h };
  };
}
