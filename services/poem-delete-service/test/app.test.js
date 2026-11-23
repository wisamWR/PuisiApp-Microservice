import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { buatEvent, buatLogger, folderKontrak, validasiEvent } from '@puisiapp/events';
import { buatApp } from '../src/app.js';
import { tanganiEventKepemilikan } from '../src/repo.js';

process.env.SERVICE_NAME = 'poem-delete-service';
const POEM = '0b7d6f0e-4a8b-4a52-9d0b-3f4f0e9b2a10';

function siapkan() {
  const milik = new Map([[POEM, 'u-0042']]);
  const terhapus = new Map();
  let jumlahEvent = 0;
  const app = buatApp({
    hapusPuisi: async ({ poemId, authorId }) => {
      if (!milik.has(poemId)) return { jenis: 'tidak_ada' };
      if (milik.get(poemId) !== authorId) return { jenis: 'bukan_pemilik' };
      if (terhapus.has(poemId)) return { jenis: 'ulang', hasil: terhapus.get(poemId) };
      jumlahEvent++;
      const hasil = { poem_id: poemId, status: 'DELETED', deleted_at: new Date().toISOString() };
      terhapus.set(poemId, hasil);
      return { jenis: 'baru', hasil };
    },
    cekSiap: async () => {},
    log: buatLogger('uji', {}, { tulis: () => {} }),
  });
  return { app, jumlahEvent: () => jumlahEvent };
}

const hapus = (app, { id = POEM, user = 'u-0042' } = {}) =>
  app.inject({ method: 'DELETE', url: `/api/poems/${id}`, headers: user ? { 'x-user-id': user } : {} });

test('pemilik menghapus -> 202 DELETED', async () => {
  const { app } = siapkan();
  const r = await hapus(app);
  assert.equal(r.statusCode, 202);
  assert.equal(r.json().status, 'DELETED');
});

test('hapus dua kali -> 202 sama, hanya satu event', async () => {
  const s = siapkan();
  const a = await hapus(s.app);
  const b = await hapus(s.app);
  assert.equal(b.statusCode, 202);
  assert.equal(b.json().deleted_at, a.json().deleted_at);
  assert.equal(b.headers['idempotent-replayed'], 'true');
  assert.equal(s.jumlahEvent(), 1);
});

test('bukan pemilik -> 403, tidak dikenal -> 404, tanpa login -> 401', async () => {
  const { app } = siapkan();
  assert.equal((await hapus(app, { user: 'u-lain' })).statusCode, 403);
  assert.equal((await hapus(app, { id: '11111111-2222-3333-4444-555555555555' })).statusCode, 404);
  assert.equal((await hapus(app, { user: null })).statusCode, 401);
});

test('payload poem.deleted lolos skema kontrak dan amplop', () => {
  const skema = JSON.parse(readFileSync(`${folderKontrak()}/events/poem.deleted.v1.json`, 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
  addFormats(ajv);
  const v = ajv.compile(skema);
  for (const c of skema.examples) assert.ok(v(c), JSON.stringify(v.errors));
  const payload = { poem_id: POEM, author_id: 'u-0042', last_version: 3, deleted_at: new Date().toISOString() };
  assert.ok(v(payload), JSON.stringify(v.errors));
  assert.doesNotThrow(() => validasiEvent(buatEvent('poem.deleted', POEM, 3, payload)));
});

test('konsumen: poem.revised menaikkan versi terakhir (tidak pernah mundur)', async () => {
  const kueri = [];
  const tx = { query: async (sql, p) => { kueri.push({ sql: sql.replace(/\s+/g, ' ').trim(), p }); } };
  await tanganiEventKepemilikan(buatEvent('poem.revised', POEM, 3, { poem_id: POEM, author_id: 'u-0042', version: 3 }), { tx });
  assert.match(kueri[0].sql, /GREATEST\(poem_ownership.versi_terakhir, EXCLUDED.versi_terakhir\)/);
  assert.deepEqual(kueri[0].p, [POEM, 'u-0042', 3]);
});
