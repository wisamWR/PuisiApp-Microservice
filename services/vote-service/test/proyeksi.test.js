import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buatEvent } from '@puisiapp/events';
import { proyeksikan } from '../src/proyeksi.js';
import { buatTokoTiruan, PENULIS, POEM } from './bantu.js';

const ev = (type, payload, waktu, aggregate = POEM) =>
  buatEvent(type, aggregate, 1, payload, { occurredAt: new Date(waktu), producer: 'uji' });

test('status hanya ditimpa event yang lebih baru; pemilik dari poem.submitted', async () => {
  const toko = buatTokoTiruan();
  // poem.published tiba lebih dulu daripada poem.submitted (exchange berbeda).
  await proyeksikan(toko, ev('poem.published', { published_at: '2026-11-23T10:05:00Z' }, '2026-11-23T10:05:00Z'));
  await proyeksikan(toko, ev('poem.submitted', { author_id: PENULIS }, '2026-11-23T10:00:00Z'));
  assert.deepEqual(toko._meta.get(POEM), { owner: PENULIS, status: 'PUBLISHED', status_ms: Date.parse('2026-11-23T10:05:00Z') });

  await proyeksikan(toko, ev('poem.hidden', { reason: 'x', hidden_at: '2026-11-23T11:00:00Z' }, '2026-11-23T11:00:00Z'));
  assert.equal(toko._meta.get(POEM).status, 'HIDDEN');
});

test('poem.deleted final: event lama yang tiba belakangan tidak menghidupkan puisi', async () => {
  const toko = buatTokoTiruan();
  await proyeksikan(toko, ev('poem.deleted', { author_id: PENULIS }, '2026-11-23T09:00:00Z'));
  await proyeksikan(toko, ev('poem.published', { published_at: '2026-11-23T12:00:00Z' }, '2026-11-23T12:00:00Z'));
  assert.equal(toko._meta.get(POEM).status, 'DELETED');
});

test('event duplikat aman diproses ulang', async () => {
  const toko = buatTokoTiruan();
  const e = ev('poem.submitted', { author_id: PENULIS }, '2026-11-23T10:00:00Z');
  await proyeksikan(toko, e);
  await proyeksikan(toko, e);
  assert.equal(toko._meta.get(POEM).status, 'SUBMITTED');
});

test('user.registered menandai akun baru hanya bila umurnya < 24 jam', async () => {
  const toko = buatTokoTiruan();
  await proyeksikan(toko, ev('user.registered', { username: 'a', email: 'a@b.c' }, new Date(Date.now() - 3_600_000), 'akun-baru'));
  await proyeksikan(toko, ev('user.registered', { username: 'b', email: 'b@b.c' }, new Date(Date.now() - 2 * 86_400_000), 'akun-lama'));
  assert.equal(await toko.akunBaru('akun-baru'), true);
  assert.equal(await toko.akunBaru('akun-lama'), false);
});

test('poem_id bukan UUID -> GalatPermanen (ke DLQ)', async () => {
  const toko = buatTokoTiruan();
  await assert.rejects(proyeksikan(toko, ev('poem.published', { published_at: '2026-11-23T10:05:00Z' }, '2026-11-23T10:05:00Z', 'bukan-uuid')), {
    name: 'GalatPermanen',
  });
});
