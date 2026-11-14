// Uji logika halaman Tulis Puisi tanpa browser: node --test src/lib
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buatIdempotencyKey,
  buatPenyimpanDraf,
  drafKosong,
  galatServer,
  kunciDraf,
  pecahBait,
  urlPratinjau,
  uraiKataKunci,
  validasiForm,
} from './puisi.js'

const sah = ['latar1', 'latar2', 'latar3']
const form = (ubah = {}) => ({
  judul: 'Jendela yang Basah',
  isi: 'sore turun\nhujan mengetuk kaca\n\nseperti nama yang tak jadi kupanggil',
  indeksBait: 1,
  template: 'latar2',
  kategori: '',
  kataKunci: '',
  ...ubah,
})

test('pecahBait sama dengan server: baris kosong memisah bait, spasi dirapikan', () => {
  assert.deepEqual(pecahBait('a\nb\n\n  \nc\r\n\r\n\r\nd  '), ['a\nb', 'c', 'd'])
  assert.deepEqual(pecahBait('\n\n'), [])
})

test('form sah menghasilkan body permintaan sesuai kontrak', () => {
  const { galat, body } = validasiForm(form({ kategori: ' Lirik ', kataKunci: 'Hujan, rindu, hujan' }), sah)
  assert.deepEqual(galat, {})
  assert.deepEqual(body, {
    title: 'Jendela yang Basah',
    body: 'sore turun\nhujan mengetuk kaca\n\nseperti nama yang tak jadi kupanggil',
    quote_stanza: 1,
    template_id: 'latar2',
    category: 'Lirik',
    keywords: ['hujan', 'rindu'],
  })
})

test('kategori dan kata kunci kosong tidak ikut dikirim', () => {
  const { body } = validasiForm(form(), sah)
  assert.equal('category' in body, false)
  assert.equal('keywords' in body, false)
})

test('batas panjang sama dengan server (dihitung per karakter, emoji = 1)', () => {
  assert.equal(validasiForm(form({ judul: '🌧'.repeat(150) }), sah).galat.title, undefined)
  assert.match(validasiForm(form({ judul: 'a'.repeat(151) }), sah).galat.title, /150/)
  assert.match(validasiForm(form({ isi: `a\n\n${'b'.repeat(8000)}`, indeksBait: 0 }), sah).galat.body, /8000/)
  const baitPanjang = `pendek\n\n${'k'.repeat(281)}`
  assert.match(validasiForm(form({ isi: baitPanjang, indeksBait: 1 }), sah).galat.quote_stanza, /280/)
})

test('bait kutipan wajib dipilih dan harus ada; template wajib sah', () => {
  assert.ok(validasiForm(form({ indeksBait: null }), sah).galat.quote_stanza)
  assert.ok(validasiForm(form({ indeksBait: 5 }), sah).galat.quote_stanza)
  assert.ok(validasiForm(form({ template: 'latar9' }), sah).galat.template_id)
  assert.ok(validasiForm(form({ judul: '   ' }), sah).galat.title)
  assert.ok(validasiForm(form({ isi: '  \n ' }), sah).galat.body)
})

test('kata kunci: maksimal 10, setiap kata maksimal 40 karakter', () => {
  assert.deepEqual(uraiKataKunci(' A , b,, a '), ['a', 'b'])
  const sebelas = Array.from({ length: 11 }, (_, i) => `k${i}`).join(',')
  assert.ok(validasiForm(form({ kataKunci: sebelas }), sah).galat.keywords)
  assert.ok(validasiForm(form({ kataKunci: 'x'.repeat(41) }), sah).galat.keywords)
})

test('galat 400 dari server dipetakan per field', () => {
  assert.deepEqual(
    galatServer({ rincian: [{ field: 'title', pesan: 'A' }, { field: 'title', pesan: 'B' }, { field: 'body', pesan: 'C' }] }),
    { title: 'A', body: 'C' },
  )
  assert.deepEqual(galatServer(null), {})
})

test('Idempotency-Key unik dan lolos pola server', () => {
  const a = buatIdempotencyKey()
  assert.match(a, /^[A-Za-z0-9_-]{8,64}$/)
  assert.notEqual(a, buatIdempotencyKey())
})

test('urlPratinjau meng-encode teks bait dengan benar', () => {
  assert.equal(urlPratinjau('latar1', 'hujan & kaca\nbaris'), '/api/images/preview?template=latar1&text=hujan+%26+kaca%0Abaris')
  assert.equal(urlPratinjau('latar1', ''), null)
})

test('draf: simpan, muat, hapus; kunci beda untuk puisi baru dan edit', () => {
  const peta = new Map()
  const storage = { getItem: (k) => peta.get(k) ?? null, setItem: (k, v) => peta.set(k, v), removeItem: (k) => peta.delete(k) }
  const draf = buatPenyimpanDraf(storage)
  assert.equal(kunciDraf(), 'puisiapp:draf:baru')
  assert.equal(kunciDraf('p-1'), 'puisiapp:draf:edit:p-1')
  draf.simpan(kunciDraf(), { judul: 'a', idempotencyKey: 'draf-123456789' })
  const muat = draf.muat(kunciDraf())
  assert.equal(muat.judul, 'a')
  assert.equal(muat.idempotencyKey, 'draf-123456789', 'key ikut tersimpan: kirim setelah muat ulang tetap satu puisi')
  assert.ok(muat.disimpanPada)
  draf.hapus(kunciDraf())
  assert.equal(draf.muat(kunciDraf()), null)
})

test('draf rusak atau storage error tidak membuat halaman gagal', () => {
  const rusak = buatPenyimpanDraf({ getItem: () => '{rusak', setItem: () => { throw new Error('kuota') }, removeItem: () => {} })
  assert.equal(rusak.muat('x'), null)
  assert.equal(rusak.simpan('x', {}), false)
  assert.equal(buatPenyimpanDraf(undefined).muat('x'), null)
  assert.equal(drafKosong({ judul: ' ', isi: '', kategori: '', kataKunci: '' }), true)
  assert.equal(drafKosong({ judul: 'a' }), false)
})
