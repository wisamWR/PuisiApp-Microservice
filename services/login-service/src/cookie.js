/**
 * Pembangun cookie sesi (T1.2 butir 4): httpOnly, Secure, SameSite=Lax.
 * Access token berlaku di seluruh situs, refresh token hanya dikirim ke /api/auth.
 */
export const NAMA_COOKIE_AKSES = 'access_token';
export const NAMA_COOKIE_REFRESH = 'refresh_token';
export const MASA_AKSES_DETIK = 15 * 60;
export const MASA_REFRESH_DETIK = 7 * 24 * 60 * 60;

export function cookieAkses(token, { maksUmurDetik = MASA_AKSES_DETIK } = {}) {
  return `${NAMA_COOKIE_AKSES}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maksUmurDetik}`;
}

export function cookieRefresh(token, { maksUmurDetik = MASA_REFRESH_DETIK } = {}) {
  return `${NAMA_COOKIE_REFRESH}=${encodeURIComponent(token)}; Path=/api/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=${maksUmurDetik}`;
}
