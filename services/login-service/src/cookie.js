/**
 * Pembangun cookie sesi (T1.2 butir 4): httpOnly, Secure, SameSite=Lax.
 * Fungsi murni, supaya atributnya bisa diuji tanpa server.
 */
export const NAMA_COOKIE_AKSES = 'access_token';
export const MASA_AKSES_DETIK = 15 * 60;

export function cookieAkses(token, { maksUmurDetik = MASA_AKSES_DETIK } = {}) {
  return `${NAMA_COOKIE_AKSES}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maksUmurDetik}`;
}

/** Cookie yang menghapus access token (dipakai saat logout, T1.3). */
export function cookieHapusAkses() {
  return `${NAMA_COOKIE_AKSES}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
