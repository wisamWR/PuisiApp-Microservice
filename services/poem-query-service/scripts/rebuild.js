/**
 * Bangun ulang read model dari basis data sumber milik kelompok 2, bila
 * proyeksi rusak atau tertinggal (mis. queue dihapus, bug proyeksi).
 *
 *   node scripts/rebuild.js [--kosongkan]
 *
 * Variabel (setiap sumber boleh kosong untuk dilewati):
 *   DATABASE_URL            poem_read_db (tujuan)
 *   SUMBER_SUBMISSION_URL   submission_db  -> poem.submitted
 *   SUMBER_REVISION_URL     revision_db    -> poem.revised
 *   SUMBER_PUBLICATION_URL  publication_db -> status dan level kemiripan
 *   SUMBER_DELETION_URL     deletion_db    -> poem.deleted
 *
 * Contoh dari laptop (stack dev, superuser, port 5433):
 *   DATABASE_URL=postgres://postgres:postgres_dev_only@localhost:5433/poem_read_db \
 *   SUMBER_SUBMISSION_URL=postgres://postgres:postgres_dev_only@localhost:5433/submission_db \
 *   ... node scripts/rebuild.js
 *
 * Event sintetis diterapkan lewat proyeksi yang sama dengan konsumen, jadi
 * hasilnya identik dan aman dijalankan berulang (upsert). Tanpa --kosongkan,
 * data dari kelompok lain (gambar, kata kunci, tema, emosi, skor suara, nama
 * penulis) tetap utuh. Dengan --kosongkan, data itu hilang sampai event
 * berikutnya tiba, karena sumbernya ada di layanan lain.
 *
 * Cache Redis tidak dihapus; detail lama habis sendiri setelah TTL (bawaan 30 dtk).
 */
import pg from 'pg';
import { proyeksikan } from '../src/proyeksi.js';

const kosongkan = process.argv.includes('--kosongkan');
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL (poem_read_db) wajib diisi');
  process.exit(2);
}
const iso = (t) => new Date(t).toISOString();

async function baca(url, sql) {
  if (!url) return null;
  const klien = new pg.Client({ connectionString: url });
  await klien.connect();
  try {
    return (await klien.query(sql)).rows;
  } finally {
    await klien.end();
  }
}

const isi = (r, versi) => ({
  poem_id: r.poem_id,
  version: versi,
  author_id: r.author_id,
  title: r.judul,
  body: r.isi,
  quote_stanza: r.indeks_bait,
  quote_text: r.bait_kutipan,
  template_id: r.template,
  category: r.kategori,
  keywords: r.keyword_manual ?? [],
});

const sintetis = (event_type, aggregate_id, aggregate_version, occurred_at, payload) => ({
  event_type, aggregate_id, aggregate_version, occurred_at: iso(occurred_at), payload,
});

const events = [];

const submission = await baca(process.env.SUMBER_SUBMISSION_URL, 'SELECT * FROM submission ORDER BY created_at');
for (const r of submission ?? []) {
  events.push(sintetis('poem.submitted', r.poem_id, 1, r.created_at, { ...isi(r, 1), submitted_at: iso(r.created_at) }));
}

const revisi = await baca(process.env.SUMBER_REVISION_URL, 'SELECT * FROM revision ORDER BY poem_id, versi');
for (const r of revisi ?? []) {
  events.push(sintetis('poem.revised', r.poem_id, r.versi, r.created_at, { ...isi(r, r.versi), revised_at: iso(r.created_at) }));
}

const publikasi = await baca(process.env.SUMBER_PUBLICATION_URL, 'SELECT * FROM publication');
for (const r of publikasi ?? []) {
  if (r.level_kemiripan) {
    events.push(sintetis('poem.similarity.scored', r.poem_id, r.versi, r.diubah_at, {
      poem_id: r.poem_id, level: r.level_kemiripan, score: Number(r.skor_kemiripan), comparisons: [],
    }));
  }
  // REPROCESSING di publication-service = PUBLISHED dengan versi lama tampil di read model.
  if ((r.status === 'PUBLISHED' || r.status === 'REPROCESSING') && r.versi_tampil) {
    events.push(sintetis('poem.published', r.poem_id, r.versi_tampil, r.diubah_at, { published_at: iso(r.diubah_at) }));
  } else if (r.status === 'HELD') {
    events.push(sintetis('poem.held', r.poem_id, r.versi, r.diubah_at, {}));
  } else if (r.status === 'HIDDEN') {
    events.push(sintetis('poem.hidden', r.poem_id, r.versi_tampil ?? r.versi, r.diubah_at, {}));
  }
}

const hapus = await baca(process.env.SUMBER_DELETION_URL, 'SELECT * FROM deletion');
for (const r of hapus ?? []) {
  events.push(sintetis('poem.deleted', r.poem_id, r.versi_terakhir, r.deleted_at, {
    poem_id: r.poem_id, author_id: r.author_id, last_version: r.versi_terakhir, deleted_at: iso(r.deleted_at),
  }));
}

const tujuan = new pg.Client({ connectionString: process.env.DATABASE_URL });
await tujuan.connect();
try {
  await tujuan.query('BEGIN');
  if (kosongkan) await tujuan.query('TRUNCATE poem, poem_versi');
  for (const ev of events) await proyeksikan(tujuan, ev);
  await tujuan.query('COMMIT');
} catch (err) {
  await tujuan.query('ROLLBACK').catch(() => {});
  throw err;
} finally {
  await tujuan.end();
}

const jumlah = (xs) => (xs == null ? 'dilewati' : xs.length);
console.log(JSON.stringify({
  kosongkan,
  submission: jumlah(submission),
  revisi: jumlah(revisi),
  publikasi: jumlah(publikasi),
  dihapus: jumlah(hapus),
  event_diterapkan: events.length,
}));
