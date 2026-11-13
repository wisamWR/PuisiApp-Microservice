import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cookieAkses, cookieRefresh } from '../src/cookie.js';

test('cookie akses punya httpOnly, Secure, SameSite=Lax, Path=/, dan masa 15 menit', () => {
  const c = cookieAkses('abc.def.ghi');
  assert.match(c, /^access_token=abc\.def\.ghi;/);
  for (const atribut of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=900']) {
    assert.ok(c.includes(atribut), `kurang ${atribut}`);
  }
});

test('cookie refresh hanya untuk /api/auth dan berumur 7 hari', () => {
  const c = cookieRefresh('r-token');
  assert.match(c, /^refresh_token=r-token;/);
  for (const atribut of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/api/auth', 'Max-Age=604800']) {
    assert.ok(c.includes(atribut), `kurang ${atribut}`);
  }
});
