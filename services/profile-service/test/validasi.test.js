import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bersihkanTeks, validasiProfil, MAKS_BIO, MAKS_NAMA_TAMPIL } from '../src/validasi.js';

test('tag HTML dibuang dan spasi dirapikan', () => {
  assert.equal(bersihkanTeks('<b>Azka</b>   <script>x</script>'), 'Azka x');
  assert.equal(bersihkanTeks('  halo  dunia  '), 'halo dunia');
});

test('nama tampil 1 sampai 50 karakter setelah dibersihkan', () => {
  assert.equal(validasiProfil({ display_name: 'Azka', bio: '' }).ok, true);
  assert.equal(validasiProfil({ display_name: '<b></b>', bio: '' }).ok, false);
  assert.equal(validasiProfil({ display_name: 'x'.repeat(MAKS_NAMA_TAMPIL + 1), bio: '' }).ok, false);
});

test('bio maksimal 300 karakter dan boleh kosong', () => {
  assert.equal(validasiProfil({ display_name: 'A', bio: '' }).ok, true);
  assert.equal(validasiProfil({ display_name: 'A', bio: 'x'.repeat(MAKS_BIO) }).ok, true);
  const v = validasiProfil({ display_name: 'A', bio: 'x'.repeat(MAKS_BIO + 1) });
  assert.equal(v.ok, false);
  assert.ok(v.errors.bio);
});

test('tag HTML di bio tidak dihitung sebagai karakter', () => {
  const bio = '<i>' + 'x'.repeat(MAKS_BIO) + '</i>';
  const v = validasiProfil({ display_name: 'A', bio });
  assert.equal(v.ok, true);
  assert.equal(v.data.bio.length, MAKS_BIO);
});

test('body tidak valid ditolak tanpa melempar galat', () => {
  for (const body of [null, 'teks', [], undefined]) {
    assert.equal(validasiProfil(body).ok, false);
  }
});
