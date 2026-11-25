/** Kueri baca dan tandai-dibaca notifikasi. */

const keJson = (r) => ({
  id: r.id,
  type: r.jenis,
  title: r.judul,
  message: r.pesan,
  poem_id: r.poem_id,
  link: r.tautan,
  read: r.dibaca_at != null,
  created_at: new Date(r.dibuat_at).toISOString(),
});

export async function jumlahBelumDibaca(pool, userId) {
  const { rows } = await pool.query(
    'SELECT count(*)::int AS n FROM notifikasi WHERE penerima_id = $1 AND dibaca_at IS NULL',
    [userId],
  );
  return rows[0].n;
}

export async function daftar(pool, { userId, page, size, belumDibaca }) {
  const { rows } = await pool.query(
    `SELECT *, count(*) OVER () AS total FROM notifikasi
      WHERE penerima_id = $1 AND ($2::boolean IS FALSE OR dibaca_at IS NULL)
      ORDER BY dibuat_at DESC, id
      LIMIT $3 OFFSET $4`,
    [userId, belumDibaca, size, (page - 1) * size],
  );
  return {
    items: rows.map(keJson),
    total: rows[0] ? Number(rows[0].total) : 0,
    unread: await jumlahBelumDibaca(pool, userId),
  };
}

/** @returns {Promise<object|null>} null bila tidak ada atau bukan milik pengguna */
export async function tandaiDibaca(pool, { userId, id }) {
  const { rows } = await pool.query(
    `UPDATE notifikasi SET dibaca_at = COALESCE(dibaca_at, now())
      WHERE id = $1 AND penerima_id = $2 RETURNING *`,
    [id, userId],
  );
  return rows[0] ? keJson(rows[0]) : null;
}

export async function tandaiSemua(pool, userId) {
  const { rowCount } = await pool.query(
    'UPDATE notifikasi SET dibaca_at = now() WHERE penerima_id = $1 AND dibaca_at IS NULL',
    [userId],
  );
  return rowCount;
}
