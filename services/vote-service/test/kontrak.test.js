/**
 * Kontrak dua arah: vote.cast dan event yang dikonsumsi sesuai skema
 * contracts/events, dan respons API sesuai contracts/openapi/vote.yaml.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';
import { exchangeUntuk, folderKontrak } from '@puisiapp/events';
import { IKATAN } from '../src/proyeksi.js';
import { buatEventVote, tampilanSkor } from '../src/suara.js';
import { POEM } from './bantu.js';

const baca = (berkas) => readFileSync(`${folderKontrak()}/${berkas}`, 'utf8').replace(/^﻿/, '');
const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
addFormats(ajv);

test('vote.cast keluaran layanan sesuai skema payload', () => {
  const validasi = ajv.compile(JSON.parse(baca('events/vote.cast.v1.json')));
  for (const [lama, baru, bobot] of [[0, 1, 1], [1, -1, 0.5], [-1, 0, 1]]) {
    const e = buatEventVote({ poemId: POEM, userId: 'u1', lama, baru, seq: 7, bobot, waktu: new Date() });
    assert.ok(validasi(e.payload), JSON.stringify(validasi.errors));
    assert.equal(exchangeUntuk(e.event_type), 'vote.events');
  }
});

test('event yang dikonsumsi terdaftar di routing.json dan punya skema', () => {
  for (const t of IKATAN) {
    assert.ok(exchangeUntuk(t), t);
    assert.ok(JSON.parse(baca(`events/${t}.v1.json`)), t);
  }
});

test('respons API dan contoh OpenAPI sesuai skema Skor', () => {
  const spek = parse(baca('openapi/vote.yaml'));
  const validasi = ajv.compile(spek.components.schemas.Skor);
  const contoh = [
    tampilanSkor({ poemId: POEM, up: 3, down: 1, nilai: 1, pemilik: false }),
    tampilanSkor({ poemId: POEM, up: 3, down: 1, nilai: 0, pemilik: true }),
    ...Object.values(spek.paths['/poems/{id}/vote'].get.responses['200'].content['application/json'].examples).map((x) => x.value),
    spek.paths['/poems/{id}/vote'].put.responses['200'].content['application/json'].example,
  ];
  for (const c of contoh) assert.ok(validasi(c), JSON.stringify(validasi.errors));
});
