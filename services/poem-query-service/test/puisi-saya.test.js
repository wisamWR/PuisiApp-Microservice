/**
 * GET /api/me/poems (T2.8): kontrak OpenAPI, API, dan kueri dengan PostgreSQL
 * (bagian DB dilewati bila TEST_DATABASE_URL kosong).
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';
import pg from 'pg';
import { buatStorePg, folderKontrak, jalankanMigrasi } from '@puisiapp/events';
import { proyeksikan } from '../src/proyeksi.js';
import { daftarMilik } from '../src/repo.js';
import { puisiSaya } from '../src/tampilan.js';
import { buatApp } from '../src/app.js';
import { e, PENULIS } from './bantu.js';

const dok = parse(readFileSync(`${folderKontrak()}/openapi/poem-query.yaml`, 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema({ $id: 'poem-query', components: dok.components });
const halamanSah = ajv.getSchema('poem-query#/components/schemas/HalamanPuisiSaya');
const sahkan = (data) => assert.ok(halamanSah(data), ajv.errorsText(halamanSah.errors));

test('contoh /api/me/poems di OpenAPI sesuai skemanya', () => {
  sahkan(dok.paths['/api/me/poems'].get.responses['200'].content['application/json'].example);
});

describe('API /api/me/poems', () => {
  const panggilan = [];
  const app = buatApp({
    ambilBundel: async () => null,
    daftarPenulis: async () => ({ total: 0, baris: [] }),
    daftarMilik: async (q) => (panggilan.push(q), { total: 0, counts: { PROCESSING: 0, REPROCESSING: 0, PUBLISHED: 0, HELD: 0, HIDDEN: 0 }, baris: [] }),
    cache: { ambil: async () => undefined, simpan: async () => {} },
    cekSiap: async () => {},
    log: { info() {}, warn() {}, error() {} },
  });
  const get = (url, user = PENULIS) => app.inject({ method: 'GET', url, headers: user ? { 'x-user-id': user } : {} });

  test('memakai identitas dari gateway, bukan parameter', async () => {
    const r = await get('/api/me/poems?status=held&author=orang-lain');
    assert.equal(r.statusCode, 200);
    sahkan(r.json());
    assert.deepEqual(panggilan.at(-1), { authorId: PENULIS, status: 'HELD', page: 1, size: 20 });
  });

  test('tanpa login 401; status tidak dikenal 400', async () => {
    assert.equal((await get('/api/me/poems', null)).statusCode, 401);
    assert.equal((await get('/api/me/poems?status=DELETED')).statusCode, 400);
    assert.equal((await get('/api/me/poems?size=0')).statusCode, 400);
  });
});

// Basis data sendiri (akhiran _saya): node --test menjalankan berkas uji paralel,
// dan db.test.js mengosongkan tabel yang sama di basis data TEST_DATABASE_URL.
const URL_DB = process.env.TEST_DATABASE_URL?.replace(/\/([^/?]+)(\?|$)/, '/$1_saya$2');
describe('daftarMilik dengan PostgreSQL', { skip: !URL_DB && 'TEST_DATABASE_URL kosong' }, () => {
  let pool;
  let store;
  before(async () => {
    const nama = new URL(URL_DB).pathname.slice(1);
    const admin = new pg.Client({ connectionString: URL_DB.replace(`/${nama}`, '/postgres') });
    await admin.connect();
    if (!(await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [nama])).rowCount) await admin.query(`CREATE DATABASE "${nama}"`);
    await admin.end();
    pool = new pg.Pool({ connectionString: URL_DB, max: 5 });
    await jalankanMigrasi(pool, { folder: path.join(path.dirname(fileURLToPath(import.meta.url)), '../migrations') });
    store = buatStorePg(pool);
  });
  after(async () => pool?.end());
  beforeEach(async () => pool.query('TRUNCATE poem, poem_versi, penulis, processed_event'));

  const jalankan = async (events) => {
    for (const ev of events) {
      await store.proses(ev, async ({ tx }) => {
        await proyeksikan(tx, ev);
        return 'diproses';
      });
    }
  };

  test('semua status milik sendiri, alasan ditahan, filter, dan hitungan', async () => {
    const [proses, terbit, tahan, sembunyi, revisi, hapus] = Array.from({ length: 6 }, () => randomUUID());
    await jalankan([
      e.diajukan(proses),
      e.diajukan(terbit), e.terbit(terbit),
      e.diajukan(tahan), e.ditahan(tahan),
      e.diajukan(sembunyi), e.terbit(sembunyi), e.disembunyikan(sembunyi),
      e.diajukan(revisi), e.terbit(revisi), e.direvisi(revisi, 2),
      e.diajukan(hapus), e.dihapus(hapus),
    ]);
    const semua = await daftarMilik(pool, { authorId: PENULIS, status: null, page: 1, size: 20 });
    assert.equal(semua.total, 5, 'DELETED tidak ikut');
    assert.deepEqual(semua.counts, { PROCESSING: 1, REPROCESSING: 1, PUBLISHED: 1, HELD: 1, HIDDEN: 1 });
    const halaman = { items: semua.baris.map(puisiSaya), page: 1, size: 20, total: semua.total, counts: semua.counts };
    sahkan(halaman);

    const ditahan = halaman.items.find((p) => p.poem_id === tahan);
    assert.equal(ditahan.status, 'HELD');
    assert.equal(ditahan.status_reason, 'Skor 0.9', 'puisi ditahan beserta alasannya');
    assert.equal(halaman.items.find((p) => p.poem_id === sembunyi).status_reason, 'Laporan dikabulkan');
    const rev = halaman.items.find((p) => p.poem_id === revisi);
    assert.deepEqual([rev.status, rev.version, rev.published_version], ['REPROCESSING', 2, 1]);
    assert.equal(halaman.items.find((p) => p.poem_id === terbit).status_reason, null);

    const hanyaTahan = await daftarMilik(pool, { authorId: PENULIS, status: 'HELD', page: 1, size: 20 });
    assert.deepEqual(hanyaTahan.baris.map((r) => r.poem_id), [tahan]);
    assert.equal(hanyaTahan.counts.PUBLISHED, 1, 'hitungan tetap untuk semua status');

    const lain = await daftarMilik(pool, { authorId: 'orang-lain', status: null, page: 1, size: 20 });
    assert.equal(lain.total, 0);
  });

  test('alasan dikosongkan lagi saat puisi tampil kembali', async () => {
    const id = randomUUID();
    await jalankan([e.diajukan(id), e.terbit(id), e.disembunyikan(id), e.terbit(id, 1, '2099-01-01T00:00:00.000Z')]);
    const { baris } = await daftarMilik(pool, { authorId: PENULIS, status: null, page: 1, size: 20 });
    assert.equal(puisiSaya(baris[0]).status, 'PUBLISHED');
    assert.equal(baris[0].alasan_status, null);
  });
});
