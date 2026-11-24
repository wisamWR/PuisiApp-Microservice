import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buatPengumpul, gabungkan } from '../src/batch.js';
import { bandingkan } from '../src/rekonsiliasi.js';
import { buatJam, logSenyap, pesan, POEM, vote } from './bantu.js';

function siapkan({ maks = 3, gagal = 0 } = {}) {
  const jam = buatJam();
  const catat = { simpan: [], ack: [], kembali: [], dlq: [] };
  let sisaGagal = gagal;
  const p = buatPengumpul({
    maks,
    jedaMs: 1000,
    log: logSenyap,
    jam,
    jedaGagalMs: () => 0,
    simpan: async (baris) => {
      if (sisaGagal-- > 0) throw new Error('db mati');
      catat.simpan.push(baris);
    },
    ack: (m) => catat.ack.push(m),
    kembalikan: (m) => catat.kembali.push(m),
    keDlq: (m) => catat.dlq.push(m),
  });
  return { p, jam, catat };
}

test('gabungkan: satu baris per (puisi, pengguna) dengan sequence terbesar', () => {
  const baris = gabungkan([
    vote({ user: 'u1', nilai: 1, seq: 1 }),
    vote({ user: 'u1', nilai: -1, lama: 1, seq: 3 }),
    vote({ user: 'u1', nilai: 1, seq: 2 }), // tiba terlambat
    vote({ user: 'u2', nilai: 1, seq: 4 }),
    vote({ user: 'u2', nilai: 1, seq: 4 }), // duplikat
  ]);
  assert.deepEqual(
    baris.map((b) => [b.user_id, b.value, b.sequence]),
    [['u1', -1, 3], ['u2', 1, 4]],
  );
});

test('batch ditulis saat penuh, ack hanya setelah simpan berhasil', async () => {
  const { p, catat } = siapkan({ maks: 3 });
  const m = [1, 2, 3].map((seq) => pesan(vote({ user: `u${seq}`, seq })));
  p.tambah(m[0]);
  p.tambah(m[1]);
  assert.equal(catat.simpan.length, 0);
  assert.equal(catat.ack.length, 0, 'belum ack sebelum commit');
  p.tambah(m[2]);
  await p.selesai();
  assert.equal(catat.simpan.length, 1);
  assert.equal(catat.simpan[0].length, 3);
  assert.deepEqual(catat.ack, m);
});

test('batch ditulis setelah jeda walau belum penuh', async () => {
  const { p, jam, catat } = siapkan({ maks: 200 });
  p.tambah(pesan(vote()));
  assert.equal(jam.jumlah(), 1);
  await jam.majukan();
  await p.selesai();
  assert.equal(catat.simpan.length, 1);
  assert.equal(catat.ack.length, 1);
});

test('simpan gagal -> semua pesan dikembalikan ke queue, tidak ada ack', async () => {
  const { p, catat } = siapkan({ maks: 2, gagal: 1 });
  const m = [pesan(vote({ user: 'a', seq: 1 })), pesan(vote({ user: 'b', seq: 2 }))];
  m.forEach((x) => p.tambah(x));
  await p.selesai();
  assert.equal(catat.ack.length, 0);
  assert.deepEqual(catat.kembali, m);

  // Pengiriman ulang dari broker berhasil disimpan.
  m.forEach((x) => p.tambah(x));
  await p.selesai();
  assert.deepEqual(catat.ack, m);
});

test('pesan tidak valid langsung ke DLQ tanpa menahan batch', async () => {
  const { p, catat } = siapkan({ maks: 2 });
  const rusak = [pesan('bukan json'), pesan({ ...vote(), event_type: 'poem.submitted' }), pesan({ ...vote(), payload: { poem_id: POEM } })];
  rusak.forEach((x) => p.tambah(x));
  assert.deepEqual(catat.dlq, rusak);
  assert.equal(catat.simpan.length, 0);
});

test('bandingkan status rekonsiliasi', () => {
  const db = { up: 3, down: 1, seq: 10 };
  assert.equal(bandingkan(db, { ada: true, up: 3, down: 1, seq: 10 }), 'cocok');
  assert.equal(bandingkan(db, { ada: true, up: 4, down: 1, seq: 11 }), 'belum_persist');
  assert.equal(bandingkan(db, { ada: false, up: 0, down: 0, seq: 0 }), 'kosong');
  assert.equal(bandingkan(db, { ada: true, up: 2, down: 1, seq: 10 }), 'selisih');
  assert.equal(bandingkan(db, { ada: true, up: 3, down: 1, seq: 9 }), 'selisih');
});
