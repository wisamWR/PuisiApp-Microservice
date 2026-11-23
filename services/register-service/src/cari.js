/** Cari akun berdasarkan username untuk admin (akun yang sudah dihapus tidak ditampilkan). */
export async function cariAkun(pool, q) {
  const pola = `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
  const { rows } = await pool.query(
    `SELECT id, username, role FROM accounts
     WHERE dihapus_pada IS NULL AND username ILIKE $1
     ORDER BY username LIMIT 20`,
    [pola],
  );
  return rows;
}
