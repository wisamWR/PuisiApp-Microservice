/**
 * Bandingkan hitungan suara Redis dengan vote_db, dan bangun ulang Redis dari
 * vote_db bila Redis kosong atau berselisih.
 *
 *   node scripts/rekonsiliasi.js                 # laporan saja
 *   node scripts/rekonsiliasi.js --perbaiki      # + bangun ulang yang kosong/selisih
 *   node scripts/rekonsiliasi.js --perbaiki <poem_id> ...
 *
 * Di container: docker compose exec vote-persist-worker node scripts/rekonsiliasi.js
 * Jalankan --perbaiki saat lalu lintas sepi: suara yang masuk selama
 * pembangunan ulang satu puisi bisa tertimpa (Redis tidak dikunci).
 * Butuh DATABASE_URL dan REDIS_HOST/REDIS_PORT/REDIS_PASSWORD (atau REDIS_URL).
 */
import pg from 'pg';
import { createClient } from 'redis';
import { rekonsiliasi } from '../src/rekonsiliasi.js';
import { hitunganPerPuisi, suaraAktif } from '../src/repo.js';

const argumen = process.argv.slice(2);
const perbaiki = argumen.includes('--perbaiki');
const poemIds = argumen.filter((a) => !a.startsWith('--'));

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const redis = createClient({
  url: process.env.REDIS_URL,
  socket: { host: process.env.REDIS_HOST ?? 'localhost', port: Number(process.env.REDIS_PORT ?? 6379) },
  password: process.env.REDIS_URL ? undefined : process.env.REDIS_PASSWORD || undefined,
});
await redis.connect();

try {
  const hasil = await rekonsiliasi({
    redis,
    perbaiki,
    poemIds,
    repo: {
      hitunganPerPuisi: (ids) => hitunganPerPuisi(pool, ids),
      suaraAktif: (id) => suaraAktif(pool, id),
    },
  });
  console.log(JSON.stringify(hasil, null, 2));
  const masalah = hasil.ringkasan.kosong + hasil.ringkasan.selisih - hasil.ringkasan.dibangun_ulang;
  process.exitCode = masalah > 0 ? 2 : 0;
} finally {
  await redis.quit();
  await pool.end();
}
