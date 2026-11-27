// Pencarian dari read model search_db. Hanya status PUBLISHED yang dikembalikan.
// Urutan: relevansi (ts_rank_cd), lalu tanggal terbit (puisi) atau jumlah puisi (penulis).

export async function cariPuisi(pool, { q, page, size }) {
  const offset = (page - 1) * size;
  const { rows: total } = await pool.query(
    `SELECT count(*)::int AS n FROM poem_cari
     WHERE status = 'PUBLISHED' AND vektor @@ plainto_tsquery('simple', $1)`,
    [q],
  );
  const { rows } = await pool.query(
    `SELECT poem_id, judul AS title, isi, bait_kutipan, author_id, published_at, versi AS version,
            ts_rank_cd(vektor, plainto_tsquery('simple', $1)) AS skor
     FROM poem_cari
     WHERE status = 'PUBLISHED' AND vektor @@ plainto_tsquery('simple', $1)
     ORDER BY skor DESC, published_at DESC NULLS LAST
     LIMIT $2 OFFSET $3`,
    [q, size, offset],
  );
  return {
    items: rows.map((r) => ({
      poem_id: r.poem_id,
      version: r.version,
      title: r.title,
      // Bait kutipan dari poem.submitted/revised. Baris lama tanpa bait kutipan memakai baris pertama isi.
      quote_text: r.bait_kutipan ?? r.isi.split('\n')[0],
      author_id: r.author_id,
      published_at: r.published_at,
      skor: Number(r.skor),
    })),
    total: total[0].n,
  };
}

export async function cariPenulis(pool, { q, page, size }) {
  const offset = (page - 1) * size;
  const { rows: total } = await pool.query(
    `SELECT count(*)::int AS n FROM penulis_cari WHERE vektor @@ plainto_tsquery('simple', $1)`,
    [q],
  );
  const { rows } = await pool.query(
    `SELECT p.user_id, p.display_name,
            (SELECT count(*)::int FROM poem_cari c WHERE c.author_id = p.user_id AND c.status = 'PUBLISHED') AS jumlah_puisi,
            ts_rank_cd(p.vektor, plainto_tsquery('simple', $1)) AS skor
     FROM penulis_cari p
     WHERE p.vektor @@ plainto_tsquery('simple', $1)
     ORDER BY skor DESC, jumlah_puisi DESC
     LIMIT $2 OFFSET $3`,
    [q, size, offset],
  );
  return {
    items: rows.map((r) => ({
      user_id: r.user_id,
      display_name: r.display_name,
      jumlah_puisi: r.jumlah_puisi,
    })),
    total: total[0].n,
  };
}
