/** Pembuat event dan bundel uji. */
import { randomUUID } from 'node:crypto';

export const PENULIS = 'u-0042';

let detik = 0;
/** occurred_at yang selalu naik, supaya urutan event uji jelas. */
export const waktu = () => new Date(Date.UTC(2026, 10, 20, 8, 0, detik++)).toISOString();

export function amplop(eventType, aggregateId, aggregateVersion, payload, occurredAt = waktu()) {
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

const isi = (poemId, versi) => ({
  poem_id: poemId,
  version: versi,
  author_id: PENULIS,
  title: `Jendela yang Basah v${versi}`,
  body: `sore turun tanpa permisi v${versi}\nhujan mengetuk kaca\n\nseperti nama yang tak jadi kupanggil`,
  quote_stanza: 0,
  quote_text: 'sore turun tanpa permisi',
  template_id: 'latar2',
  category: 'lirik',
  keywords: ['hujan'],
});

export const e = {
  diajukan: (poemId) => amplop('poem.submitted', poemId, 1, { ...isi(poemId, 1), submitted_at: waktu() }),
  direvisi: (poemId, v) => amplop('poem.revised', poemId, v, { ...isi(poemId, v), revised_at: waktu() }),
  terbit: (poemId, v = 1, t) => amplop('poem.published', poemId, v, { published_at: t ?? waktu() }, t),
  ditahan: (poemId, v = 1, t) =>
    amplop('poem.held', poemId, v, { similarity_level: 'suspected_plagiarism', reason: 'Skor 0.9' }, t),
  disembunyikan: (poemId, v = 1, t) =>
    amplop('poem.hidden', poemId, v, { reason: 'Laporan dikabulkan', hidden_at: t ?? waktu() }, t),
  dihapus: (poemId, v = 1) =>
    amplop('poem.deleted', poemId, v, { poem_id: poemId, author_id: PENULIS, last_version: v, deleted_at: waktu() }),
  gambar: (poemId, v = 1) =>
    amplop('poem.image.rendered', poemId, v, {
      poem_id: poemId,
      version: v,
      template_id: 'latar2',
      image_key: `poems/${poemId}/v${v}.jpg`,
      image_url: `http://localhost:9000/puisi-images/poems/${poemId}/v${v}.jpg`,
      width: 1080,
      height: 1080,
      rendered_at: waktu(),
    }),
  kataKunci: (poemId, v = 1) => amplop('poem.keywords.extracted', poemId, v, { poem_id: poemId, keywords: ['hujan', 'kaca'] }),
  tema: (poemId, v = 1) => amplop('poem.themes.extracted', poemId, v, { poem_id: poemId, themes: ['rindu', 'alam'] }),
  emosi: (poemId, v = 1) =>
    amplop('poem.emotion.analyzed', poemId, v, {
      poem_id: poemId,
      emotions: [
        { line_number: 1, label: 'sedih', score: 0.7 },
        { line_number: 2, label: 'sedih', score: 0.6 },
        { line_number: 4, label: 'cinta', score: 0.9 },
      ],
    }),
  kemiripan: (poemId, v = 1) =>
    amplop('poem.similarity.scored', poemId, v, { poem_id: poemId, score: 0.04, level: 'original', comparisons: [] }),
  skor: (poemId, nilai, t) =>
    amplop('poem.score.updated', poemId, 1, { poem_id: poemId, score: nilai, vote_count: nilai + 3, updated_at: t ?? waktu() }),
  terdaftar: (userId = PENULIS) =>
    amplop('user.registered', userId, 1, { username: 'rinai', email: 'rinai@contoh.id' }),
  profil: (userId = PENULIS, nama = 'Rinai Senja', t) =>
    amplop('user.profile.updated', userId, 2, { display_name: nama, bio: 'penulis hujan' }, t),
};

/** Bundel seperti keluaran repo.ambilBundel. */
export function bundel(poemTambahan = {}, versi = [{}]) {
  return {
    poem: {
      poem_id: '0b7d6f0e-4a8b-4a52-9d0b-3f4f0e9b2a10',
      author_id: PENULIS,
      status: 'PUBLISHED',
      versi_terbaru: 1,
      versi_tampil: 1,
      dikirim_at: '2026-11-20T08:00:00.000Z',
      published_at: '2026-11-20T08:00:20.000Z',
      skor: 5,
      jumlah_suara: 7,
      diubah_at: '2026-11-20T08:01:00.000Z',
      ...poemTambahan,
    },
    penulis: { id: PENULIS, username: 'rinai', display_name: 'Rinai Senja' },
    versi: versi.map((v, i) => ({
      versi: i + 1,
      judul: `Judul v${i + 1}`,
      isi: `isi v${i + 1}`,
      indeks_bait: 0,
      bait_kutipan: 'kutipan',
      template: 'latar2',
      kategori: null,
      tag: [],
      dikirim_at: '2026-11-20T08:00:00.000Z',
      gambar_url: null,
      gambar_lebar: null,
      gambar_tinggi: null,
      kata_kunci: [],
      tema: [],
      emosi: null,
      level_kemiripan: null,
      skor_kemiripan: null,
      diubah_at: '2026-11-20T08:00:30.000Z',
      ...v,
    })),
  };
}

export const PEMILIK = { userId: PENULIS, role: 'writer' };
export const ORANG_LAIN = { userId: 'u-lain', role: 'writer' };
export const MODERATOR = { userId: 'mod-01', role: 'moderator' };
