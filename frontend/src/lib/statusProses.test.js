import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sudahFinal, tampilanStatus } from './statusProses.js'

const langkah = (selesai) =>
  ['emotion', 'image', 'similarity'].map((name, i) => ({ name, label: name, done: i < selesai, done_at: null }))

const snap = (o = {}) => ({
  poem_id: 'p', version: 1, status: 'PROCESSING', steps: langkah(1), steps_done: 1, steps_total: 3,
  completed_at: null, publication: null, updated_at: 't', ...o,
})

test('proses berjalan: judul, persen, dan centang per langkah', () => {
  const t = tampilanStatus(snap())
  assert.equal(t.judul, 'Sedang diproses')
  assert.equal(t.persen, 33)
  assert.deepEqual(t.langkah.map((l) => l.done), [true, false, false])
  assert.match(t.keterangan, /setelah pemeriksaan keaslian/)
})

test('revisi puisi terbit: versi lama tetap tampil', () => {
  const t = tampilanStatus(snap({ status: 'REPROCESSING', version: 2, publication: 'PUBLISHED' }))
  assert.equal(t.judul, 'Memproses revisi (versi 2)')
  assert.match(t.keterangan, /Versi sebelumnya tetap tampil/)
})

test('selesai dan terbit: final', () => {
  const s = snap({ status: 'COMPLETED', steps: langkah(3), steps_done: 3, publication: 'PUBLISHED' })
  assert.equal(tampilanStatus(s).persen, 100)
  assert.match(tampilanStatus(s).keterangan, /sudah terbit/)
  assert.ok(sudahFinal(s))
  assert.ok(!sudahFinal({ ...s, publication: null }), 'menunggu keputusan publikasi')
  assert.ok(sudahFinal(snap({ publication: 'DELETED' })))
  assert.equal(tampilanStatus(null), null)
})

test('ditahan: penjelasan moderasi', () => {
  assert.match(tampilanStatus(snap({ status: 'COMPLETED', publication: 'HELD' })).keterangan, /ditinjau moderator/)
})
