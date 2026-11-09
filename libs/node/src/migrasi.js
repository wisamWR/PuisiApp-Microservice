/**
 * Migrasi SQL sederhana untuk layanan Node.js.
 *
 * Menjalankan berkas .sql berurutan nama, masing-masing dalam satu transaksi,
 * dan mencatatnya di tabel schema_migrasi. Advisory lock mencegah dua replika
 * menjalankan migrasi bersamaan saat start.
 *
 * Migrasi standar pustaka (processed_event, lalu outbox di T0.3) dijalankan
 * lebih dulu dengan awalan "standar/".
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FOLDER_STANDAR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../sql');
const KUNCI_ADVISORY = 734_215_001;

function daftarSql(folder, awalan) {
  if (!folder || !existsSync(folder)) return [];
  return readdirSync(folder)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ nama: `${awalan}${f}`, berkas: path.join(folder, f) }));
}

/**
 * @param {import('pg').Pool} pool
 * @param {object} [opsi]
 * @param {string} [opsi.folder]   folder migrasi milik layanan
 * @param {boolean} [opsi.standar] jalankan migrasi standar pustaka, default true
 * @param {{ info: Function }} [opsi.log]
 * @returns {Promise<string[]>} nama migrasi yang baru dijalankan
 */
export async function jalankanMigrasi(pool, opsi = {}) {
  const semua = [
    ...(opsi.standar === false ? [] : daftarSql(FOLDER_STANDAR, 'standar/')),
    ...daftarSql(opsi.folder, ''),
  ];
  const klien = await pool.connect();
  const dijalankan = [];
  try {
    await klien.query('SELECT pg_advisory_lock($1)', [KUNCI_ADVISORY]);
    await klien.query(`CREATE TABLE IF NOT EXISTS schema_migrasi (
      nama TEXT PRIMARY KEY,
      dijalankan_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    const { rows } = await klien.query('SELECT nama FROM schema_migrasi');
    const sudah = new Set(rows.map((r) => r.nama));

    for (const { nama, berkas } of semua) {
      if (sudah.has(nama)) continue;
      await klien.query('BEGIN');
      try {
        await klien.query(readFileSync(berkas, 'utf8'));
        await klien.query('INSERT INTO schema_migrasi (nama) VALUES ($1)', [nama]);
        await klien.query('COMMIT');
      } catch (err) {
        await klien.query('ROLLBACK').catch(() => {});
        throw new Error(`Migrasi ${nama} gagal: ${err.message}`, { cause: err });
      }
      dijalankan.push(nama);
      opsi.log?.info('migrasi dijalankan', { migrasi: nama });
    }
  } finally {
    await klien.query('SELECT pg_advisory_unlock($1)', [KUNCI_ADVISORY]).catch(() => {});
    klien.release();
  }
  return dijalankan;
}
