/**
 * Validasi input registrasi. Fungsi murni: tidak menyentuh basis data atau jaringan,
 * sehingga bisa diuji tanpa infrastruktur.
 */

const RE_USERNAME = /^[A-Za-z0-9_]{3,30}$/;
// Sengaja sederhana. Validasi sebenarnya dilakukan lewat verifikasi email (T1.6).
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * @param {unknown} body
 * @returns {{ ok: true, data: { username: string, email: string, password: string, display_name: string } }
 *         | { ok: false, errors: Record<string, string> }}
 */
export function validasiRegistrasi(body) {
  const errors = {};
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};

  const username = typeof b.username === 'string' ? b.username.trim() : '';
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  const password = typeof b.password === 'string' ? b.password : '';
  const displayName = typeof b.display_name === 'string' ? b.display_name.trim() : '';

  if (!RE_USERNAME.test(username)) {
    errors.username = 'username harus 3 sampai 30 karakter: huruf, angka, atau garis bawah';
  }
  if (!RE_EMAIL.test(email) || email.length > 254) {
    errors.email = 'email tidak valid';
  }
  if (password.length < 8) {
    errors.password = 'kata sandi minimal 8 karakter';
  }
  if (displayName.length < 1 || displayName.length > 50) {
    errors.display_name = 'nama tampil harus 1 sampai 50 karakter';
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, data: { username, email, password, display_name: displayName } };
}
