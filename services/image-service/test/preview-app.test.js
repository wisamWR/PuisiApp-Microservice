import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buatLogger } from '@puisiapp/events';
import { muatTemplate } from '../src/render.js';
import { buatAppPratinjau } from '../src/preview-app.js';

const folder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets/templates');
let app;
before(async () => {
  app = buatAppPratinjau({ templates: await muatTemplate(folder), log: buatLogger('uji', {}, { tulis: () => {} }) });
});

const url = (template, text) =>
  `/api/images/preview?template=${encodeURIComponent(template)}&text=${encodeURIComponent(text)}`;

test('pratinjau sah -> 200 JPEG, Cache-Control publik, ETag', async () => {
  const r = await app.inject(url('latar2', 'hujan mengetuk kaca\nseperti nama'));
  assert.equal(r.statusCode, 200);
  assert.equal(r.headers['content-type'], 'image/jpeg');
  assert.equal(r.headers['cache-control'], 'public, max-age=86400');
  assert.ok(r.headers.etag);
  assert.equal(r.rawPayload.subarray(0, 2).toString('hex'), 'ffd8', 'awal berkas JPEG');
});

test('If-None-Match cocok -> 304 tanpa render ulang', async () => {
  const a = await app.inject(url('latar1', 'sore turun'));
  const b = await app.inject({ url: url('latar1', 'sore turun'), headers: { 'if-none-match': a.headers.etag } });
  assert.equal(b.statusCode, 304);
  assert.equal(b.rawPayload.length, 0);
});

test('ETag berubah bila teks atau template berubah', async () => {
  const a = await app.inject(url('latar1', 'sore turun'));
  const b = await app.inject(url('latar1', 'sore turun pelan'));
  const c = await app.inject(url('latar2', 'sore turun'));
  assert.notEqual(a.headers.etag, b.headers.etag);
  assert.notEqual(a.headers.etag, c.headers.etag);
});

test('template tak dikenal, teks kosong, atau > 280 karakter -> 400', async () => {
  assert.equal((await app.inject(url('latar9', 'x'))).statusCode, 400);
  assert.equal((await app.inject(url('latar1', '   '))).statusCode, 400);
  assert.equal((await app.inject(url('latar1', 'a'.repeat(281)))).statusCode, 400);
  assert.equal((await app.inject('/api/images/preview')).statusCode, 400);
});

test('daftar template untuk halaman tulis puisi', async () => {
  const r = await app.inject('/api/images/templates');
  assert.deepEqual(r.json().map((t) => t.id), ['latar1', 'latar2', 'latar3']);
});

test('pratinjau cepat setelah pemanasan (< 300 ms, kriteria T2.5)', async () => {
  const durasi = [];
  for (let i = 0; i < 20; i++) {
    const t = performance.now();
    await app.inject(url('latar1', `baris uji nomor ${i}\nhujan mengetuk kaca`));
    durasi.push(performance.now() - t);
  }
  durasi.sort((a, b) => a - b);
  const p95 = durasi[Math.ceil(0.95 * durasi.length) - 1];
  assert.ok(p95 < 300, `p95 ${p95.toFixed(0)} ms`);
});
