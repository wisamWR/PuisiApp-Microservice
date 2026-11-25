import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validasiRegistrasi } from '../src/validasi.js';

const valid = {
  username: 'azka_01',
  email: 'Azka@Example.com',
  password: 'rahasia123',
  display_name: 'Azka',
};

test('input valid lolos dan email dinormalkan ke huruf kecil', () => {
  const v = validasiRegistrasi(valid);
  assert.equal(v.ok, true);
  assert.equal(v.data.email, 'azka@example.com');
  assert.equal(v.data.username, 'azka_01');
});

test('username harus 3 sampai 30 karakter huruf, angka, atau garis bawah', () => {
  assert.equal(validasiRegistrasi({ ...valid, username: 'ab' }).ok, false);
  assert.equal(validasiRegistrasi({ ...valid, username: 'a'.repeat(31) }).ok, false);
  assert.equal(validasiRegistrasi({ ...valid, username: 'ada spasi' }).ok, false);
  assert.equal(validasiRegistrasi({ ...valid, username: 'valid_123' }).ok, true);
});

test('email tidak valid ditolak', () => {
  const v = validasiRegistrasi({ ...valid, email: 'bukan-email' });
  assert.equal(v.ok, false);
  assert.ok(v.errors.email);
});

test('kata sandi minimal 8 karakter', () => {
  const v = validasiRegistrasi({ ...valid, password: '1234567' });
  assert.equal(v.ok, false);
  assert.ok(v.errors.password);
  assert.equal(validasiRegistrasi({ ...valid, password: '12345678' }).ok, true);
});

test('body bukan objek atau kosong ditolak dengan semua galat', () => {
  for (const body of [null, 'teks', [], undefined]) {
    const v = validasiRegistrasi(body);
    assert.equal(v.ok, false);
    assert.ok(v.errors.username && v.errors.email && v.errors.password && v.errors.display_name);
  }
});

test('display_name wajib 1 sampai 50 karakter', () => {
  assert.equal(validasiRegistrasi({ ...valid, display_name: '   ' }).ok, false);
  assert.equal(validasiRegistrasi({ ...valid, display_name: 'x'.repeat(51) }).ok, false);
});
