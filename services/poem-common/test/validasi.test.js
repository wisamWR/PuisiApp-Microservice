import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validasiPengajuan, buangHtml, pecahBait, normalisasiIsi, hashPengajuan } from '../src/validasi.js';

const opsi = { templateSah: ['latar1', 'latar2', 'latar3'] };
const sah = () => ({
  title: 'Jendela yang Basah',
  body: 'sore turun tanpa permisi\nhujan mengetuk kaca\n\nseperti nama yang tak jadi kupanggil',
  quote_stanza: 1,
  template_id: 'latar2',
});
const fieldGalat = (h) => h.rincian.map((r) => r.field);

test('pengajuan sah lolos dan bait kutipan diambil dari indeks', () => {
  const h = validasiPengajuan(sah(), opsi);
  assert.equal(h.ok, true);
  assert.equal(h.data.judul, 'Jendela yang Basah');
  assert.equal(h.data.indeksBait, 1);
  assert.equal(h.data.baitKutipan, 'seperti nama yang tak jadi kupanggil');
  assert.equal(h.data.kategori, null);
  assert.deepEqual(h.data.kataKunci, []);
});

test('judul: wajib, maksimal 150 karakter, satu baris', () => {
  assert.deepEqual(fieldGalat(validasiPengajuan({ ...sah(), title: '   ' }, opsi)), ['title']);
  assert.equal(validasiPengajuan({ ...sah(), title: 'a'.repeat(150) }, opsi).ok, true);
  assert.deepEqual(fieldGalat(validasiPengajuan({ ...sah(), title: 'a'.repeat(151) }, opsi)), ['title']);
  assert.equal(validasiPengajuan({ ...sah(), title: 'Satu\n  dua\tTiga ' }, opsi).data.judul, 'Satu dua Tiga');
});

test('panjang dihitung per karakter, bukan per unit UTF-16 (emoji)', () => {
  assert.equal(validasiPengajuan({ ...sah(), title: '🌧'.repeat(150) }, opsi).ok, true);
});

test('isi: wajib, maksimal 8.000 karakter', () => {
  assert.deepEqual(fieldGalat(validasiPengajuan({ ...sah(), body: '\n\n  \n' }, opsi)), ['body', 'quote_stanza'].slice(0, 1));
  const panjang = `${'a'.repeat(100)}\n\n${'b'.repeat(7898)}`; // 8.000 karakter
  assert.equal(validasiPengajuan({ ...sah(), body: panjang, quote_stanza: 0 }, opsi).ok, true);
  const lebih = `${panjang}x`;
  assert.ok(fieldGalat(validasiPengajuan({ ...sah(), body: lebih, quote_stanza: 0 }, opsi)).includes('body'));
});

test('bait kutipan: wajib, harus ada, maksimal 280 karakter', () => {
  assert.deepEqual(fieldGalat(validasiPengajuan({ ...sah(), quote_stanza: undefined }, opsi)), ['quote_stanza']);
  assert.deepEqual(fieldGalat(validasiPengajuan({ ...sah(), quote_stanza: -1 }, opsi)), ['quote_stanza']);
  assert.deepEqual(fieldGalat(validasiPengajuan({ ...sah(), quote_stanza: 1.5 }, opsi)), ['quote_stanza']);
  const tidakAda = validasiPengajuan({ ...sah(), quote_stanza: 2 }, opsi);
  assert.match(tidakAda.rincian[0].pesan, /hanya punya 2 bait/);
  const baitPanjang = `pendek\n\n${'k'.repeat(281)}`;
  assert.deepEqual(fieldGalat(validasiPengajuan({ ...sah(), body: baitPanjang, quote_stanza: 1 }, opsi)), ['quote_stanza']);
  assert.equal(validasiPengajuan({ ...sah(), body: baitPanjang, quote_stanza: 0 }, opsi).ok, true);
});

test('template harus dari daftar sah', () => {
  assert.deepEqual(fieldGalat(validasiPengajuan({ ...sah(), template_id: 'latar9' }, opsi)), ['template_id']);
  assert.deepEqual(fieldGalat(validasiPengajuan({ ...sah(), template_id: undefined }, opsi)), ['template_id']);
});

test('tag skrip dan HTML dibuang, isi <script> ikut hilang', () => {
  const h = validasiPengajuan(
    {
      ...sah(),
      title: '<b>Jendela</b><script>alert(1)</script> yang <img src=x onerror=alert(2)>Basah',
      body: 'sore <i>turun</i>\n<script>fetch("//jahat")</script>hujan &amp; kaca\n\n<style>p{}</style>bait dua',
    },
    opsi,
  );
  assert.equal(h.ok, true);
  assert.equal(h.data.judul, 'Jendela yang Basah');
  assert.equal(h.data.isi, 'sore turun\nhujan & kaca\n\nbait dua');
  assert.doesNotMatch(JSON.stringify(h.data), /script|alert|onerror|<|>/);
});

test('HTML yang di-escape tidak lolos setelah dikembalikan menjadi teks', () => {
  assert.equal(buangHtml('&lt;script&gt;alert(1)&lt;/script&gt;aman'), 'aman');
  assert.equal(buangHtml('a < b dan c > d'), 'a < b dan c > d');
  assert.equal(buangHtml('kopi & teh'), 'kopi & teh');
});

test('normalisasi isi: CRLF, spasi akhir baris, baris kosong berlebih', () => {
  assert.equal(normalisasiIsi('\r\n baris satu  \r\nbaris dua\r\n\r\n\r\n\r\nbait dua \n\n'), ' baris satu\nbaris dua\n\nbait dua');
  assert.deepEqual(pecahBait('a\nb\n\n  \nc'), ['a\nb', 'c']);
});

test('kategori dan kata kunci manual opsional, dibersihkan dan unik', () => {
  const h = validasiPengajuan({ ...sah(), category: ' Lirik ', keywords: ['Hujan', 'hujan', ' rindu ', ''] }, opsi);
  assert.equal(h.data.kategori, 'Lirik');
  assert.deepEqual(h.data.kataKunci, ['hujan', 'rindu']);
  assert.deepEqual(fieldGalat(validasiPengajuan({ ...sah(), keywords: 'hujan' }, opsi)), ['keywords']);
  assert.deepEqual(
    fieldGalat(validasiPengajuan({ ...sah(), keywords: Array.from({ length: 11 }, (_, i) => `k${i}`) }, opsi)),
    ['keywords'],
  );
});

test('field tak dikenal dan body bukan objek ditolak', () => {
  assert.deepEqual(fieldGalat(validasiPengajuan({ ...sah(), author_id: 'palsu' }, opsi)), ['author_id']);
  assert.equal(validasiPengajuan(null, opsi).ok, false);
  assert.equal(validasiPengajuan([sah()], opsi).ok, false);
});

test('hash sama untuk isi yang sama setelah dibersihkan, beda bila isi beda', () => {
  const a = validasiPengajuan(sah(), opsi).data;
  const b = validasiPengajuan({ ...sah(), body: `${sah().body}   \r\n` }, opsi).data;
  const c = validasiPengajuan({ ...sah(), title: 'Lain' }, opsi).data;
  assert.equal(hashPengajuan(a), hashPengajuan(b));
  assert.notEqual(hashPengajuan(a), hashPengajuan(c));
});
