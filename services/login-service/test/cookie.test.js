import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cookieAkses, cookieHapusAkses } from '../src/cookie.js';

test('cookie akses punya httpOnly, Secure, SameSite=Lax, dan masa 15 menit', () => {
  const c = cookieAkses('abc.def.ghi');
  assert.match(c, /^access_token=abc\.def\.ghi;/);
  for (const atribut of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=900']) {
    assert.ok(c.includes(atribut), `kurang ${atribut}`);
  }
});

test('cookie hapus punya Max-Age=0', () => {
  assert.match(cookieHapusAkses(), /Max-Age=0/);
});
