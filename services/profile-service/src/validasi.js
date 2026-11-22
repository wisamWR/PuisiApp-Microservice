/**
 * Validasi dan pembersihan profil (T1.5 butir 3). Fungsi murni, tanpa basis data.
 * Tag HTML dibuang dulu, baru dihitung panjangnya, supaya "<b>x</b>" tidak lolos sebagai teks kosong.
 */
export const MAKS_NAMA_TAMPIL = 50;
export const MAKS_BIO = 300;

/** Buang tag HTML dan spasi berlebih. */
export function bersihkanTeks(teks) {
  return String(teks ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @returns {{ ok: true, data: { display_name: string, bio: string } }
 *   | { ok: false, errors: Record<string, string> }}
 */
export function validasiProfil(body) {
  const errors = {};
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const displayName = bersihkanTeks(b.display_name);
  const bio = bersihkanTeks(b.bio ?? '');

  if (displayName.length < 1 || displayName.length > MAKS_NAMA_TAMPIL) {
    errors.display_name = `nama tampil harus 1 sampai ${MAKS_NAMA_TAMPIL} karakter`;
  }
  if (bio.length > MAKS_BIO) {
    errors.bio = `bio maksimal ${MAKS_BIO} karakter`;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, data: { display_name: displayName, bio } };
}
