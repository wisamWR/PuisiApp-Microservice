/**
 * Akses vote_db.
 */

/**
 * UPSERT satu batch dalam satu transaksi (satu pernyataan multi-baris).
 * Baris hanya ditimpa oleh suara dengan sequence lebih besar, jadi pesan
 * duplikat dan pesan yang tiba tidak berurutan tidak mengubah hasil.
 * @param {import('pg').Pool} pool
 * @param {ReturnType<import('./batch.js').gabungkan>} baris
 * @returns {Promise<number>} jumlah baris yang benar-benar berubah
 */
export async function simpanBatch(pool, baris) {
  if (baris.length === 0) return 0;
  const r = await pool.query(
    `INSERT INTO votes (poem_id, user_id, value, weight, sequence, updated_at)
     SELECT * FROM unnest($1::uuid[], $2::varchar[], $3::smallint[], $4::real[], $5::bigint[], $6::timestamptz[])
     ON CONFLICT (poem_id, user_id) DO UPDATE
       SET value = EXCLUDED.value, weight = EXCLUDED.weight, sequence = EXCLUDED.sequence,
           updated_at = EXCLUDED.updated_at, persisted_at = now()
     WHERE votes.sequence < EXCLUDED.sequence`,
    [
      baris.map((b) => b.poem_id),
      baris.map((b) => b.user_id),
      baris.map((b) => b.value),
      baris.map((b) => b.weight),
      baris.map((b) => b.sequence),
      baris.map((b) => b.updated_at),
    ],
  );
  return r.rowCount;
}

/**
 * Hitungan per puisi dari vote_db (untuk rekonsiliasi).
 * @param {import('pg').Pool} pool
 * @param {string[]} [poemIds] kosong = semua puisi
 */
export async function hitunganPerPuisi(pool, poemIds) {
  const filter = poemIds?.length ? 'WHERE poem_id = ANY($1::uuid[])' : '';
  const { rows } = await pool.query(
    `SELECT poem_id::text AS poem_id,
            count(*) FILTER (WHERE value = 1)::int  AS up,
            count(*) FILTER (WHERE value = -1)::int AS down,
            max(sequence)::bigint                   AS seq
       FROM votes ${filter}
      GROUP BY poem_id`,
    poemIds?.length ? [poemIds] : [],
  );
  return rows.map((r) => ({ ...r, seq: Number(r.seq) }));
}

/** Suara aktif satu puisi (untuk membangun ulang Redis). */
export async function suaraAktif(pool, poemId) {
  const { rows } = await pool.query('SELECT user_id, value FROM votes WHERE poem_id = $1 AND value <> 0', [poemId]);
  return rows;
}
