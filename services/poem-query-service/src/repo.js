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
 * Satu halaman puisi publik (authorId kosong: hanya PUBLISHED dari semua penulis)
 * atau milik seorang penulis. Bila authorId ada dan semua = true (penulisnya
 * sendiri), tampilkan semua status kecuali DELETED pada versi terbaru; selain
 * itu hanya PUBLISHED dengan versi yang terbit. Versi yang belum punya teks
 * (event isi belum tiba) diganti versi terakhir sebelumnya yang sudah punya teks.
 */
export async function daftarPenulis(pool, { authorId = null, semua = false, page, size }) {
  const { rows } = await pool.query(
    `SELECT p.poem_id, p.status, p.versi_terbaru, p.versi_tampil, p.dikirim_at, p.published_at,
            p.skor, p.jumlah_suara, v.versi, v.judul, v.bait_kutipan, v.gambar_url, v.tema,
            v.level_kemiripan, v.dikirim_at AS versi_dikirim_at,
            count(*) OVER () AS total
       FROM poem p
       JOIN LATERAL (
         SELECT * FROM poem_versi pv
          WHERE pv.poem_id = p.poem_id AND pv.judul IS NOT NULL
            AND pv.versi <= CASE WHEN ($1::text IS NOT NULL AND $2::boolean)
                                 THEN p.versi_terbaru ELSE p.versi_tampil END
          ORDER BY pv.versi DESC LIMIT 1
       ) v ON true
      WHERE ($1::text IS NULL OR p.author_id = $1)
        AND (CASE WHEN ($1::text IS NOT NULL AND $2::boolean)
                  THEN p.status IN ('PROCESSING', 'PUBLISHED', 'HELD', 'HIDDEN')
                  ELSE p.status = 'PUBLISHED' END)
      ORDER BY COALESCE(p.published_at, p.dikirim_at) DESC NULLS LAST, p.poem_id
      LIMIT $3 OFFSET $4`,
    [authorId ?? null, Boolean(semua), size, (page - 1) * size],
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

const STATUS_TAMPIL = `CASE WHEN p.status = 'PUBLISHED' AND p.versi_tampil IS NOT NULL AND p.versi_terbaru > p.versi_tampil
                            THEN 'REPROCESSING' ELSE p.status END`;

/**
 * Halaman Puisi Saya (T2.8): semua puisi milik pengguna kecuali DELETED,
 * versi terbaru, dengan status tampil (REPROCESSING bila revisi sedang
 * dinilai), alasan HELD / HIDDEN, dan jumlah per status untuk filter.
 * @param {{ authorId: string, status: string|null, page: number, size: number }} q
 */
export async function daftarMilik(pool, { authorId, status, page, size }) {
  const { rows } = await pool.query(
    `WITH milik AS (
       SELECT p.*, ${STATUS_TAMPIL} AS status_tampil FROM poem p
        WHERE p.author_id = $1 AND p.status IN ('PROCESSING', 'PUBLISHED', 'HELD', 'HIDDEN')
     )
     SELECT m.poem_id, m.status_tampil, m.versi_terbaru, m.versi_tampil, m.alasan_status, m.published_at,
            m.skor, m.jumlah_suara, m.dikirim_at,
            v.versi, v.judul, v.bait_kutipan, v.gambar_url, v.tema, v.level_kemiripan, v.dikirim_at AS versi_dikirim_at,
            count(*) OVER () AS total
       FROM milik m
       JOIN LATERAL (
         SELECT * FROM poem_versi pv
          WHERE pv.poem_id = m.poem_id AND pv.judul IS NOT NULL AND pv.versi <= m.versi_terbaru
          ORDER BY pv.versi DESC LIMIT 1
       ) v ON true
      WHERE ($2::text IS NULL OR m.status_tampil = $2)
      ORDER BY COALESCE(v.dikirim_at, m.dikirim_at) DESC NULLS LAST, m.poem_id
      LIMIT $3 OFFSET $4`,
    [authorId, status, size, (page - 1) * size],
  );
  const jumlah = await pool.query(
    `SELECT ${STATUS_TAMPIL} AS status, count(*)::int AS n FROM poem p
      WHERE p.author_id = $1 AND p.status IN ('PROCESSING', 'PUBLISHED', 'HELD', 'HIDDEN')
      GROUP BY 1`,
    [authorId],
  );
  const counts = { PROCESSING: 0, REPROCESSING: 0, PUBLISHED: 0, HELD: 0, HIDDEN: 0 };
  for (const r of jumlah.rows) counts[r.status] = r.n;
  return {
    total: rows[0] ? Number(rows[0].total) : 0,
    counts,
    baris: rows.map((r) => ({
      poem_id: r.poem_id,
      status: r.status_tampil,
      versi: r.versi,
      versi_terbaru: r.versi_terbaru,
      versi_tampil: r.versi_tampil,
      alasan_status: r.alasan_status,
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
