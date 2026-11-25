/**
 * Rekonsiliasi hitungan suara Redis (vote-live, milik vote-service) dengan
 * vote_db. Nama kunci harus sama dengan services/vote-service/src/skrip.js.
 *
 * Status per puisi:
 *   cocok          up/down/seq sama
 *   belum_persist  Redis lebih maju (seq Redis > seq DB): suara masih di queue, normal
 *   kosong         kunci Redis tidak ada (Redis dikosongkan/hilang) -> bangun ulang dari DB
 *   selisih        seq sama tetapi hitungan beda, atau Redis tertinggal dari DB -> bangun ulang
 */
const kunciSuara = (poemId) => `vote:v:${poemId}`;
const kunciHitung = (poemId) => `vote:c:${poemId}`;

/**
 * @param {{ seq: number, up: number, down: number }} db
 * @param {{ ada: boolean, seq: number, up: number, down: number }} redis
 */
export function bandingkan(db, redis) {
  if (!redis.ada) return 'kosong';
  if (redis.seq > db.seq) return 'belum_persist';
  if (redis.seq === db.seq && redis.up === db.up && redis.down === db.down) return 'cocok';
  return 'selisih';
}

async function bacaRedis(klien, poemId) {
  const [up, down, seq] = await klien.hmGet(kunciHitung(poemId), ['up', 'down', 'seq']);
  return { ada: seq !== null && seq !== undefined, up: Number(up ?? 0), down: Number(down ?? 0), seq: Number(seq ?? 0) };
}

/** Tulis ulang vote:v dan vote:c satu puisi dari suara aktif di DB (atomik lewat MULTI). */
async function bangunUlang(klien, db, aktif) {
  const multi = klien.multi().del(kunciSuara(db.poem_id));
  if (aktif.length) {
    multi.hSet(kunciSuara(db.poem_id), Object.fromEntries(aktif.map((s) => [s.user_id, String(s.value)])));
  }
  multi.hSet(kunciHitung(db.poem_id), { up: String(db.up), down: String(db.down), seq: String(db.seq) });
  await multi.exec();
}

/**
 * @param {object} d
 * @param {import('redis').RedisClientType} d.redis
 * @param {{ hitunganPerPuisi: Function, suaraAktif: Function }} d.repo  sudah terikat ke pool
 * @param {boolean} [d.perbaiki]  bangun ulang Redis untuk status kosong/selisih
 * @param {string[]} [d.poemIds]
 */
export async function rekonsiliasi(d) {
  const ringkasan = { cocok: 0, belum_persist: 0, kosong: 0, selisih: 0, dibangun_ulang: 0 };
  const rincian = [];
  for (const db of await d.repo.hitunganPerPuisi(d.poemIds)) {
    const r = await bacaRedis(d.redis, db.poem_id);
    const status = bandingkan(db, r);
    ringkasan[status]++;
    if (status !== 'cocok') rincian.push({ poem_id: db.poem_id, status, db: { up: db.up, down: db.down, seq: db.seq }, redis: r });
    if (d.perbaiki && (status === 'kosong' || status === 'selisih')) {
      await bangunUlang(d.redis, db, await d.repo.suaraAktif(db.poem_id));
      ringkasan.dibangun_ulang++;
    }
  }
  return { ringkasan, rincian };
}
