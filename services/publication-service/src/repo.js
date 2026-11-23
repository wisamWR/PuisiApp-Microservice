/**
 * Akses tabel publication dengan optimistic locking (row_version).
 *
 * Konsumen sudah memproses event satu agregat secara berurutan lewat advisory
 * lock per aggregate_id (libs/node store.js). Tetapi case.decided memakai
 * aggregate_id = case_id, jadi bisa berjalan bersamaan dengan event lain
 * untuk puisi yang sama. row_version menangkap kasus itu: UPDATE hanya
 * berhasil bila baris belum diubah transaksi lain sejak dibaca. Bila gagal,
 * GalatKonflik dilempar, transaksi di-rollback (termasuk processed_event),
 * dan konsumen menjadwalkan ulang event lewat retry.delayed.
 */

export class GalatKonflik extends Error {
  constructor(poemId) {
    super(`row_version berubah untuk puisi ${poemId}, transaksi lain lebih dulu`);
    this.name = 'GalatKonflik';
  }
}

const KOLOM = `poem_id, author_id, status, versi, versi_tampil, level_kemiripan,
  skor_kemiripan, case_id, keputusan_at, row_version`;

function keKeadaan(baris) {
  if (!baris) return null;
  return {
    ...baris,
    skor_kemiripan: baris.skor_kemiripan == null ? null : Number(baris.skor_kemiripan),
    keputusan_at: baris.keputusan_at ? new Date(baris.keputusan_at).toISOString() : null,
  };
}

/** @returns {Promise<import('./mesin.js').Keadaan|null>} */
export async function ambil(tx, poemId) {
  const { rows } = await tx.query(`SELECT ${KOLOM} FROM publication WHERE poem_id = $1`, [poemId]);
  return keKeadaan(rows[0]);
}

/**
 * Simpan keadaan baru. lama = keadaan yang dibaca sebelumnya (null untuk
 * baris baru).
 * @returns {Promise<number>} row_version baru
 */
export async function simpan(tx, lama, baru) {
  const nilai = [
    baru.poem_id,
    baru.author_id,
    baru.status,
    baru.versi,
    baru.versi_tampil,
    baru.level_kemiripan,
    baru.skor_kemiripan,
    baru.case_id,
    baru.keputusan_at,
  ];
  if (!lama) {
    const { rows } = await tx.query(
      `INSERT INTO publication (poem_id, author_id, status, versi, versi_tampil, level_kemiripan,
         skor_kemiripan, case_id, keputusan_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (poem_id) DO NOTHING
       RETURNING row_version`,
      nilai,
    );
    if (!rows[0]) throw new GalatKonflik(baru.poem_id);
    return rows[0].row_version;
  }
  const { rows } = await tx.query(
    `UPDATE publication
        SET author_id = $2, status = $3, versi = $4, versi_tampil = $5, level_kemiripan = $6,
            skor_kemiripan = $7, case_id = $8, keputusan_at = $9,
            row_version = row_version + 1, diubah_at = now()
      WHERE poem_id = $1 AND row_version = $10
      RETURNING row_version`,
    [...nilai, lama.row_version],
  );
  if (!rows[0]) throw new GalatKonflik(baru.poem_id);
  return rows[0].row_version;
}
