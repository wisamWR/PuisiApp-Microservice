/**
 * Uji terhadap PostgreSQL (dan Redis) sungguhan. Dilewati bila
 * DATABASE_URL_UJI kosong. Lokal:
 *   docker run -d --rm -p 55433:5432 -e POSTGRES_PASSWORD=uji postgres:16.15-alpine
 *   DATABASE_URL_UJI=postgres://postgres:uji@127.0.0.1:55433/postgres REDIS_URL_UJI=redis://127.0.0.1:6390 npm test
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createClient } from 'redis';
import { jalankanMigrasi } from '@puisiapp/events';
import { gabungkan } from '../src/batch.js';
import { rekonsiliasi } from '../src/rekonsiliasi.js';
import { hitunganPerPuisi, simpanBatch, suaraAktif } from '../src/repo.js';
import { logSenyap, vote } from './bantu.js';

const url = process.env.DATABASE_URL_UJI;
const lewati = !url && 'DATABASE_URL_UJI tidak diisi';
const lewatiRedis = (!url || !process.env.REDIS_URL_UJI) && 'DATABASE_URL_UJI atau REDIS_URL_UJI tidak diisi';
const folder = path.join(path.dirname(fileURLToPath(import.meta.url)), '../migrations');

let pool;
before(async () => {
  if (lewati) return;
  pool = new pg.Pool({ connectionString: url, max: 4 });
  await jalankanMigrasi(pool, { folder, standar: false, log: logSenyap });
});
after(async () => {
  await pool?.end();
});

test('UPSERT: duplikat dan urutan acak tidak mengubah hasil', { skip: lewati }, async () => {
  const poem = randomUUID();
  const urut = [
    vote({ poem, user: 'u1', nilai: 1, seq: 1 }),
    vote({ poem, user: 'u2', nilai: 1, seq: 2 }),
    vote({ poem, user: 'u1', nilai: -1, lama: 1, seq: 3 }),
    vote({ poem, user: 'u2', nilai: 0, lama: 1, seq: 4 }),
  ];
  // Batch 1: suara terbaru. Batch 2: suara lama + duplikat tiba belakangan.
  await simpanBatch(pool, gabungkan(urut.slice(2)));
  const berubah = await simpanBatch(pool, gabungkan([urut[0], urut[1], urut[2], urut[3]]));
  assert.equal(berubah, 0, 'tidak ada baris yang mundur ke suara lama');

  const [h] = await hitunganPerPuisi(pool, [poem]);
  assert.deepEqual({ up: h.up, down: h.down, seq: h.seq }, { up: 0, down: 1, seq: 4 });
  assert.deepEqual(await suaraAktif(pool, poem), [{ user_id: 'u1', value: -1 }]);
});

test('10.000 suara: hitungan vote_db sama dengan hitungan yang diharapkan', { skip: lewati }, async () => {
  const poem = randomUUID();
  const terakhir = new Map();
  const events = [];
  for (let seq = 1; seq <= 10_000; seq++) {
    const user = `u${Math.floor(Math.random() * 3000)}`;
    const lama = terakhir.get(user) ?? 0;
    let nilai = [1, -1, 0][Math.floor(Math.random() * 3)];
    if (nilai === lama) nilai = lama === 1 ? -1 : 1;
    terakhir.set(user, nilai);
    events.push(vote({ poem, user, nilai, lama, seq }));
  }
  // Acak urutan lalu kirim dua kali (redelivery), batch 200.
  const kirim = [...events, ...events].sort(() => Math.random() - 0.5);
  for (let i = 0; i < kirim.length; i += 200) await simpanBatch(pool, gabungkan(kirim.slice(i, i + 200)));

  const harap = [...terakhir.values()];
  const [h] = await hitunganPerPuisi(pool, [poem]);
  assert.equal(h.up, harap.filter((v) => v === 1).length);
  assert.equal(h.down, harap.filter((v) => v === -1).length);
  assert.equal(h.seq, 10_000);
});

test('rekonsiliasi: Redis kosong dibangun ulang dari vote_db', { skip: lewatiRedis }, async () => {
  const redis = createClient({ url: process.env.REDIS_URL_UJI });
  await redis.connect();
  try {
    const poem = randomUUID();
    await simpanBatch(pool, gabungkan([
      vote({ poem, user: 'a', nilai: 1, seq: 1 }),
      vote({ poem, user: 'b', nilai: -1, seq: 2 }),
      vote({ poem, user: 'c', nilai: 1, seq: 3 }),
    ]));
    const repo = { hitunganPerPuisi: (ids) => hitunganPerPuisi(pool, ids), suaraAktif: (id) => suaraAktif(pool, id) };

    let r = await rekonsiliasi({ redis, repo, poemIds: [poem] });
    assert.equal(r.ringkasan.kosong, 1);

    r = await rekonsiliasi({ redis, repo, poemIds: [poem], perbaiki: true });
    assert.equal(r.ringkasan.dibangun_ulang, 1);
    assert.deepEqual({ ...(await redis.hGetAll(`vote:c:${poem}`)) }, { up: '2', down: '1', seq: '3' });
    assert.deepEqual({ ...(await redis.hGetAll(`vote:v:${poem}`)) }, { a: '1', b: '-1', c: '1' });

    r = await rekonsiliasi({ redis, repo, poemIds: [poem] });
    assert.equal(r.ringkasan.cocok, 1);
  } finally {
    await redis.quit();
  }
});
