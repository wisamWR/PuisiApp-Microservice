/**
 * Langkah pemrosesan puisi dan bentuk snapshot status (fungsi murni).
 *
 * Setiap langkah selesai ditandai satu event hasil worker. Versi puisi
 * diambil dari payload.version bila ada, selain itu aggregate_version
 * (aggregate_id = poem_id), sama dengan aturan poem-query.
 */

/** event_type hasil worker -> nama langkah (field `stage` di poem.processing.updated). */
export const EVENT_LANGKAH = Object.freeze({
  'poem.emotion.analyzed': 'emotion',
  'poem.themes.extracted': 'themes',
  'poem.keywords.extracted': 'keywords',
  'poem.image.rendered': 'image',
  'poem.similarity.scored': 'similarity',
  'authorship.recorded': 'authorship',
});

export const LABEL_LANGKAH = Object.freeze({
  emotion: 'Analisis emosi',
  themes: 'Tema',
  keywords: 'Kata kunci',
  image: 'Gambar kutipan',
  similarity: 'Pemeriksaan keaslian',
  authorship: 'Jejak keaslian',
});

export const SEMUA_LANGKAH = Object.freeze(Object.keys(LABEL_LANGKAH));

/** Status publikasi dari publication-service (dan poem.deleted). */
export const EVENT_PUBLIKASI = Object.freeze({
  'poem.published': 'PUBLISHED',
  'poem.held': 'HELD',
  'poem.hidden': 'HIDDEN',
  'poem.deleted': 'DELETED',
});

export const EVENT_MULAI = Object.freeze(['poem.submitted', 'poem.revised']);

export const IKATAN = Object.freeze([...EVENT_MULAI, ...Object.keys(EVENT_LANGKAH), ...Object.keys(EVENT_PUBLIKASI)]);

/**
 * Langkah aktif dari env PROCESSING_LANGKAH (dipisah koma); bawaan semua.
 * Langkah yang workernya belum ada (mis. authorship di tahap Demo) bisa
 * dikeluarkan supaya status tetap bisa mencapai COMPLETED.
 */
export function langkahAktif(env = process.env.PROCESSING_LANGKAH) {
  if (!env) return [...SEMUA_LANGKAH];
  const dipilih = env.split(',').map((s) => s.trim()).filter(Boolean);
  const tidakDikenal = dipilih.filter((s) => !SEMUA_LANGKAH.includes(s));
  if (tidakDikenal.length) throw new Error(`PROCESSING_LANGKAH tidak dikenal: ${tidakDikenal.join(', ')}`);
  return SEMUA_LANGKAH.filter((s) => dipilih.includes(s));
}

export function versiDari(event) {
  const v = event.payload?.version;
  if (Number.isInteger(v)) return v;
  if (event.event_type === 'poem.deleted' && Number.isInteger(event.payload?.last_version)) return event.payload.last_version;
  return event.aggregate_version;
}

export const poemIdDari = (event) => String(event.payload?.poem_id ?? event.aggregate_id);

/** Status pemrosesan versi tertentu (enum kontrak poem.processing.updated). */
export const statusProses = (versi, lengkap) => (lengkap ? 'COMPLETED' : versi > 1 ? 'REPROCESSING' : 'PROCESSING');

/**
 * Snapshot yang dikirim ke browser lewat SSE.
 * @param {object} d
 * @param {string} d.poemId
 * @param {Record<string,string>} d.puisi   hash proses:{poemId}
 * @param {Record<string,string>} d.versi   hash proses:{poemId}:v{n}
 * @param {string[]} d.langkah             langkah aktif
 */
export function buatSnapshot({ poemId, puisi, versi, langkah }) {
  const nomor = Number(puisi.versi) || 1;
  const steps = langkah.map((nama) => ({
    name: nama,
    label: LABEL_LANGKAH[nama],
    done: Boolean(versi[`l:${nama}`]),
    done_at: versi[`l:${nama}`] || null,
  }));
  const selesai = steps.filter((s) => s.done).length;
  const lengkap = selesai === steps.length;
  return {
    poem_id: poemId,
    version: nomor,
    status: statusProses(nomor, lengkap),
    steps,
    steps_done: selesai,
    steps_total: steps.length,
    completed_at: lengkap ? versi.selesai_at || null : null,
    publication: puisi.publikasi || null,
    updated_at: puisi.diubah_at || null,
  };
}

/** Snapshot final: pemrosesan selesai dan keputusan publikasi sudah ada (klien boleh menutup stream). */
export const snapshotFinal = (s) => (s.status === 'COMPLETED' && s.publication != null) || s.publication === 'DELETED';
