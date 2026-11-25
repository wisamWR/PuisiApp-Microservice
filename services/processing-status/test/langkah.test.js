import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buatSnapshot, langkahAktif, snapshotFinal, versiDari, SEMUA_LANGKAH } from '../src/langkah.js';
import { e } from './bantu.js';

const ID = '0b7d6f0e-4a8b-4a52-9d0b-3f4f0e9b2a10';

test('langkah aktif: bawaan semua, bisa dipilih lewat env, nama salah ditolak', () => {
  assert.deepEqual(langkahAktif(undefined), SEMUA_LANGKAH);
  assert.deepEqual(langkahAktif('similarity, emotion'), ['emotion', 'similarity'], 'urutan mengikuti urutan baku');
  assert.throws(() => langkahAktif('emotion,ajaib'), /ajaib/);
});

test('versi: payload.version, last_version untuk poem.deleted, selain itu aggregate_version', () => {
  assert.equal(versiDari(e.gambar(ID, 3)), 3);
  assert.equal(versiDari(e.dihapus(ID, 2)), 2);
  assert.equal(versiDari(e.tema(ID, 4)), 4);
});

test('snapshot: langkah tercentang, status, dan final', () => {
  const langkah = ['emotion', 'image'];
  const awal = buatSnapshot({ poemId: ID, puisi: { versi: '1' }, versi: {}, langkah });
  assert.equal(awal.status, 'PROCESSING');
  assert.deepEqual(awal.steps.map((s) => s.done), [false, false]);
  assert.equal(awal.steps[1].label, 'Gambar kutipan');

  const setengah = buatSnapshot({ poemId: ID, puisi: { versi: '2' }, versi: { 'l:image': 't1' }, langkah });
  assert.equal(setengah.status, 'REPROCESSING');
  assert.equal(setengah.steps_done, 1);
  assert.equal(setengah.steps[1].done_at, 't1');

  const lengkap = buatSnapshot({
    poemId: ID, puisi: { versi: '1', publikasi: 'PUBLISHED' }, versi: { 'l:image': 't1', 'l:emotion': 't2', selesai_at: 't2' }, langkah,
  });
  assert.equal(lengkap.status, 'COMPLETED');
  assert.equal(lengkap.completed_at, 't2');
  assert.ok(snapshotFinal(lengkap));
  assert.ok(!snapshotFinal({ ...lengkap, publication: null }), 'menunggu keputusan publikasi');
  assert.ok(snapshotFinal({ ...setengah, publication: 'DELETED' }));
});
