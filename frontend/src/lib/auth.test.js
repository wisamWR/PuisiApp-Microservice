import { test } from 'node:test'
import assert from 'node:assert/strict'
import { penggunaDariProfil } from './auth.js'

test('profil lengkap menjadi pengguna dengan role dari respons', () => {
  assert.deepEqual(penggunaDariProfil({ id: 'x', username: 'ana', display_name: 'Ana', role: 'admin' }), {
    id: 'x',
    username: 'ana',
    role: 'admin',
  })
})

test('role kosong dianggap writer', () => {
  assert.deepEqual(penggunaDariProfil({ username: 'ana' }), { id: null, username: 'ana', role: 'writer' })
})

test('respons tanpa username tidak dianggap masuk', () => {
  assert.equal(penggunaDariProfil(null), null)
  assert.equal(penggunaDariProfil({}), null)
  assert.equal(penggunaDariProfil({ username: '' }), null)
})
