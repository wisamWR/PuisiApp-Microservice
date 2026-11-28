import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buatPoolBaca, galatKetersediaan } from '../src/pool-baca.js';

function pool(nama, gagal = null) {
  const p = { panggilan: 0 };
  p.query = async () => {
    p.panggilan++;
    if (gagal) throw gagal;
    return { rows: [{ dari: nama }] };
  };
  return p;
}
const galat = (code, message = 'x') => Object.assign(new Error(message), code ? { code } : {});

test('galatKetersediaan membedakan galat koneksi dari galat SQL', () => {
  assert.equal(galatKetersediaan(galat('ECONNREFUSED')), true);
  assert.equal(galatKetersediaan(galat(undefined, 'Query read timeout')), true);
  assert.equal(galatKetersediaan(galat('08006')), true);
  assert.equal(galatKetersediaan(galat('57P01')), true);
  assert.equal(galatKetersediaan(galat('40001')), true);
  assert.equal(galatKetersediaan(galat('42P01')), false);
  assert.equal(galatKetersediaan(galat('22P02')), false);
});

test('tanpa replika semua baca ke primary', async () => {
  const primary = pool('primary');
  const baca = buatPoolBaca({ primary, replika: null });
  assert.equal((await baca.query('SELECT 1')).rows[0].dari, 'primary');
  assert.equal(baca.statusReplika(), 'tidak_dipakai');
});

test('baca ke replika bila sehat', async () => {
  const primary = pool('primary');
  const replika = pool('replika');
  const baca = buatPoolBaca({ primary, replika });
  assert.equal((await baca.query('SELECT 1')).rows[0].dari, 'replika');
  assert.equal(primary.panggilan, 0);
});

test('replika mati: dialihkan ke primary lalu dilewati selama jeda', async () => {
  let t = 1000;
  const primary = pool('primary');
  const replika = pool('replika', galat('ECONNREFUSED'));
  const baca = buatPoolBaca({ primary, replika, jedaMs: 500, sekarang: () => t, log: { warn() {}, info() {} } });

  assert.equal((await baca.query('SELECT 1')).rows[0].dari, 'primary');
  assert.equal(baca.statusReplika(), 'dilewati');
  await baca.query('SELECT 1');
  assert.equal(replika.panggilan, 1, 'replika tidak dicoba lagi selama jeda');

  t += 600;
  assert.equal(baca.statusReplika(), 'aktif');
  await baca.query('SELECT 1');
  assert.equal(replika.panggilan, 2, 'replika dicoba lagi setelah jeda');
});

test('galat SQL dari replika diteruskan, tidak dialihkan', async () => {
  const primary = pool('primary');
  const replika = pool('replika', galat('42P01'));
  const baca = buatPoolBaca({ primary, replika });
  await assert.rejects(baca.query('SELECT * FROM tidak_ada'), { code: '42P01' });
  assert.equal(primary.panggilan, 0);
  assert.equal(baca.statusReplika(), 'aktif');
});
