import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, exportPKCS8, exportSPKI } from 'jose';
import { buatPenerbitToken } from '../src/token.js';

async function kunci() {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  return { privateKeyPem: await exportPKCS8(privateKey), publicKeyPem: await exportSPKI(publicKey) };
}
const cfg = { issuer: 'puisiapp-auth', audience: 'puisiapp-web' };

test('token yang diterbitkan bisa diverifikasi dan membawa klaim sub, username, role', async () => {
  const k = await kunci();
  const p = await buatPenerbitToken({ ...k, ...cfg });
  const token = await p.sign({ sub: 'acc-1', username: 'azka_01', role: 'writer' });
  const klaim = await p.verify(token);
  assert.deepEqual(klaim, { sub: 'acc-1', username: 'azka_01', role: 'writer' });
});

test('token kedaluwarsa ditolak (401 di gateway)', async () => {
  const k = await kunci();
  const p = await buatPenerbitToken({ ...k, ...cfg, masaBerlaku: '1s' });
  const token = await p.sign({ sub: 'acc-1', username: 'azka_01', role: 'writer' });
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(await p.verify(token), null);
});

test('token yang ditandatangani kunci lain ditolak', async () => {
  const a = await kunci();
  const b = await kunci();
  const token = await (await buatPenerbitToken({ ...a, ...cfg })).sign({ sub: 'x', username: 'x', role: 'writer' });
  assert.equal(await (await buatPenerbitToken({ ...b, ...cfg })).verify(token), null);
});

test('audience atau issuer berbeda ditolak', async () => {
  const k = await kunci();
  const token = await (await buatPenerbitToken({ ...k, ...cfg })).sign({ sub: 'x', username: 'x', role: 'writer' });
  assert.equal(await (await buatPenerbitToken({ ...k, issuer: 'lain', audience: 'puisiapp-web' })).verify(token), null);
  assert.equal(await (await buatPenerbitToken({ ...k, issuer: 'puisiapp-auth', audience: 'lain' })).verify(token), null);
});

test('token rusak atau kosong ditolak tanpa melempar galat', async () => {
  const k = await kunci();
  const p = await buatPenerbitToken({ ...k, ...cfg });
  assert.equal(await p.verify('bukan.token.sama.sekali'), null);
  assert.equal(await p.verify(''), null);
});

test('role di luar daftar tidak bisa diterbitkan', async () => {
  const k = await kunci();
  const p = await buatPenerbitToken({ ...k, ...cfg });
  await assert.rejects(() => p.sign({ sub: 'x', username: 'x', role: 'superuser' }), /role tidak dikenal/);
});
