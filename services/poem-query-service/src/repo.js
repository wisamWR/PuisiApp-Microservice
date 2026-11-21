/**
 * Kueri baca read model.
 */

const iso = (t) => (t ? new Date(t).toISOString() : null);

function barisVersi(r) {
  return {
    versi: r.versi,
    judul: r.judul,
    isi: r.isi,
    indeks_bait: r.indeks_bait,
    bait_kutipan: r.bait_kutipan,
    template: r.template,
    kategori: r.kategori,
    tag: r.tag ?? [],
    dikirim_at: iso(r.dikirim_at),
    gambar_url: r.gambar_url,
    gambar_lebar: r.gambar_lebar,
    gambar_tinggi: r.gambar_tinggi,
    kata_kunci: r.kata_kunci ?? [],
    tema: r.tema ?? [],
    emosi: r.emosi,
    level_kemiripan: r.level_kemiripan,
    skor_kemiripan: r.skor_kemiripan == null ? null : Number(r.skor_kemiripan),
    diubah_at: iso(r.diubah_at),
  };
}

/**
 * Semua data satu puisi, belum disaring menurut pembaca. Bentuk ini yang
 * disimpan di cache (sama untuk semua pembaca); penyaringan di tampilan.js.
 * @returns {Promise<object|null>}
 */
export async function ambilBundel(pool, poemId) {
  const { rows } = await pool.query(
    `SELECT p.*, a.username, a.display_name
       FROM poem p LEFT JOIN penulis a ON a.user_id = p.author_id
      WHERE p.poem_id = $1`,
    [poemId],
  );
  const p = rows[0];
  if (!p) return null;
  const versi = await pool.query('SELECT * FROM poem_versi WHERE poem_id = $1 ORDER BY versi', [poemId]);
  return {
    poem: {
      poem_id: p.poem_id,
      author_id: p.author_id,
      status: p.status,
      versi_terbaru: p.versi_terbaru,
      versi_tampil: p.versi_tampil,
      dikirim_at: iso(p.dikirim_at),
      published_at: iso(p.published_at),
      skor: p.skor,
      jumlah_suara: p.jumlah_suara,
      diubah_at: iso(p.diubah_at),
    },
    penulis: { id: p.author_id, username: p.username ?? null, display_name: p.display_name ?? null },
    versi: versi.rows.map(barisVersi),
  };
}

/**
 * Satu halaman puisi seorang penulis. semua = true untuk penulisnya sendiri
 * (semua status kecuali DELETED, versi terbaru); selain itu hanya PUBLISHED
 * dengan versi yang terbit. Versi yang belum punya teks (event isi belum tiba)
 * diganti versi terakhir sebelumnya yang sudah punya teks.
 */
export async function daftarPenulis(pool, { authorId, semua, page, size }) {
  const { rows } = await pool.query(
    `SELECT p.poem_id, p.status, p.versi_terbaru, p.versi_tampil, p.dikirim_at, p.published_at,
            p.skor, p.jumlah_suara, v.versi, v.judul, v.bait_kutipan, v.gambar_url, v.tema,
            v.level_kemiripan, v.dikirim_at AS versi_dikirim_at,
            count(*) OVER () AS total
       FROM poem p
       JOIN LATERAL (
         SELECT * FROM poem_versi pv
          WHERE pv.poem_id = p.poem_id AND pv.judul IS NOT NULL
            AND pv.versi <= CASE WHEN $2::boolean THEN p.versi_terbaru ELSE p.versi_tampil END
          ORDER BY pv.versi DESC LIMIT 1
       ) v ON true
      WHERE p.author_id = $1
        AND (CASE WHEN $2::boolean THEN p.status IN ('PROCESSING', 'PUBLISHED', 'HELD', 'HIDDEN')
                  ELSE p.status = 'PUBLISHED' END)
      ORDER BY COALESCE(p.published_at, p.dikirim_at) DESC NULLS LAST, p.poem_id
      LIMIT $3 OFFSET $4`,
    [authorId, semua, size, (page - 1) * size],
  );
  return {
    total: rows[0] ? Number(rows[0].total) : 0,
    baris: rows.map((r) => ({
      poem_id: r.poem_id,
      status: r.status,
      versi_terbaru: r.versi_terbaru,
      versi_tampil: r.versi_tampil,
      versi: r.versi,
      judul: r.judul,
      bait_kutipan: r.bait_kutipan,
      gambar_url: r.gambar_url,
      tema: r.tema ?? [],
      level_kemiripan: r.level_kemiripan,
      skor: r.skor,
      jumlah_suara: r.jumlah_suara,
      dikirim_at: iso(r.versi_dikirim_at ?? r.dikirim_at),
      published_at: iso(r.published_at),
    })),
  };
}

/** poem_id semua puisi seorang penulis (untuk invalidasi cache saat nama berubah). */
export async function poemIdPenulis(pool, authorId) {
  const { rows } = await pool.query('SELECT poem_id FROM poem WHERE author_id = $1', [authorId]);
  return rows.map((r) => r.poem_id);
}
