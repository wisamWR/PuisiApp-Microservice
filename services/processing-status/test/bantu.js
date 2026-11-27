import { randomUUID } from 'node:crypto';

export const PENULIS = 'u-0042';

export function amplop(eventType, aggregateId, aggregateVersion, payload, occurredAt = new Date().toISOString()) {
  return {
    event_id: randomUUID(),
    event_type: eventType,
    schema_version: 1,
    occurred_at: occurredAt,
    producer: 'uji',
    correlation_id: randomUUID(),
    causation_id: null,
    aggregate_id: aggregateId,
    aggregate_version: aggregateVersion,
    payload,
  };
}

const isi = (id, v) => ({
  poem_id: id, version: v, author_id: PENULIS, title: 'J', body: 'a\nb', quote_stanza: 0, quote_text: 'a', template_id: 'latar1',
});

export const e = {
  diajukan: (id) => amplop('poem.submitted', id, 1, { ...isi(id, 1), submitted_at: new Date().toISOString() }),
  direvisi: (id, v) => amplop('poem.revised', id, v, { ...isi(id, v), revised_at: new Date().toISOString() }),
  emosi: (id, v = 1) => amplop('poem.emotion.analyzed', id, v, { poem_id: id, emotions: [{ line_number: 1, label: 'sedih', score: 0.7 }] }),
  tema: (id, v = 1) => amplop('poem.themes.extracted', id, v, { poem_id: id, themes: ['rindu'] }),
  kataKunci: (id, v = 1) => amplop('poem.keywords.extracted', id, v, { poem_id: id, keywords: ['hujan'] }),
  gambar: (id, v = 1) => amplop('poem.image.rendered', id, v, {
    poem_id: id, version: v, template_id: 'latar1', image_key: `poems/${id}/v${v}.jpg`,
    image_url: `http://localhost:9000/puisi-images/poems/${id}/v${v}.jpg`, width: 1080, height: 1080, rendered_at: new Date().toISOString(),
  }),
  kemiripan: (id, v = 1) => amplop('poem.similarity.scored', id, v, { poem_id: id, score: 0.05, level: 'original', comparisons: [] }),
  jejak: (id, v = 1) => amplop('authorship.recorded', id, v, { poem_id: id, version: v, content_hash: 'a'.repeat(64), previous_hash: '0'.repeat(64), chain_hash: 'b'.repeat(64), recorded_at: new Date().toISOString(), algorithm: 'SHA-256' }),
  terbit: (id, v = 1, t) => amplop('poem.published', id, v, { published_at: t ?? new Date().toISOString() }, t),
  disembunyikan: (id, v = 1, t) => amplop('poem.hidden', id, v, { reason: 'uji', hidden_at: t ?? new Date().toISOString() }, t),
  dihapus: (id, v = 1) => amplop('poem.deleted', id, v, { poem_id: id, author_id: PENULIS, last_version: v, deleted_at: new Date().toISOString() }),
};

/** Semua event hasil untuk satu versi. */
export const semuaHasil = (id, v = 1) => [e.emosi(id, v), e.tema(id, v), e.kataKunci(id, v), e.gambar(id, v), e.kemiripan(id, v), e.jejak(id, v)];

export const diam = { debug() {}, info() {}, warn() {}, error() {}, anak() { return diam; } };
