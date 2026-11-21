/**
 * Kontrak dua arah:
 *   - event yang dikonsumsi: contoh uji (bantu.js) sesuai skema contracts/events
 *     dan semua event ikatan terdaftar di routing.json;
 *   - respons API: keluaran tampilan.js dan contoh di OpenAPI sesuai skema
 *     contracts/openapi/poem-query.yaml, supaya mock server (T3.1) dan layanan
 *     asli tidak menyimpang.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';
import { exchangeUntuk, folderKontrak, validasiEvent } from '@puisiapp/events';
import { IKATAN } from '../src/proyeksi.js';
import { lihatDetail, ringkasan } from '../src/tampilan.js';
import { bundel, e, PEMILIK, ORANG_LAIN } from './bantu.js';

const baca = (berkas) => readFileSync(`${folderKontrak()}/${berkas}`, 'utf8').replace(/^﻿/, '');

const ajvEvent = new Ajv2020({ allErrors: true, allowUnionTypes: true });
addFormats(ajvEvent);

test('semua event yang dikonsumsi terdaftar di routing.json dan punya skema', () => {
  assert.equal(IKATAN.length, 14);
  for (const t of IKATAN) {
    assert.ok(exchangeUntuk(t), t);
    assert.ok(JSON.parse(baca(`events/${t}.v1.json`)), t);
  }
});

test('event uji di bantu.js sesuai skema payload', () => {
  const id = '0b7d6f0e-4a8b-4a52-9d0b-3f4f0e9b2a10';
  const semua = [
    e.diajukan(id), e.direvisi(id, 2), e.terbit(id), e.ditahan(id), e.disembunyikan(id), e.dihapus(id),
    e.gambar(id), e.kataKunci(id), e.tema(id), e.emosi(id), e.kemiripan(id), e.skor(id, 3),
    e.terdaftar(), e.profil(),
  ];
  assert.deepEqual(new Set(semua.map((x) => x.event_type)), new Set(IKATAN));
  for (const ev of semua) {
    validasiEvent(ev);
    const v = ajvEvent.compile(JSON.parse(baca(`events/${ev.event_type}.v1.json`)));
    assert.ok(v(ev.payload), `${ev.event_type}: ${ajvEvent.errorsText(v.errors)}`);
  }
});

// ---- OpenAPI
const dok = parse(baca('openapi/poem-query.yaml'));
const ajvApi = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajvApi);
ajvApi.addSchema({ $id: 'poem-query', components: dok.components });
const skemaApi = (nama) => ajvApi.getSchema(`poem-query#/components/schemas/${nama}`);

function sesuai(nama, data) {
  const v = skemaApi(nama);
  assert.ok(v(data), `${nama}: ${ajvApi.errorsText(v.errors)}`);
}

test('contoh respons di OpenAPI sesuai skemanya sendiri', () => {
  const detail = dok.paths['/api/poems/{id}'].get.responses['200'].content['application/json'].examples;
  for (const [nama, contoh] of Object.entries(detail)) {
    assert.doesNotThrow(() => sesuai('DetailPuisi', contoh.value), nama);
  }
  sesuai('HalamanPuisi', dok.paths['/api/poems'].get.responses['200'].content['application/json'].example);
});

test('keluaran detail layanan sesuai skema DetailPuisi', () => {
  const lengkap = bundel({}, [{
    gambar_url: 'http://localhost:9000/puisi-images/poems/x/v1.jpg', gambar_lebar: 1080, gambar_tinggi: 1080,
    kata_kunci: ['hujan'], tema: ['rindu'], emosi: [{ line_number: 1, label: 'sedih', score: 0.7 }],
    level_kemiripan: 'original', skor_kemiripan: 0.04, tag: ['hujan'], kategori: 'lirik',
  }]);
  sesuai('DetailPuisi', lihatDetail(lengkap, ORANG_LAIN));
  sesuai('DetailPuisi', lihatDetail(bundel({ status: 'PROCESSING', versi_tampil: null, published_at: null }), PEMILIK));
  sesuai('DetailPuisi', lihatDetail(bundel({ versi_terbaru: 2 }, [{}, {}]), PEMILIK)); // REPROCESSING
  const tanpaNama = bundel();
  tanpaNama.penulis = { id: 'u-0042', username: null, display_name: null };
  sesuai('DetailPuisi', lihatDetail(tanpaNama, ORANG_LAIN));
});

test('keluaran daftar layanan sesuai skema HalamanPuisi', () => {
  const r = {
    poem_id: '0b7d6f0e-4a8b-4a52-9d0b-3f4f0e9b2a10', status: 'HELD', versi_terbaru: 1, versi_tampil: null, versi: 1,
    judul: 'J', bait_kutipan: 'k', gambar_url: null, tema: [], level_kemiripan: 'suspected_plagiarism',
    skor: 0, jumlah_suara: 0, dikirim_at: '2026-11-20T08:00:00.000Z', published_at: null,
  };
  sesuai('HalamanPuisi', { items: [ringkasan(r, true)], page: 1, size: 20, total: 1 });
});
