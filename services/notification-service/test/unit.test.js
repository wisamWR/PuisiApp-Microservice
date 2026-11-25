/**
 * Kalimat notifikasi, kontrak event masuk, dan API (tanpa basis data).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { exchangeUntuk, folderKontrak, validasiEvent } from '@puisiapp/events';
import * as kalimat from '../src/pesan.js';
import { IKATAN } from '../src/handler.js';
import { buatApp } from '../src/app.js';
import { e } from './bantu.js';

describe('kalimat notifikasi', () => {
  test('terbit: pertama, revisi, lolos tinjauan, tampil kembali', () => {
    assert.match(kalimat.terbit({ judul: 'Hujan', versi: 1 }).pesan, /"Hujan" sekarang bisa dibaca semua orang/);
    assert.match(kalimat.terbit({ judul: 'Hujan', versi: 2 }).judul, /Revisi/);
    assert.match(kalimat.terbit({ judul: 'Hujan', versi: 1, statusSebelum: 'HELD' }).judul, /lolos tinjauan/);
    assert.match(kalimat.terbit({ judul: 'Hujan', versi: 1, statusSebelum: 'HIDDEN' }).judul, /tampil kembali/);
  });

  test('ditahan menyertakan alasan dengan desimal gaya Indonesia', () => {
    const n = kalimat.ditahan({ judul: 'Hujan', alasan: 'Skor kemiripan 0.91 dengan puisi x' });
    assert.equal(n.jenis, 'poem_held');
    assert.match(n.pesan, /0,91/);
  });

  test('keputusan untuk pelapor menjelaskan hasilnya', () => {
    assert.match(kalimat.keputusanUntukPelapor({ judul: 'Hujan', keputusan: 'HIDE', alasan: 'x' }).pesan, /laporan dikabulkan/);
    assert.match(kalimat.keputusanUntukPelapor({ judul: 'Hujan', keputusan: 'REJECT', alasan: 'x' }).pesan, /tidak dikabulkan/);
  });

  test('judul tidak diketahui tetap menghasilkan kalimat utuh', () => {
    assert.match(kalimat.bandingDiterima({}).pesan, /untuk puisimu/);
    assert.match(kalimat.laporanDiterima({}).pesan, /sebuah puisi/);
  });
});

test('event yang dikonsumsi terdaftar di routing.json dan contoh uji sesuai skema', () => {
  const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
  addFormats(ajv);
  for (const t of IKATAN) assert.ok(exchangeUntuk(t), t);
  const id = randomUUID();
  const caseId = randomUUID();
  const reportId = randomUUID();
  const contoh = [
    e.diajukan(id), e.direvisi(id, 2), e.terbit(id), e.ditahan(id), e.disembunyikan(id), e.dihapus(id), e.selesai(id),
    e.dilaporkan(id, reportId), e.kasusDibuka(id, caseId, reportId), e.diputuskan(id, caseId, 'HIDE'), e.banding(caseId),
  ];
  assert.deepEqual(new Set(contoh.map((x) => x.event_type)), new Set(IKATAN));
  for (const ev of contoh) {
    validasiEvent(ev);
    const v = ajv.compile(JSON.parse(readFileSync(`${folderKontrak()}/events/${ev.event_type}.v1.json`, 'utf8').replace(/^﻿/, '')));
    assert.ok(v(ev.payload), `${ev.event_type}: ${ajv.errorsText(v.errors)}`);
  }
});

describe('API', () => {
  const panggilan = [];
  const app = buatApp({
    repo: {
      daftar: async (q) => (panggilan.push(['daftar', q]), { items: [], total: 0, unread: 2 }),
      jumlahBelumDibaca: async () => 2,
      tandaiDibaca: async ({ id }) => (id === '7c1e1d1a-7c58-5f27-9a51-1f2b8f0e4a31' ? { id, read: true } : null),
      tandaiSemua: async () => 2,
    },
    cekSiap: async () => {},
    log: { info() {}, error() {} },
  });
  const minta = (method, url, user = 'u-1') => app.inject({ method, url, headers: user ? { 'x-user-id': user } : {} });

  test('daftar: halaman bawaan, filter belum dibaca, tanpa cache', async () => {
    const r = await minta('GET', '/api/notifications?unread=true&page=2&size=5');
    assert.equal(r.statusCode, 200);
    assert.deepEqual(r.json(), { items: [], total: 0, unread: 2, page: 2, size: 5 });
    assert.deepEqual(panggilan.at(-1)[1], { userId: 'u-1', page: 2, size: 5, belumDibaca: true });
    assert.match(r.headers['cache-control'], /no-store/);
  });

  test('tanpa login 401; parameter salah 400', async () => {
    assert.equal((await minta('GET', '/api/notifications', null)).statusCode, 401);
    assert.equal((await minta('POST', '/api/notifications/read-all', null)).statusCode, 401);
    assert.equal((await minta('GET', '/api/notifications?size=99')).statusCode, 400);
  });

  test('tandai dibaca: milik sendiri 200, lainnya 404; read-all dan jumlah', async () => {
    assert.equal((await minta('POST', '/api/notifications/7c1e1d1a-7c58-5f27-9a51-1f2b8f0e4a31/read')).statusCode, 200);
    assert.equal((await minta('POST', `/api/notifications/${randomUUID()}/read`)).statusCode, 404);
    assert.equal((await minta('POST', '/api/notifications/bukan-uuid/read')).statusCode, 404);
    assert.deepEqual((await minta('POST', '/api/notifications/read-all')).json(), { marked: 2, unread: 0 });
    assert.deepEqual((await minta('GET', '/api/notifications/unread-count')).json(), { unread: 2 });
  });
});
