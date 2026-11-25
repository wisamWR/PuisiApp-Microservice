/**
 * Aturan visibilitas dan bentuk respons (contracts/openapi/poem-query.yaml).
 * Fungsi murni: menerima bundel dari repo.ambilBundel (atau cache) dan
 * identitas pembaca, mengembalikan respons atau null (= 404).
 *
 *   PUBLISHED                  : semua pembaca; selain penulis melihat versi terbit
 *   PROCESSING / HELD / HIDDEN : hanya penulis, moderator, admin
 *   DELETED, status kosong     : tidak ada
 *
 * Penulis melihat versi terbaru. Bila versi terbaru lebih baru dari versi
 * terbit, statusnya REPROCESSING (versi lama masih tampil untuk orang lain).
 */

export const PERAN_ISTIMEWA = new Set(['moderator', 'admin']);

/** Label emosi dengan total skor tertinggi dari semua baris. */
export function emosiDominan(baris) {
  if (!Array.isArray(baris) || baris.length === 0) return null;
  const total = new Map();
  for (const b of baris) total.set(b.label, (total.get(b.label) ?? 0) + Number(b.score));
  return [...total.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}

/** Versi terakhir yang sudah punya teks, tidak melebihi target. */
function pilihVersi(versi, target) {
  return [...versi].filter((v) => v.versi <= target && v.judul != null).sort((a, b) => b.versi - a.versi)[0] ?? null;
}

/**
 * @param {object|null} bundel
 * @param {{ userId: string, role?: string|null }} pembaca
 */
export function lihatDetail(bundel, pembaca) {
  if (!bundel) return null;
  const { poem, penulis } = bundel;
  if (!poem.status || poem.status === 'DELETED') return null;

  const pemilik = poem.author_id != null && poem.author_id === pembaca.userId;
  const istimewa = pemilik || PERAN_ISTIMEWA.has(pembaca.role ?? '');

  let target;
  let status;
  if (istimewa) {
    target = poem.versi_terbaru;
    status =
      poem.status === 'PUBLISHED' && poem.versi_tampil != null && poem.versi_terbaru > poem.versi_tampil
        ? 'REPROCESSING'
        : poem.status;
  } else if (poem.status === 'PUBLISHED' && poem.versi_tampil != null) {
    target = poem.versi_tampil;
    status = 'PUBLISHED';
  } else {
    return null;
  }

  const v = pilihVersi(bundel.versi, target);
  if (!v) return null; // event isi belum tiba

  const lines = Array.isArray(v.emosi) ? v.emosi : null;
  return {
    poem_id: poem.poem_id,
    version: v.versi,
    latest_version: poem.versi_terbaru,
    status,
    is_owner: pemilik,
    author: penulis,
    title: v.judul,
    body: v.isi,
    quote: { stanza: v.indeks_bait, text: v.bait_kutipan },
    template_id: v.template,
    category: v.kategori ?? null,
    tags: v.tag ?? [],
    image: v.gambar_url ? { url: v.gambar_url, width: v.gambar_lebar, height: v.gambar_tinggi } : null,
    analysis: {
      keywords: v.kata_kunci ?? [],
      themes: v.tema ?? [],
      emotion: lines && lines.length ? { dominant: emosiDominan(lines), lines } : null,
      originality: v.level_kemiripan ? { level: v.level_kemiripan, score: v.skor_kemiripan } : null,
    },
    score: { value: poem.skor ?? 0, vote_count: poem.jumlah_suara ?? 0 },
    submitted_at: v.dikirim_at,
    published_at: poem.published_at,
    updated_at: [poem.diubah_at, v.diubah_at].filter(Boolean).sort().at(-1),
  };
}

/** Satu baris daftar (repo.daftarPenulis) ke RingkasanPuisi. */
export function ringkasan(r, semua) {
  const status =
    semua && r.status === 'PUBLISHED' && r.versi_tampil != null && r.versi_terbaru > r.versi_tampil
      ? 'REPROCESSING'
      : r.status;
  return {
    poem_id: r.poem_id,
    version: r.versi,
    status,
    title: r.judul,
    quote_text: r.bait_kutipan,
    image_url: r.gambar_url ?? null,
    themes: r.tema ?? [],
    originality_level: r.level_kemiripan ?? null,
    score: { value: r.skor ?? 0, vote_count: r.jumlah_suara ?? 0 },
    submitted_at: r.dikirim_at,
    published_at: r.published_at,
  };
}

/** Satu baris repo.daftarMilik ke PuisiSaya (status sudah dihitung di SQL). */
export function puisiSaya(r) {
  return {
    poem_id: r.poem_id,
    version: r.versi,
    latest_version: r.versi_terbaru,
    published_version: r.versi_tampil ?? null,
    status: r.status,
    status_reason: r.status === 'HELD' || r.status === 'HIDDEN' ? r.alasan_status ?? null : null,
    title: r.judul,
    quote_text: r.bait_kutipan,
    image_url: r.gambar_url ?? null,
    themes: r.tema ?? [],
    originality_level: r.level_kemiripan ?? null,
    score: { value: r.skor ?? 0, vote_count: r.jumlah_suara ?? 0 },
    submitted_at: r.dikirim_at,
    published_at: r.published_at,
  };
}
