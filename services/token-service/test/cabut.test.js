/** Daftar cabut terhadap Redis sungguhan. Dilewati bila REDIS_URL tidak diisi. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from 'redis';
import { buatDaftarCabut } from '../src/cabut.js';

const skip = !process.env.REDIS_URL && 'REDIS_URL belum diisi';
const detik = () => Math.floor(Date.now() / 1000);

test('token yang dicabut langsung terdeteksi, TTL sama dengan sisa masa berlaku', { skip }, async () => {
  const redis = createClient({ url: process.env.REDIS_URL });
  await redis.connect();
  try {
    const d = buatDaftarCabut(redis);
    const jti = `uji-${Math.random()}`;
    assert.equal(await d.sudahDicabut(jti), false);
    await d.tambah(jti, detik() + 600);
    assert.equal(await d.sudahDicabut(jti), true);
    const ttl = await redis.ttl(`cabut:${jti}`);
    assert.ok(ttl > 590 && ttl <= 600, `TTL harus sekitar 600 detik, dapat ${ttl}`);
  } finally {
    await redis.quit();
  }
});

test('token yang sudah kedaluwarsa tidak dicatat (daftar tidak membengkak)', { skip }, async () => {
  const redis = createClient({ url: process.env.REDIS_URL });
  await redis.connect();
  try {
    const d = buatDaftarCabut(redis);
    const jti = `lewat-${Math.random()}`;
    await d.tambah(jti, detik() - 10);
    assert.equal(await d.sudahDicabut(jti), false);
  } finally {
    await redis.quit();
  }
});

test('jti kosong atau tidak dikenal tidak dianggap dicabut', { skip }, async () => {
  const redis = createClient({ url: process.env.REDIS_URL });
  await redis.connect();
  try {
    const d = buatDaftarCabut(redis);
    assert.equal(await d.sudahDicabut(undefined), false);
    assert.equal(await d.sudahDicabut('tidak-ada-sama-sekali'), false);
  } finally {
    await redis.quit();
  }
});
