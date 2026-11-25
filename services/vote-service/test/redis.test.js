/**
 * Uji skrip Lua terhadap Redis sungguhan. Dilewati bila REDIS_URL_UJI kosong
 * (CI tidak menyediakan Redis). Lokal:
 *   docker run -d --rm -p 6390:6379 redis:7.4.12-alpine
 *   REDIS_URL_UJI=redis://127.0.0.1:6390 npm test
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buatKlienRedis, buatToko } from '../src/toko.js';
import { logSenyap, PENULIS } from './bantu.js';

const url = process.env.REDIS_URL_UJI;
const lewati = !url && 'REDIS_URL_UJI tidak diisi';

let klien;
let toko;
before(async () => {
  if (lewati) return;
  klien = await buatKlienRedis({ url, log: logSenyap });
  toko = buatToko(klien);
});
after(async () => {
  await klien?.quit();
});

async function puisiTerbit() {
  const poem = randomUUID();
  await toko.perbaruiMeta(poem, { status: 'SUBMITTED', waktuMs: 1, owner: PENULIS });
  await toko.perbaruiMeta(poem, { status: 'PUBLISHED', waktuMs: 2 });
  return poem;
}

test('Lua: aturan pemilik/status dan hitungan naik-turun', { skip: lewati }, async () => {
  const poem = await puisiTerbit();
  assert.equal((await toko.beriSuara(poem, PENULIS, 1)).kode, 'pemilik');
  assert.equal((await toko.beriSuara(randomUUID(), 'u1', 1)).kode, 'tidak_ada');

  let r = await toko.beriSuara(poem, 'u1', 1);
  assert.deepEqual([r.kode, r.lama, r.baru, r.up, r.down, r.seq], ['ok', 0, 1, 1, 0, 1]);
  r = await toko.beriSuara(poem, 'u1', 1);
  assert.deepEqual([r.kode, r.up, r.seq], ['sama', 1, 1]);
  r = await toko.beriSuara(poem, 'u1', -1);
  assert.deepEqual([r.kode, r.lama, r.baru, r.up, r.down, r.seq], ['ok', 1, -1, 0, 1, 2]);
  r = await toko.beriSuara(poem, 'u1', 0);
  assert.deepEqual([r.up, r.down, r.seq], [0, 0, 3]);
  assert.equal((await toko.lihat(poem, 'u1')).nilai, 0);

  await toko.perbaruiMeta(poem, { status: 'HIDDEN', waktuMs: 3 });
  assert.equal((await toko.beriSuara(poem, 'u2', 1)).kode, 'belum_terbit');
  // Event lama yang tiba belakangan tidak menimpa status.
  await toko.perbaruiMeta(poem, { status: 'PUBLISHED', waktuMs: 2 });
  assert.equal((await toko.lihat(poem, 'u2')).status, 'HIDDEN');
});

test('Lua: kompensasi hanya bila belum ada suara sesudahnya', { skip: lewati }, async () => {
  const poem = await puisiTerbit();
  const a = await toko.beriSuara(poem, 'u1', 1);
  assert.equal(await toko.batalkan(poem, 'u1', a.lama, a.baru, a.seq), true);
  let s = await toko.lihat(poem, 'u1');
  assert.deepEqual([s.up, s.nilai], [0, 0]);

  const b = await toko.beriSuara(poem, 'u1', 1);
  await toko.beriSuara(poem, 'u2', 1);
  assert.equal(await toko.batalkan(poem, 'u1', b.lama, b.baru, b.seq), false);
  s = await toko.lihat(poem, 'u1');
  assert.deepEqual([s.up, s.nilai], [2, 1]);
});

test('Lua: 1.000 suara bersamaan (500 pengguna, ganti naik/turun) tanpa salah hitung', { skip: lewati }, async () => {
  const poem = await puisiTerbit();
  const pengguna = Array.from({ length: 500 }, (_, i) => `beban-${i}`);
  // Putaran 1: semua upvote. Putaran 2: separuh ganti downvote, bersamaan.
  await Promise.all(pengguna.map((u) => toko.beriSuara(poem, u, 1)));
  await Promise.all(pengguna.map((u, i) => toko.beriSuara(poem, u, i % 2 ? -1 : 1)));
  const s = await toko.lihat(poem, 'pengamat');
  assert.deepEqual([s.up, s.down], [250, 250]);
  assert.equal(Number(await klien.hGet(`vote:c:${poem}`, 'seq')), 750, '500 suara baru + 250 perubahan');
  assert.equal(await klien.hLen(`vote:v:${poem}`), 500);
});

test('Lua: rate limit per menit dan penanda akun baru kedaluwarsa', { skip: lewati }, async () => {
  const u = randomUUID();
  const t = Date.now();
  for (let i = 1; i <= 3; i++) assert.equal((await toko.hitungRate(u, t)).jumlah, i);
  assert.equal(await toko.catatAkun(u, t - 86_400_000 + 1_000, t), true);
  assert.equal(await toko.akunBaru(u), true);
  assert.equal(await toko.catatAkun('lama', t - 2 * 86_400_000, t), false);
  assert.equal(await toko.akunBaru('lama'), false);
});
