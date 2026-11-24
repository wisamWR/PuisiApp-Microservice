import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bisaDiedit, jumlahSemua, rapikanAlasan, teksBadge, waktuRelatif, STATUS_PUISI, FILTER_STATUS } from './puisiSaya.js'

test('setiap status filter punya label', () => {
  for (const s of FILTER_STATUS) assert.ok(STATUS_PUISI[s].label, s)
})

test('puisi ditahan atau disembunyikan tidak bisa diedit penulis', () => {
  assert.equal(bisaDiedit('PUBLISHED'), true)
  assert.equal(bisaDiedit('PROCESSING'), true)
  assert.equal(bisaDiedit('HELD'), false)
  assert.equal(bisaDiedit('HIDDEN'), false)
})

test('alasan dan jumlah', () => {
  assert.equal(rapikanAlasan('Skor kemiripan 0.91 dengan puisi x'), 'Skor kemiripan 0,91 dengan puisi x')
  assert.equal(rapikanAlasan(null), '')
  assert.equal(jumlahSemua({ PROCESSING: 1, PUBLISHED: 3, HELD: 1, HIDDEN: 0, REPROCESSING: 0 }), 5)
})

test('waktu relatif', () => {
  const kini = new Date('2026-12-05T10:00:00Z')
  assert.equal(waktuRelatif('2026-12-05T09:59:40Z', kini), 'baru saja')
  assert.equal(waktuRelatif('2026-12-05T09:45:00Z', kini), '15 menit lalu')
  assert.equal(waktuRelatif('2026-12-05T07:00:00Z', kini), '3 jam lalu')
  assert.equal(waktuRelatif('2026-12-03T10:00:00Z', kini), '2 hari lalu')
})

test('badge', () => {
  assert.equal(teksBadge(0), '')
  assert.equal(teksBadge(7), '7')
  assert.equal(teksBadge(150), '99+')
})
