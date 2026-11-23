import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { buatEvent, buatLogger, folderKontrak, validasiEvent } from '@puisiapp/events';
import { buatApp } from '../src/app.js';
import { keRepresentasi, kePayloadEvent, tanganiEventKepemilikan } from '../src/repo.js';

process.env.SERVICE_NAME = 'poem-edit-service';
const POEM = '0b7d6f0e-4a8b-4a52-9d0b-3f4f0e9b2a10';

/** Repo palsu dengan aturan yang sama dengan simpanRevisi. */
function repoMemori() {
  const milik = new Map([[POEM, { author_id: 'u-0042', deleted: false, versi_terakhir: 1 }]]);
  const revisi = new Map(); // `${poem}:${key}` -> baris
  return {
    milik,
    async simpanRevisi({ poemId, authorId, idempotencyKey, hash, data }) {
      const k = milik.get(poemId);
      if (!k) return { jenis: 'tidak_ada' };
      if (k.author_id !== authorId) return { jenis: 'bukan_pemilik' };
      if (k.deleted) return { jenis: 'terhapus' };
      const ada = revisi.get(`${poemId}:${idempotencyKey}`);
      if (ada) return ada.request_hash === hash ? { jenis: 'ulang', puisi: keRepresentasi(ada) } : { jenis: 'konflik' };
      k.versi_terakhir += 1;
      const baris = {
        poem_id: poemId, versi: k.versi_terakhir, author_id: authorId, judul: data.judul, isi: data.isi,
        bait_kutipan: data.baitKutipan, indeks_bait: data.indeksBait, template: data.template,
        kategori: data.kategori, keyword_manual: data.kataKunci, request_hash: hash, created_at: new Date(),
      };
      revisi.set(`${poemId}:${idempotencyKey}`, baris);
      return { jenis: 'baru', puisi: keRepresentasi(baris) };
    },
  };
}

function siapkan() {
  const repo = repoMemori();
  const app = buatApp({
    simpanRevisi: repo.simpanRevisi,
    cekSiap: async () => {},
    templateSah: ['latar1', 'latar2', 'latar3'],
    log: buatLogger('uji', {}, { tulis: () => {} }),
  });
  return { app, repo };
}

const body = { title: 'Jendela', body: 'baris satu\n\nbait dua', quote_stanza: 1, template_id: 'latar1' };
const put = (app, { id = POEM, user = 'u-0042', key = 'revisi-abc123', payload = body } = {}) =>
  app.inject({
    method: 'PUT',
    url: `/api/poems/${id}`,
    headers: { 'content-type': 'application/json', ...(user && { 'x-user-id': user }), ...(key && { 'idempotency-key': key }) },
    payload,
  });

test('pemilik merevisi -> 202, versi baru 2, lalu 3', async () => {
  const { app } = siapkan();
  const a = await put(app);
  assert.equal(a.statusCode, 202);
  assert.equal(a.json().version, 2);
  assert.equal(a.json().quote_text, 'bait dua');
  const b = await put(app, { key: 'revisi-def456' });
  assert.equal(b.json().version, 3);
});

test('bukan pemilik -> 403', async () => {
  assert.equal((await put(siapkan().app, { user: 'u-lain' })).statusCode, 403);
});

test('puisi terhapus atau tidak dikenal -> 404', async () => {
  const { app, repo } = siapkan();
  assert.equal((await put(app, { id: '11111111-2222-3333-4444-555555555555' })).statusCode, 404);
  assert.equal((await put(app, { id: 'bukan-uuid' })).statusCode, 404);
  repo.milik.get(POEM).deleted = true;
  const r = await put(app);
  assert.equal(r.statusCode, 404);
  assert.match(r.json().message, /dihapus/);
});

test('kirim ulang key sama -> versi sama; isi beda -> 409', async () => {
  const { app } = siapkan();
  const a = await put(app);
  const b = await put(app);
  assert.equal(b.json().version, a.json().version);
  assert.equal(b.headers['idempotent-replayed'], 'true');
  assert.equal((await put(app, { payload: { ...body, title: 'Lain' } })).statusCode, 409);
});

test('tanpa login -> 401, tanpa Idempotency-Key -> 400, validasi sama dengan pengajuan', async () => {
  const { app } = siapkan();
  assert.equal((await put(app, { user: null })).statusCode, 401);
  assert.equal((await put(app, { key: null })).statusCode, 400);
  const r = await put(app, { payload: { ...body, title: '<script>x</script>' } });
  assert.equal(r.statusCode, 400);
  assert.deepEqual(r.json().rincian.map((x) => x.field), ['title']);
});

test('payload poem.revised lolos skema kontrak dan amplop', () => {
  const skema = JSON.parse(readFileSync(`${folderKontrak()}/events/poem.revised.v1.json`, 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
  addFormats(ajv);
  const v = ajv.compile(skema);
  for (const c of skema.examples) assert.ok(v(c), JSON.stringify(v.errors));
  const rep = keRepresentasi({
    poem_id: POEM, versi: 2, author_id: 'u-0042', judul: 'a', isi: 'b', bait_kutipan: 'b', indeks_bait: 0,
    template: 'latar1', kategori: null, keyword_manual: [], created_at: new Date(),
  });
  assert.ok(v(kePayloadEvent(rep)), JSON.stringify(v.errors));
  assert.doesNotThrow(() => validasiEvent(buatEvent('poem.revised', POEM, 2, kePayloadEvent(rep))));
});

test('konsumen: poem.submitted membuat kepemilikan, poem.deleted menandai terhapus', async () => {
  const kueri = [];
  const tx = { query: async (sql, p) => { kueri.push({ sql: sql.replace(/\s+/g, ' ').trim(), p }); } };
  await tanganiEventKepemilikan(buatEvent('poem.submitted', POEM, 1, { poem_id: POEM, author_id: 'u-0042' }), { tx });
  await tanganiEventKepemilikan(
    buatEvent('poem.deleted', POEM, 3, { poem_id: POEM, author_id: 'u-0042', last_version: 3, deleted_at: new Date().toISOString() }),
    { tx },
  );
  assert.match(kueri[0].sql, /INSERT INTO poem_ownership .* ON CONFLICT \(poem_id\) DO NOTHING/);
  assert.deepEqual(kueri[0].p, [POEM, 'u-0042']);
  assert.match(kueri[1].sql, /DO UPDATE SET deleted = true/);
});
