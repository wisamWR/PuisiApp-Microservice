/**
 * Handler processing-tracker dengan Redis asli (skrip Lua) dan publisher
 * tiruan; event keluar divalidasi terhadap contracts/events.
 * Dilewati bila TEST_REDIS_URL kosong, kecuali uji kontrak routing.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { exchangeUntuk, folderKontrak, validasiEvent } from '@puisiapp/events';
import { IKATAN, SEMUA_LANGKAH } from '../src/langkah.js';
import { buatKeadaan, buatKlienRedis, kanal } from '../src/keadaan.js';
import { buatHandlerTracker } from '../src/handler-tracker.js';
import { e, semuaHasil, diam } from './bantu.js';

process.env.SERVICE_NAME = 'processing-tracker';
const URL = process.env.TEST_REDIS_URL;

const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
addFormats(ajv);
const skema = new Map();
function sahkan(ev) {
  validasiEvent(ev);
  if (!skema.has(ev.event_type)) {
    const isi = readFileSync(`${folderKontrak()}/events/${ev.event_type}.v1.json`, 'utf8').replace(/^﻿/, '');
    skema.set(ev.event_type, ajv.compile(JSON.parse(isi)));
  }
  const v = skema.get(ev.event_type);
  assert.ok(v(ev.payload), `${ev.event_type}: ${ajv.errorsText(v.errors)}`);
}

test('semua event yang dikonsumsi dan diterbitkan terdaftar di routing.json', () => {
  for (const t of [...IKATAN, 'poem.processing.updated', 'poem.processing.completed']) assert.ok(exchangeUntuk(t), t);
});

test('event uji di bantu.js sesuai skema', () => {
  const id = randomUUID();
  for (const ev of [e.diajukan(id), e.direvisi(id, 2), ...semuaHasil(id), e.terbit(id), e.disembunyikan(id), e.dihapus(id)]) sahkan(ev);
});

describe('processing-tracker dengan Redis', { skip: !URL && 'TEST_REDIS_URL kosong' }, () => {
  let redis;
  let sub;
  before(async () => {
    redis = buatKlienRedis(URL);
    await redis.connect();
    sub = redis.duplicate();
    await sub.connect();
  });
  after(async () => {
    await sub?.close();
    await redis?.close();
  });

  function siapkan(langkah = [...SEMUA_LANGKAH]) {
    const terbit = [];
    const keadaan = buatKeadaan(redis, { langkah, ttlDetik: 600 });
    const tangani = buatHandlerTracker({ keadaan, publisher: { terbitkan: async (ev) => terbit.push(ev) }, langkah });
    return { terbit, keadaan, proses: (ev) => tangani(ev, { log: diam }) };
  }

  test('setiap langkah: poem.processing.updated; langkah terakhir: completed sekali', async () => {
    const id = randomUUID();
    const { terbit, keadaan, proses } = siapkan();
    await proses(e.diajukan(id));
    const hasil = semuaHasil(id);
    for (const ev of hasil) await proses(ev);

    const updated = terbit.filter((x) => x.event_type === 'poem.processing.updated');
    const completed = terbit.filter((x) => x.event_type === 'poem.processing.completed');
    assert.deepEqual(updated.map((x) => x.payload.stage), SEMUA_LANGKAH);
    assert.ok(updated.every((x) => x.payload.status === 'PROCESSING' && x.aggregate_version === 1));
    assert.equal(completed.length, 1);
    for (const ev of terbit) sahkan(ev);

    const { author_id, snapshot } = await keadaan.snapshot(id);
    assert.equal(author_id, 'u-0042');
    assert.equal(snapshot.status, 'COMPLETED');
    assert.equal(snapshot.steps_done, 6);
  });

  test('pengiriman ulang: event_id sama (konsumen hilir menyaring duplikat)', async () => {
    const id = randomUUID();
    const { terbit, proses } = siapkan(['emotion', 'image']);
    await proses(e.diajukan(id));
    const emosi = e.emosi(id);
    const gambar = e.gambar(id);
    await proses(emosi);
    await proses(gambar);
    await proses(emosi); // dikirim ulang broker
    await proses(gambar);
    const ids = (t) => terbit.filter((x) => x.event_type === t).map((x) => x.event_id);
    assert.equal(new Set(ids('poem.processing.updated')).size, 2);
    // Setelah lengkap, setiap pengiriman ulang ikut menerbitkan ulang completed (3 kali di sini),
    // selalu dengan event_id yang sama, sehingga hanya satu yang diproses konsumen.
    assert.ok(ids('poem.processing.completed').length >= 2);
    assert.equal(new Set(ids('poem.processing.completed')).size, 1, 'completed berulang memakai event_id yang sama');
  });

  test('hasil worker tiba sebelum poem.submitted: tetap tercatat, pemilik menyusul', async () => {
    const id = randomUUID();
    const { keadaan, proses } = siapkan(['emotion', 'image']);
    await proses(e.gambar(id));
    let st = await keadaan.snapshot(id);
    assert.equal(st.author_id, null);
    assert.equal(st.snapshot.steps_done, 1);
    await proses(e.diajukan(id));
    st = await keadaan.snapshot(id);
    assert.equal(st.author_id, 'u-0042');
    assert.equal(st.snapshot.steps_done, 1);
  });

  test('revisi: snapshot pindah ke versi baru dengan status REPROCESSING', async () => {
    const id = randomUUID();
    const { terbit, keadaan, proses } = siapkan(['emotion']);
    await proses(e.diajukan(id));
    await proses(e.emosi(id, 1));
    await proses(e.terbit(id));
    await proses(e.direvisi(id, 2));
    let { snapshot } = await keadaan.snapshot(id);
    assert.equal(snapshot.version, 2);
    assert.equal(snapshot.status, 'REPROCESSING');
    assert.equal(snapshot.steps_done, 0);
    assert.equal(snapshot.publication, 'PUBLISHED', 'versi lama masih tampil');
    await proses(e.emosi(id, 2));
    ({ snapshot } = await keadaan.snapshot(id));
    assert.equal(snapshot.status, 'COMPLETED');
    const v2 = terbit.filter((x) => x.aggregate_version === 2);
    assert.deepEqual(v2.map((x) => [x.event_type, x.payload.status]), [
      ['poem.processing.updated', 'REPROCESSING'],
      ['poem.processing.completed', 'COMPLETED'],
    ]);
  });

  test('status publikasi: event lebih lama diabaikan, DELETED final', async () => {
    const id = randomUUID();
    const { keadaan, proses } = siapkan(['emotion']);
    await proses(e.diajukan(id));
    await proses(e.disembunyikan(id, 1, '2026-11-22T10:00:00.000Z'));
    await proses(e.terbit(id, 1, '2026-11-22T09:00:00.000Z'));
    assert.equal((await keadaan.snapshot(id)).snapshot.publication, 'HIDDEN');
    await proses(e.dihapus(id));
    await proses(e.terbit(id, 1, '2099-01-01T00:00:00.000Z'));
    assert.equal((await keadaan.snapshot(id)).snapshot.publication, 'DELETED');
  });

  test('setiap perubahan diumumkan lewat Redis pub/sub', async () => {
    const id = randomUUID();
    const pesan = [];
    await sub.subscribe(kanal(id), (m) => pesan.push(JSON.parse(m)));
    const { proses } = siapkan(['emotion', 'image']);
    await proses(e.diajukan(id));
    await proses(e.emosi(id));
    await proses(e.gambar(id));
    await new Promise((r) => setTimeout(r, 200));
    await sub.unsubscribe(kanal(id));
    assert.deepEqual(pesan.map((p) => p.steps_done), [0, 1, 2]);
    assert.equal(pesan.at(-1).status, 'COMPLETED');
  });
});
