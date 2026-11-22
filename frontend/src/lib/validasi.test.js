import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validasiMasuk, validasiRegistrasi } from './validasi.js'

const valid = {
  username: 'azka_01',
  email: 'Azka@Example.com',
  display_name: 'Azka',
  password: 'rahasia123',
  confirm: 'rahasia123',
}

test('form registrasi valid lolos dan email dinormalkan', () => {
  const v = validasiRegistrasi(valid)
  assert.equal(v.ok, true)
  assert.equal(v.data.email, 'azka@example.com')
  assert.equal(v.data.username, 'azka_01')
  assert.equal(v.data.confirm, undefined)
})

test('username harus 3 sampai 30 karakter dengan karakter yang diizinkan', () => {
  assert.equal(validasiRegistrasi({ ...valid, username: 'ab' }).ok, false)
  assert.equal(validasiRegistrasi({ ...valid, username: 'a'.repeat(31) }).ok, false)
  assert.equal(validasiRegistrasi({ ...valid, username: 'ada spasi' }).ok, false)
  assert.equal(validasiRegistrasi({ ...valid, username: 'valid_123' }).ok, true)
})

test('konfirmasi kata sandi harus sama', () => {
  const v = validasiRegistrasi({ ...valid, confirm: 'lain12345' })
  assert.equal(v.ok, false)
  assert.ok(v.errors.confirm)
})

test('kata sandi minimal 8 karakter dan email harus valid', () => {
  const v = validasiRegistrasi({ ...valid, password: '1234567', confirm: '1234567', email: 'bukan-email' })
  assert.ok(v.errors.password)
  assert.ok(v.errors.email)
})

test('nama tampil wajib 1 sampai 50 karakter', () => {
  assert.equal(validasiRegistrasi({ ...valid, display_name: '   ' }).ok, false)
  assert.equal(validasiRegistrasi({ ...valid, display_name: 'x'.repeat(51) }).ok, false)
})

test('form masuk wajib username dan kata sandi', () => {
  assert.equal(validasiMasuk({ username: '', password: '' }).ok, false)
  assert.equal(validasiMasuk({ username: 'azka', password: 'x' }).ok, true)
})
