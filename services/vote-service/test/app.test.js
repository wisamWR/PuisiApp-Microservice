import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validasiEvent } from '@puisiapp/events';
import { buatApp } from '../src/app.js';
import { buatTokoTiruan, logSenyap, PENULIS, POEM, siapkanPuisiTerbit } from './bantu.js';

async function siapkan({ gagalTerbit = false, opsi = {} } = {}) {
  const toko = buatTokoTiruan();
  const terbit = [];
  const app = buatApp({
    toko,
    terbitkan: async (e) => {
      if (gagalTerbit) throw new Error('broker mati');
      validasiEvent(e);
      terbit.push(e);
    },
    cekSiap: async () => {},
    log: logSenyap,
    opsi: { sekarang: () => new Date('2026-11-23T10:00:00Z'), ...opsi },
  });
  await siapkanPuisiTerbit(toko);
  return { app, toko, terbit };
}

const pilih = (app, user, nilai, poem = POEM) =>
  app.inject({
    method: 'PUT',
    url: `/api/poems/${poem}/vote`,
    headers: user ? { 'x-user-id': user, 'content-type': 'application/json' } : { 'content-type': 'application/json' },
    payload: { nilai },
  });

test('PUT tanpa login -> 401, nilai salah -> 400, puisi tak dikenal -> 404', async () => {
  const { app } = await siapkan();
  assert.equal((await pilih(app, null, 1)).statusCode, 401);
  assert.equal((await pilih(app, 'u1', 2)).statusCode, 400);
  assert.equal((await pilih(app, 'u1', '1')).statusCode, 400);
  assert.equal((await pilih(app, 'u1', 1, '11111111-1111-4111-8111-111111111111')).statusCode, 404);
  assert.equal((await pilih(app, 'u1', 1, 'bukan-uuid')).statusCode, 404);
});

test('pemilik puisi ditolak 403, puisi belum terbit ditolak 409', async () => {
  const { app, toko, terbit } = await siapkan();
  assert.equal((await pilih(app, PENULIS, 1)).statusCode, 403);

  const lain = '22222222-2222-4222-8222-222222222222';
  await toko.perbaruiMeta(lain, { status: 'SUBMITTED', waktuMs: 1, owner: PENULIS });
  const r = await pilih(app, 'u1', 1, lain);
  assert.equal(r.statusCode, 409);
  assert.equal(r.json().error, 'belum_terbit');
  assert.equal(terbit.length, 0);
});

test('upvote menerbitkan vote.cast dan membalas skor terkini', async () => {
  const { app, terbit } = await siapkan();
  const r = await pilih(app, 'u1', 1);
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json(), { poem_id: POEM, nilai: 1, skor: 1, jumlah_suara: 1, pemilik: false, dapat_memilih: true });

  assert.equal(terbit.length, 1);
  const e = terbit[0];
  assert.equal(e.event_type, 'vote.cast');
  assert.equal(e.aggregate_id, POEM);
  assert.equal(e.aggregate_version, 1);
  assert.equal(e.payload.vote_id, e.event_id);
  assert.deepEqual(
    { ...e.payload, vote_id: undefined },
    { vote_id: undefined, poem_id: POEM, user_id: 'u1', vote_value: 1, previous_value: 0, weight: 1, sequence: 1, cast_at: '2026-11-23T10:00:00.000Z' },
  );
});

test('satu pengguna satu suara; ganti naik -> turun dihitung benar; tarik suara', async () => {
  const { app, terbit } = await siapkan();
  await pilih(app, 'u1', 1);
  await pilih(app, 'u2', 1);
  assert.equal((await pilih(app, 'u1', 1)).json().skor, 2, 'suara sama tidak dihitung dua kali');
  assert.equal(terbit.length, 2, 'suara sama tidak menerbitkan event');

  const turun = (await pilih(app, 'u1', -1)).json();
  assert.equal(turun.skor, 0);
  assert.equal(turun.jumlah_suara, 2);
  assert.equal(terbit.at(-1).payload.previous_value, 1);
  assert.equal(terbit.at(-1).payload.vote_value, -1);

  const tarik = (await pilih(app, 'u1', 0)).json();
  assert.equal(tarik.skor, 1);
  assert.equal(tarik.jumlah_suara, 1);
  assert.deepEqual(terbit.map((e) => e.payload.sequence), [1, 2, 3, 4]);
  assert.equal(new Set(terbit.map((e) => e.event_id)).size, 4, 'event_id unik per sequence');
});

test('akun berumur < 24 jam mendapat bobot rendah', async () => {
  const { app, toko, terbit } = await siapkan({ opsi: { bobotAkunBaru: 0.5 } });
  await toko.catatAkun('baru', Date.now() - 60_000);
  await pilih(app, 'baru', 1);
  await pilih(app, 'lama', 1);
  assert.deepEqual(terbit.map((e) => e.payload.weight), [0.5, 1]);
});

test('rate limit: suara ke-31 dalam satu menit ditolak 429 dengan Retry-After', async () => {
  const { app } = await siapkan({ opsi: { ratePerMenit: 30 } });
  for (let i = 0; i < 30; i++) {
    assert.equal((await pilih(app, 'u1', i % 2 === 0 ? 1 : -1)).statusCode, 200);
  }
  const r = await pilih(app, 'u1', 1);
  assert.equal(r.statusCode, 429);
  assert.ok(Number(r.headers['retry-after']) > 0);
});

test('vote.cast gagal diterbitkan -> 503 dan suara dikembalikan', async () => {
  const { app, toko } = await siapkan({ gagalTerbit: true });
  const r = await pilih(app, 'u1', 1);
  assert.equal(r.statusCode, 503);
  const s = await toko.lihat(POEM, 'u1');
  assert.equal(s.nilai, 0);
  assert.equal(s.up, 0);
  assert.equal(toko._hitung.get(POEM).seq, 0, 'sequence ikut dikembalikan');
});

test('GET: publik hanya skor gabungan, penulis melihat rincian naik/turun', async () => {
  const { app } = await siapkan();
  await pilih(app, 'u1', 1);
  await pilih(app, 'u2', 1);
  await pilih(app, 'u3', -1);

  const get = (user) => app.inject({ method: 'GET', url: `/api/poems/${POEM}/vote`, headers: { 'x-user-id': user } });
  const publik = (await get('u3')).json();
  assert.equal(publik.skor, 1);
  assert.equal(publik.nilai, -1);
  assert.equal(publik.naik, undefined);
  assert.equal(publik.dapat_memilih, true);

  const penulis = (await get(PENULIS)).json();
  assert.equal(penulis.pemilik, true);
  assert.equal(penulis.dapat_memilih, false);
  assert.equal(penulis.naik, 2);
  assert.equal(penulis.turun, 1);
});
