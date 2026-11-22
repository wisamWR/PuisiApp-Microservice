import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statusPenundaan, setelahGagal, MAKS_GAGAL, jendelaMs } from '../src/throttle.js';

const mulai = new Date('2026-11-13T10:00:00Z');
const menit = (n) => new Date(mulai.getTime() + n * 60_000);

test('tanpa riwayat tidak ada penundaan', () => {
  assert.deepEqual(statusPenundaan(null, mulai), { tertunda: false, tungguDetik: 0 });
});

test('4 kegagalan belum menunda, kegagalan ke-5 menunda', () => {
  let baris = null;
  for (let i = 0; i < 4; i++) baris = setelahGagal(baris, mulai);
  assert.equal(statusPenundaan(baris, mulai).tertunda, false);
  baris = setelahGagal(baris, mulai);
  assert.equal(baris.gagal, MAKS_GAGAL);
  const t = statusPenundaan(baris, menit(1));
  assert.equal(t.tertunda, true);
  assert.equal(t.tungguDetik, 14 * 60);
});

test('penundaan berakhir setelah 15 menit', () => {
  let baris = null;
  for (let i = 0; i < 5; i++) baris = setelahGagal(baris, mulai);
  assert.equal(statusPenundaan(baris, menit(15)).tertunda, false);
});

test('kegagalan di luar jendela memulai jendela baru dari nol', () => {
  let baris = null;
  for (let i = 0; i < 4; i++) baris = setelahGagal(baris, mulai);
  const baru = setelahGagal(baris, menit(16));
  assert.equal(baru.gagal, 1);
  assert.equal(baru.jendela_mulai.getTime(), menit(16).getTime());
});

test('jendela bisa diperpendek lewat LOGIN_JENDELA_DETIK untuk uji', () => {
  const awal = process.env.LOGIN_JENDELA_DETIK;
  process.env.LOGIN_JENDELA_DETIK = '2';
  try {
    assert.equal(jendelaMs(), 2000);
  } finally {
    if (awal === undefined) delete process.env.LOGIN_JENDELA_DETIK;
    else process.env.LOGIN_JENDELA_DETIK = awal;
  }
  assert.equal(jendelaMs(), 900_000);
});
