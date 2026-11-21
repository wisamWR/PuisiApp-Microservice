/** Pembuat event uji dengan amplop lengkap. */
import { randomUUID } from 'node:crypto';

export const POEM = '0b7d6f0e-4a8b-4a52-9d0b-3f4f0e9b2a10';
export const PENULIS = 'u-0042';
export const WAKTU = new Date('2026-11-20T08:00:00.000Z');
export const sekarang = () => WAKTU;

function amplop(eventType, aggregateId, aggregateVersion, payload) {
  return {
    event_id: randomUUID(),
    event_type: eventType,
    schema_version: 1,
    occurred_at: '2026-11-20T07:59:00.000Z',
    producer: 'uji',
    correlation_id: randomUUID(),
    causation_id: null,
    aggregate_id: aggregateId,
    aggregate_version: aggregateVersion,
    payload,
  };
}

const isiPuisi = (versi) => ({
  poem_id: POEM,
  version: versi,
  author_id: PENULIS,
  title: 'Jendela yang Basah',
  body: 'sore turun tanpa permisi\nhujan mengetuk kaca',
  quote_stanza: 0,
  quote_text: 'sore turun tanpa permisi',
  template_id: 'latar1',
});

export const diajukan = (poemId = POEM) =>
  amplop('poem.submitted', poemId, 1, { ...isiPuisi(1), poem_id: poemId, submitted_at: '2026-11-20T07:59:00.000Z' });

export const direvisi = (versi, poemId = POEM) =>
  amplop('poem.revised', poemId, versi, { ...isiPuisi(versi), poem_id: poemId, revised_at: '2026-11-20T07:59:00.000Z' });

export const dinilai = (versi, level, score = 0.1, poemId = POEM) =>
  amplop('poem.similarity.scored', poemId, versi, {
    poem_id: poemId,
    score,
    level,
    comparisons: score > 0 ? [{ compared_poem_id: 'p-lain', score }] : [],
  });

export const diputuskan = (decision, decidedAt = '2026-11-20T09:00:00.000Z', poemId = POEM) =>
  amplop('case.decided', '550e8400-e29b-41d4-a716-446655440001', 1, {
    case_id: '550e8400-e29b-41d4-a716-446655440001',
    poem_id: poemId,
    moderator_id: 'mod-01',
    decision,
    reason: 'Keputusan moderator',
    decided_at: decidedAt,
  });

export const dihapus = (lastVersion = 1, poemId = POEM) =>
  amplop('poem.deleted', poemId, lastVersion, {
    poem_id: poemId,
    author_id: PENULIS,
    last_version: lastVersion,
    deleted_at: '2026-11-20T10:00:00.000Z',
  });

/** Keadaan tersimpan untuk uji. */
export const keadaan = (status, tambahan = {}) => ({
  poem_id: POEM,
  author_id: PENULIS,
  status,
  versi: 1,
  versi_tampil: null,
  level_kemiripan: null,
  skor_kemiripan: null,
  case_id: null,
  keputusan_at: null,
  row_version: 1,
  ...tambahan,
});
