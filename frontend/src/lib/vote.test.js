// Uji logika tombol vote tanpa browser: node --test src/lib
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatSkor, nilaiBerikutnya, pesanPenolakan, terapkanOptimistik } from './vote.js'

test('menekan tombol yang sama menarik suara', () => {
  assert.equal(nilaiBerikutnya(0, 1), 1)
  assert.equal(nilaiBerikutnya(1, 1), 0)
  assert.equal(nilaiBerikutnya(1, -1), -1)
  assert.equal(nilaiBerikutnya(-1, -1), 0)
})

test('tampilan optimistik menyesuaikan skor dan jumlah suara', () => {
  const awal = { nilai: 0, skor: 5, jumlah_suara: 9 }
  const naik = terapkanOptimistik(awal, 1)
  assert.deepEqual([naik.nilai, naik.skor, naik.jumlah_suara], [1, 6, 10])
  const turun = terapkanOptimistik(naik, -1)
  assert.deepEqual([turun.skor, turun.jumlah_suara], [4, 10])
  const tarik = terapkanOptimistik(turun, 0)
  assert.deepEqual([tarik.skor, tarik.jumlah_suara], [5, 9])
})

test('pesan penolakan dari server', () => {
  assert.match(pesanPenolakan({ status: 403 }), /puisimu sendiri/)
  assert.match(pesanPenolakan({ status: 409 }), /belum terbit/)
  assert.match(pesanPenolakan({ status: 429, retryAfter: 12 }), /12 detik/)
  assert.equal(pesanPenolakan({ status: 500, message: 'x' }), 'x')
})

test('format skor', () => {
  assert.equal(formatSkor(12), '+12')
  assert.equal(formatSkor(0), '0')
  assert.equal(formatSkor(-3), '-3')
})
