/**
 * Sesi login untuk skrip uji integrasi lewat gateway (bukan untuk kode layanan).
 *
 * Sejak k1 (T1.1, T1.2) masuk main, gateway memverifikasi token sungguhan
 * lewat token-service, jadi cookie contoh "access_token=dev" tidak berlaku.
 * Urutan:
 *   1. COOKIE dari env bila diisi (mis. COOKIE="access_token=..."), userId dari USER_ID
 *   2. daftarkan akun uji acak lalu login; login dicoba ulang karena
 *      kredensial sampai ke login-service secara asinkron (user.credentials.created)
 *   3. bila layanan akun tidak berjalan (stub auth), pakai cookie contoh dan "stub-user"
 *
 * @param {string} gateway  mis. http://localhost:8080
 * @param {{ batasMs?: number, log?: (pesan: string) => void }} [opsi]
 * @returns {Promise<{ cookie: string, userId: string, username: string|null }>}
 */
import { randomBytes } from 'node:crypto';

const jeda = (ms) => new Promise((r) => setTimeout(r, ms));

/** sub dari JWT (tanpa verifikasi; hanya untuk mengetahui id pengguna uji). */
function subDari(token) {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).sub ?? null;
  } catch {
    return null;
  }
}

export async function sesiUji(gateway, opsi = {}) {
  const log = opsi.log ?? (() => {});
  if (process.env.COOKIE) {
    return { cookie: process.env.COOKIE, userId: process.env.USER_ID ?? 'stub-user', username: null };
  }

  const username = `uji_${randomBytes(5).toString('hex')}`;
  const password = `Uji-${randomBytes(8).toString('hex')}`;
  const daftar = await fetch(`${gateway}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, email: `${username}@uji.local`, password, display_name: 'Penulis Uji' }),
  }).catch(() => null);

  if (!daftar || daftar.status === 404 || daftar.status >= 500) {
    log('layanan akun tidak tersedia, memakai stub auth (access_token=dev)');
    return { cookie: 'access_token=dev', userId: 'stub-user', username: null };
  }
  if (daftar.status >= 400) throw new Error(`registrasi akun uji gagal: ${daftar.status} ${await daftar.text()}`);

  // 75 detik: cukup untuk menunggu satu jendela batas laju login gateway
  // (10 per menit per IP) saat beberapa skrip uji dijalankan berurutan.
  const akhir = Date.now() + (opsi.batasMs ?? 75_000);
  for (;;) {
    const r = await fetch(`${gateway}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (r.status === 200) {
      const token = r.headers
        .getSetCookie()
        .map((c) => /^access_token=([^;]+)/.exec(c)?.[1])
        .find(Boolean);
      if (!token) throw new Error('login berhasil tetapi cookie access_token tidak ada');
      const userId = subDari(decodeURIComponent(token));
      log(`login sebagai ${username} (${userId})`);
      return { cookie: `access_token=${token}`, userId, username };
    }
    // 401: kredensial belum sampai ke login-service (event asinkron). 429: batas laju gateway.
    if (Date.now() > akhir) throw new Error(`login akun uji gagal: ${r.status} ${await r.text()}`);
    await jeda(r.status === 429 ? 6000 : 500);
  }
}
