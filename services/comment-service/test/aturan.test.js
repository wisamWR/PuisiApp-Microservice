import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bersihkanHtml, validasiKomentar, bolehHapus, apakahUuid } from '../src/aturan.js';

test('apakahUuid hanya menerima UUID', () => {
  assert.equal(apakahUuid('45ae4c8e-38e9-4086-9e01-e72667a53ba0'), true);
  assert.equal(apakahUuid('undefined'), false);
  assert.equal(apakahUuid('x'), false);
  assert.equal(apakahUuid(undefined), false);
});

test('bersihkanHtml membuang tag, script, dan style', () => {
  assert.equal(bersihkanHtml('<b>Indah</b> sekali<script>alert(1)</script>'), 'Indah sekali');
  assert.equal(bersihkanHtml('<style>p{}</style><p>bait</p>'), 'bait');
  assert.equal(bersihkanHtml('  biasa  '), 'biasa');
});

test('validasiKomentar menerima 1 sampai 1000 karakter', () => {
  assert.deepEqual(validasiKomentar('halo'), { ok: true, content: 'halo' });
  assert.equal(validasiKomentar('x'.repeat(1000)).ok, true);
  assert.equal(validasiKomentar('x'.repeat(1001)).ok, false);
});

test('validasiKomentar menolak isi kosong, hanya HTML, atau bukan teks', () => {
  assert.equal(validasiKomentar('').ok, false);
  assert.equal(validasiKomentar('   ').ok, false);
  assert.equal(validasiKomentar('<script>x</script>').ok, false);
  assert.equal(validasiKomentar(undefined).ok, false);
  assert.equal(validasiKomentar(42).ok, false);
});

test('bolehHapus: penulis, moderator, dan admin boleh; pengguna lain tidak', () => {
  assert.equal(bolehHapus('u1', 'u1', 'reader'), true);
  assert.equal(bolehHapus('u1', 'u2', 'moderator'), true);
  assert.equal(bolehHapus('u1', 'u2', 'admin'), true);
  assert.equal(bolehHapus('u1', 'u2', 'reader'), false);
  assert.equal(bolehHapus('u1', 'u2', 'writer'), false);
  assert.equal(bolehHapus('u1', undefined, 'admin'), false);
});
