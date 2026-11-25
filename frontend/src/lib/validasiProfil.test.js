import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bersihkanTeks, validasiProfil, MAKS_BIO, MAKS_NAMA_TAMPIL } from './validasiProfil.js'

test('tag HTML dibuang dan spasi dirapikan', () => {
  assert.equal(bersihkanTeks('<b>Azka</b>   <i>Z</i>'), 'Azka Z')
})

test('nama tampil wajib 1 sampai 50 karakter setelah dibersihkan', () => {
  assert.equal(validasiProfil({ display_name: 'Azka', bio: '' }).ok, true)
  assert.equal(validasiProfil({ display_name: '<b></b>', bio: '' }).ok, false)
  assert.equal(validasiProfil({ display_name: 'x'.repeat(MAKS_NAMA_TAMPIL + 1), bio: '' }).ok, false)
})

test('bio maksimal 300 karakter, tag tidak dihitung', () => {
  assert.equal(validasiProfil({ display_name: 'A', bio: 'x'.repeat(MAKS_BIO) }).ok, true)
  assert.equal(validasiProfil({ display_name: 'A', bio: 'x'.repeat(MAKS_BIO + 1) }).ok, false)
  assert.equal(validasiProfil({ display_name: 'A', bio: `<i>${'x'.repeat(MAKS_BIO)}</i>` }).ok, true)
})
