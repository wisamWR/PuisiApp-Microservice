/**
 * Skrip seed: jadikan satu akun admin pertama (T1.7).
 * Pemakaian: DATABASE_URL=... SERVICE_NAME=register-service node scripts/seed-admin.js <username>
 */
import pg from 'pg';
import { ubahPeran } from '../src/ubahPeran.js';

const username = process.argv[2];
if (!username) {
  console.error('pakai: node scripts/seed-admin.js <username>');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL belum diisi');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const { rows } = await pool.query('SELECT id FROM accounts WHERE username = $1', [username]);
  if (!rows[0]) {
    console.error(`akun ${username} tidak ditemukan`);
    process.exit(2);
  }
  const hasil = await ubahPeran(pool, rows[0].id, 'admin');
  console.log(`admin: ${hasil.akun.username} (${hasil.akun.role})`);
} finally {
  await pool.end();
}
