/**
 * Uji refresh token terhadap Redis sungguhan. Dilewati bila REDIS_URL tidak diisi.
 * Contoh: REDIS_URL=redis://127.0.0.1:6379 npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from 'redis';
import { buatPenyimpanRefresh } from '../src/refresh.js';

const skip = !process.env.REDIS_URL && 'REDIS_URL belum diisi';

test('refresh token bisa dipakai sekali lalu dirotasi, pemakaian ulang ditolak', { skip }, async () => {
  const redis = createClient({ url: process.env.REDIS_URL });
  await redis.connect();
  try {
    const p = buatPenyimpanRefresh(redis);
    const klaim = { sub: 'acc-rot', username: 'rot_user', role: 'writer' };
    const t1 = await p.terbitkan(klaim);
    assert.deepEqual(await p.putar(t1), klaim);
    assert.equal(await p.putar(t1), null, 'token lama tidak boleh dipakai lagi');
    const t2 = await p.terbitkan(klaim);
    assert.notEqual(t1, t2);
    assert.deepEqual(await p.putar(t2), klaim);
  } finally {
    await redis.quit();
  }
});

test('token tidak ada atau kosong ditolak', { skip }, async () => {
  const redis = createClient({ url: process.env.REDIS_URL });
  await redis.connect();
  try {
    const p = buatPenyimpanRefresh(redis);
    assert.equal(await p.putar('tidak-pernah-ada'), null);
    assert.equal(await p.putar(''), null);
  } finally {
    await redis.quit();
  }
});

test('token tidak disimpan mentah di Redis (hanya hash)', { skip }, async () => {
  const redis = createClient({ url: process.env.REDIS_URL });
  await redis.connect();
  try {
    const p = buatPenyimpanRefresh(redis);
    const token = await p.terbitkan({ sub: 'x', username: 'x', role: 'writer' });
    const kunci = await redis.keys('rt:*');
    assert.ok(kunci.length > 0);
    assert.ok(!kunci.some((k) => k.includes(token)), 'token mentah tidak boleh muncul di kunci');
    await p.putar(token);
  } finally {
    await redis.quit();
  }
});
