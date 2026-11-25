import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buatApp } from '../src/app.js';
import { bundel, PENULIS } from './bantu.js';

const ID = '0b7d6f0e-4a8b-4a52-9d0b-3f4f0e9b2a10';
const diam = { info() {}, warn() {}, error() {} };

function siapkan(o = {}) {
  const isiCache = new Map(o.cache ?? []);
  const panggilan = { db: 0, daftar: [] };
  const app = buatApp({
    ambilBundel: async (id) => {
      panggilan.db++;
      return o.data?.[id] ?? null;
    },
    daftarPenulis: async (q) => {
      panggilan.daftar.push(q);
      return { total: 0, baris: [] };
    },
    cache: {
      ambil: async (id) => (o.cacheMati ? undefined : isiCache.get(id)),
      simpan: async (id, b) => {
        if (!o.cacheMati) isiCache.set(id, b);
      },
    },
    cekSiap: async () => {},
    log: diam,
  });
  return { app, panggilan, isiCache };
}

const get = (app, url, user = 'u-lain', role = 'writer') =>
  app.inject({ method: 'GET', url, headers: user ? { 'x-user-id': user, 'x-user-role': role } : {} });

describe('GET /api/poems/{id}', () => {
  test('MISS lalu HIT: basis data hanya dibaca sekali', async () => {
    const { app, panggilan } = siapkan({ data: { [ID]: bundel() } });
    const r1 = await get(app, `/api/poems/${ID}`);
    assert.equal(r1.statusCode, 200);
    assert.equal(r1.headers['x-cache'], 'MISS');
    const r2 = await get(app, `/api/poems/${ID}`);
    assert.equal(r2.headers['x-cache'], 'HIT');
    assert.deepEqual(r2.json(), r1.json());
    assert.equal(panggilan.db, 1);
    assert.match(r2.headers['cache-control'], /private/);
  });

  test('cache berisi bundel mentah: pembaca lain tetap disaring dari cache', async () => {
    const b = bundel({ status: 'HELD', versi_tampil: null });
    const { app } = siapkan({ cache: [[ID, b]] });
    assert.equal((await get(app, `/api/poems/${ID}`, PENULIS)).statusCode, 200);
    const lain = await get(app, `/api/poems/${ID}`, 'u-lain');
    assert.equal(lain.statusCode, 404);
    assert.equal(lain.headers['x-cache'], 'HIT');
  });

  test('Redis mati: tetap melayani dari basis data', async () => {
    const { app, panggilan } = siapkan({ data: { [ID]: bundel() }, cacheMati: true });
    assert.equal((await get(app, `/api/poems/${ID}`)).statusCode, 200);
    assert.equal((await get(app, `/api/poems/${ID}`)).statusCode, 200);
    assert.equal(panggilan.db, 2);
  });

  test('tidak ada / bukan UUID: 404; tanpa X-User-Id: 401', async () => {
    const { app } = siapkan();
    assert.equal((await get(app, `/api/poems/${ID}`)).statusCode, 404);
    assert.equal((await get(app, '/api/poems/bukan-uuid')).statusCode, 404);
    assert.equal((await get(app, `/api/poems/${ID}`, null)).statusCode, 401);
  });

  test('UUID huruf besar dinormalkan', async () => {
    const { app } = siapkan({ data: { [ID]: bundel() } });
    assert.equal((await get(app, `/api/poems/${ID.toUpperCase()}`)).statusCode, 200);
  });
});

describe('GET /api/poems', () => {
  test('penulis sendiri: semua status; orang lain: hanya terbit', async () => {
    const { app, panggilan } = siapkan();
    await get(app, `/api/poems?author=${PENULIS}`, PENULIS);
    await get(app, `/api/poems?author=${PENULIS}&page=2&size=5`, 'u-lain');
    assert.deepEqual(panggilan.daftar, [
      { authorId: PENULIS, semua: true, page: 1, size: 20 },
      { authorId: PENULIS, semua: false, page: 2, size: 5 },
    ]);
  });

  test('tanpa author (daftar publik beranda): authorId null, semua false', async () => {
    const { app, panggilan } = siapkan();
    for (const q of ['', '?page=2&size=12', '?author=']) {
      const r = await get(app, `/api/poems${q}`, PENULIS);
      assert.equal(r.statusCode, 200, q);
    }
    assert.deepEqual(panggilan.daftar, [
      { authorId: null, semua: false, page: 1, size: 20 },
      { authorId: null, semua: false, page: 2, size: 12 },
      { authorId: null, semua: false, page: 1, size: 20 },
    ]);
  });

  test('parameter tidak valid: 400', async () => {
    const { app } = siapkan();
    const terlaluPanjang = `?author=${'a'.repeat(65)}`;
    for (const q of [terlaluPanjang, '?author=a&author=b', '?page=0', '?size=51', '?author=a&page=0', '?author=a&size=51', '?author=a&size=x']) {
      assert.equal((await get(app, `/api/poems${q}`)).statusCode, 400, q);
    }
  });

  test('bentuk halaman', async () => {
    const { app } = siapkan();
    assert.deepEqual((await get(app, '/api/poems')).json(), { items: [], page: 1, size: 20, total: 0 });
    assert.deepEqual((await get(app, '/api/poems?author=a')).json(), { items: [], page: 1, size: 20, total: 0 });
  });
});
