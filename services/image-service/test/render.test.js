import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { bungkusBaris, escapeXml, muatTemplate, normalisasiTeks, renderJpeg, svgTeks, tataLetak, UKURAN } from '../src/render.js';

const folder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets/templates');
let templates;
before(async () => { templates = await muatTemplate(folder); });

test('tiga template dimuat dan latarnya dirasterkan untuk dua ukuran', () => {
  assert.deepEqual([...templates.keys()], ['latar1', 'latar2', 'latar3']);
  for (const t of templates.values()) {
    assert.ok(t.latarRaster.get(UKURAN.final).length > 0);
    assert.ok(t.latarRaster.get(UKURAN.pratinjau).length > 0);
  }
});

test('normalisasiTeks: wajib, maks 280 karakter, karakter kontrol dibuang', () => {
  assert.equal(normalisasiTeks(''), null);
  assert.equal(normalisasiTeks('   \n  '), null);
  assert.equal(normalisasiTeks(undefined), null);
  assert.equal(normalisasiTeks('a'.repeat(281)), null);
  assert.equal(normalisasiTeks('🌧'.repeat(280)), '🌧'.repeat(280));
  assert.equal(normalisasiTeks('\r\n baris satu \u0007\r\nbaris dua\n\n\n\n'), 'baris satu\nbaris dua');
});

test('bungkusBaris: per kata, kata kepanjangan dipotong paksa', () => {
  assert.deepEqual(bungkusBaris('satu dua tiga empat', 9), ['satu dua', 'tiga', 'empat']);
  assert.deepEqual(bungkusBaris('abcdefghij', 4), ['abcd', 'efgh', 'ij']);
  assert.deepEqual(bungkusBaris('', 10), ['']);
});

test('tataLetak: teks pendek memakai ukuran maksimum, teks panjang mengecil tapi tetap muat', () => {
  const cfg = templates.get('latar2').teks;
  const pendek = tataLetak('hujan', cfg);
  assert.equal(pendek.ukuran, cfg.ukuranMaks);
  const panjang = tataLetak('kata '.repeat(55).trim(), cfg);
  assert.ok(panjang.ukuran < cfg.ukuranMaks && panjang.ukuran >= cfg.ukuranMin);
  assert.ok(panjang.baris.length * panjang.ukuran * 1.45 <= cfg.kotak.h);
  assert.equal(panjang.terpotong, false);
});

test('teks yang tidak mungkin muat dipotong dengan elipsis, tidak meluber', () => {
  const cfg = { ...templates.get('latar2').teks, kotak: { x: 0, y: 0, w: 300, h: 100 } };
  const h = tataLetak('kata '.repeat(55).trim(), cfg);
  assert.equal(h.terpotong, true);
  assert.ok(h.baris.at(-1).endsWith('…'));
});

test('svgTeks meng-escape XML (teks pengguna tidak bisa menyuntik elemen SVG)', () => {
  const svg = svgTeks(templates.get('latar1'), '<script>x</script> & "kutip"', 540, 'RASA');
  assert.ok(!svg.includes('<script>'));
  for (const potong of ['&lt;script&gt;x&lt;/script&gt;', '&amp;', '&quot;kutip&quot;']) {
    assert.ok(svg.includes(potong), potong);
  }
  assert.equal(escapeXml(`a'b`), 'a&apos;b');
});

test('renderJpeg menghasilkan JPEG dengan ukuran yang diminta', async () => {
  for (const ukuran of [UKURAN.pratinjau, UKURAN.final]) {
    const jpeg = await renderJpeg(templates.get('latar3'), 'hujan mengetuk kaca', ukuran);
    const meta = await sharp(jpeg).metadata();
    assert.equal(meta.format, 'jpeg');
    assert.equal(meta.width, ukuran);
    assert.equal(meta.height, ukuran);
  }
});
