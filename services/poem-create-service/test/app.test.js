import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buatLogger } from '@puisiapp/events';
import { buatApp } from '../src/app.js';
import { keRepresentasi } from '../src/repo.js';

process.env.SERVICE_NAME = 'poem-create-service';

/** Repo palsu dengan perilaku idempotensi yang sama dengan simpanPengajuan. */
function repoMemori() {
  const tersimpan = new Map(); // `${author}:${key}` -> baris
  const panggilan = [];
  return {
    panggilan,
    async simpanPengajuan(p) {
      panggilan.push(p);
      const k = `${p.authorId}:${p.idempotencyKey}`;
      const ada = tersimpan.get(k);
      if (ada) return ada.request_hash === p.hash ? { jenis: 'ulang', puisi: keRepresentasi(ada) } : { jenis: 'konflik' };
      const baris = {
        poem_id: `0b7d6f0e-4a8b-4a52-9d0b-${String(tersimpan.size).padStart(12, '0')}`,
        author_id: p.authorId,
        judul: p.data.judul,
        isi: p.data.isi,
        bait_kutipan: p.data.baitKutipan,
        indeks_bait: p.data.indeksBait,
        template: p.data.template,
        kategori: p.data.kategori,
        keyword_manual: p.data.kataKunci,
        request_hash: p.hash,
        created_at: new Date('2026-11-17T03:00:00Z'),
      };
      tersimpan.set(k, baris);
      return { jenis: 'baru', puisi: keRepresentasi(baris) };
    },
  };
}

function siapkan({ dbSiap = true } = {}) {
  const repo = repoMemori();
  const app = buatApp({
    simpanPengajuan: repo.simpanPengajuan,
    cekDb: async () => { if (!dbSiap) throw new Error('db mati'); },
    templateSah: ['latar1', 'latar2', 'latar3'],
    log: buatLogger('uji', {}, { tulis: () => {} }),
  });
  return { app, repo };
}

const body = {
  title: 'Jendela yang Basah',
  body: 'sore turun tanpa permisi\nhujan mengetuk kaca\n\nseperti nama yang tak jadi kupanggil',
  quote_stanza: 0,
  template_id: 'latar2',
};
const header = (tambahan = {}) => ({
  'content-type': 'application/json',
  'x-user-id': 'u-0042',
  'idempotency-key': 'draf-abc12345',
  'x-request-id': 'req-8d2f6b',
  ...tambahan,
});
const kirim = (app, { headers = header(), payload = body } = {}) =>
  app.inject({ method: 'POST', url: '/api/poems', headers, payload });

test('202 berisi poem_id, versi 1, status PROCESSING, dan Location', async () => {
  const { app, repo } = siapkan();
  const r = await kirim(app);
  assert.equal(r.statusCode, 202);
  const j = r.json();
  assert.equal(j.version, 1);
  assert.equal(j.status, 'PROCESSING');
  assert.equal(j.author_id, 'u-0042');
  assert.equal(j.quote_text, 'sore turun tanpa permisi\nhujan mengetuk kaca');
  assert.equal(r.headers.location, `/api/poems/${j.poem_id}`);
  assert.equal(r.headers['idempotent-replayed'], undefined);
  assert.equal(repo.panggilan[0].konteks.correlationId, 'req-8d2f6b', 'X-Request-Id menjadi correlation_id');
});

test('Idempotency-Key sama + isi sama -> jawaban sama, tanpa puisi baru', async () => {
  const { app } = siapkan();
  const a = await kirim(app);
  const b = await kirim(app);
  assert.equal(b.statusCode, 202);
  assert.equal(b.json().poem_id, a.json().poem_id);
  assert.equal(b.headers['idempotent-replayed'], 'true');
});

test('Idempotency-Key sama + isi beda -> 409', async () => {
  const { app } = siapkan();
  await kirim(app);
  const r = await kirim(app, { payload: { ...body, title: 'Judul Lain' } });
  assert.equal(r.statusCode, 409);
  assert.equal(r.json().error, 'idempotency_key_bentrok');
});

test('penulis lain boleh memakai key yang sama', async () => {
  const { app } = siapkan();
  const a = await kirim(app);
  const b = await kirim(app, { headers: header({ 'x-user-id': 'u-0099' }) });
  assert.equal(b.statusCode, 202);
  assert.notEqual(b.json().poem_id, a.json().poem_id);
});

test('tanpa X-User-Id -> 401; tanpa atau salah format Idempotency-Key -> 400', async () => {
  const { app } = siapkan();
  const h = header();
  delete h['x-user-id'];
  assert.equal((await kirim(app, { headers: h })).statusCode, 401);
  const tanpaKey = header();
  delete tanpaKey['idempotency-key'];
  assert.equal((await kirim(app, { headers: tanpaKey })).statusCode, 400);
  assert.equal((await kirim(app, { headers: header({ 'idempotency-key': 'pendek' }) })).statusCode, 400);
});

test('validasi gagal -> 400 dengan rincian per field', async () => {
  const { app, repo } = siapkan();
  const r = await kirim(app, { payload: { ...body, title: '', template_id: 'x' } });
  assert.equal(r.statusCode, 400);
  assert.deepEqual(r.json().rincian.map((x) => x.field), ['title', 'template_id']);
  assert.equal(repo.panggilan.length, 0, 'tidak menyentuh basis data');
});

test('author_id di body tidak bisa menggantikan X-User-Id', async () => {
  const { app } = siapkan();
  const r = await kirim(app, { payload: { ...body, author_id: 'orang-lain' } });
  assert.equal(r.statusCode, 400);
});

test('JSON rusak -> 400, bukan JSON -> 415, body > 64 KB -> 413', async () => {
  const { app } = siapkan();
  assert.equal((await kirim(app, { payload: '{"title":' })).statusCode, 400);
  assert.equal((await kirim(app, { headers: header({ 'content-type': 'text/plain' }), payload: 'halo' })).statusCode, 415);
  const besar = await kirim(app, { payload: { ...body, body: 'x'.repeat(70 * 1024) } });
  assert.equal(besar.statusCode, 413);
});

test('/health/ready 503 saat basis data tidak siap', async () => {
  assert.equal((await siapkan().app.inject('/health/ready')).statusCode, 200);
  assert.equal((await siapkan({ dbSiap: false }).app.inject('/health/ready')).statusCode, 503);
});
