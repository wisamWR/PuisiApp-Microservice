export async function ambilRiwayat(pool, poemId) {
  const hasil = await pool.query(
    `SELECT
       poem_id,
       version,
       content_hash,
       previous_hash,
       chain_hash,
       recorded_at,
       algorithm
     FROM authorship_projection
     WHERE poem_id = $1
     ORDER BY version ASC`,
    [poemId],
  );

  return hasil.rows;
}
