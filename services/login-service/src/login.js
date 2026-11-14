/**
 * Logika login: penundaan, pencocokan Argon2id, lalu permintaan token ke token-service.
 * Untuk username yang tidak ada, tetap dijalankan verifikasi terhadap hash palsu supaya
 * waktu balasan tidak membocorkan keberadaan akun.
 */
import { verify, hash, Algorithm } from '@node-rs/argon2';
import { statusPenundaan, setelahGagal, MAKS_GAGAL } from './throttle.js';

let hashPalsu;
async function getHashPalsu() {
  hashPalsu ??= await hash('kata-sandi-palsu-untuk-samaratakan-waktu', { algorithm: Algorithm.Argon2id });
  return hashPalsu;
}

/**
 * @returns {Promise<{ status: 200, akun: {id, username, role} }
 *   | { status: 401 } | { status: 429, tungguDetik: number }>}
 */
export async function loginDenganKredensial(pool, username, password) {
  const sekarang = new Date();

  const { rows: [att] } = await pool.query('SELECT gagal, jendela_mulai FROM login_attempts WHERE username = $1', [username]);
  const tunda = statusPenundaan(att ?? null, sekarang);
  if (tunda.tertunda) return { status: 429, tungguDetik: tunda.tungguDetik };

  const { rows: [akun] } = await pool.query(
    'SELECT id, username, role, password_hash FROM credentials WHERE username = $1',
    [username],
  );

  let cocok = false;
  try {
    cocok = await verify(akun ? akun.password_hash : await getHashPalsu(), password);
  } catch {
    cocok = false; // hash rusak dianggap tidak cocok
  }
  if (!akun) cocok = false;

  if (!cocok) {
    const baru = setelahGagal(att ?? null, sekarang);
    await pool.query(
      `INSERT INTO login_attempts (username, gagal, jendela_mulai) VALUES ($1, $2, $3)
       ON CONFLICT (username) DO UPDATE SET gagal = $2, jendela_mulai = $3`,
      [username, baru.gagal, baru.jendela_mulai],
    );
    return { status: 401 };
  }

  await pool.query('DELETE FROM login_attempts WHERE username = $1', [username]);
  return { status: 200, akun: { id: akun.id, username: akun.username, role: akun.role } };
}

export { MAKS_GAGAL };
