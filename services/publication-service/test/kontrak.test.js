/**
 * Event keluar (poem.published, poem.held, poem.hidden) harus lolos skema
 * payload di contracts/events (T0.6) dan amplop envelope.v1.json. Event masuk
 * yang dipakai uji juga dicek terhadap skemanya, supaya bantu.js tidak
 * menyimpang dari kontrak.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { eventTurunan, exchangeUntuk, folderKontrak, validasiEvent } from '@puisiapp/events';
import { putuskan, STATUS } from '../src/mesin.js';
import { IKATAN } from '../src/handler.js';
import { sekarang, diajukan, direvisi, dinilai, diputuskan, dihapus, keadaan, POEM } from './bantu.js';

process.env.SERVICE_NAME = 'publication-service';

const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
addFormats(ajv);
const validator = new Map();
function validasiPayload(eventType, payload) {
  if (!validator.has(eventType)) {
    const isi = readFileSync(`${folderKontrak()}/events/${eventType}.v1.json`, 'utf8').replace(/^﻿/, '');
    validator.set(eventType, ajv.compile(JSON.parse(isi)));
  }
  const v = validator.get(eventType);
  assert.ok(v(payload), `${eventType}: ${ajv.errorsText(v.errors)}`);
}

test('event masuk di bantu.js sesuai skema payload', () => {
  for (const e of [diajukan(), direvisi(2), dinilai(1, 'original'), diputuskan('HIDE'), dihapus(2)]) {
    validasiEvent(e);
    validasiPayload(e.event_type, e.payload);
  }
});

test('semua event yang dikonsumsi terdaftar di routing.json', () => {
  for (const t of IKATAN) assert.ok(exchangeUntuk(t));
});

const kasus = [
  ['poem.published', keadaan(STATUS.PROCESSING), dinilai(1, 'original')],
  ['poem.held', keadaan(STATUS.PROCESSING), dinilai(1, 'suspected_plagiarism', 0.95)],
  ['poem.held', keadaan(STATUS.PROCESSING), { ...dinilai(1, 'suspected_plagiarism', 0.95), payload: { ...dinilai(1, 'suspected_plagiarism', 0.95).payload, comparisons: [] } }],
  ['poem.hidden', keadaan(STATUS.PUBLISHED, { versi_tampil: 1 }), diputuskan('HIDE')],
  ['poem.published', keadaan(STATUS.HIDDEN, { versi_tampil: 1 }), diputuskan('RESTORE')],
];

for (const [jenis, k, masuk] of kasus) {
  test(`${jenis} dari ${masuk.event_type} (${k.status}) lolos amplop dan skema payload`, () => {
    const p = putuskan(k, masuk, { sekarang });
    assert.equal(p.keluaran.length, 1);
    const [keluar] = p.keluaran;
    assert.equal(keluar.jenis, jenis);
    validasiPayload(jenis, keluar.payload);

    const event = eventTurunan(masuk, keluar.jenis, keluar.payload, { aggregateId: POEM, aggregateVersion: keluar.versi });
    validasiEvent(event);
    assert.equal(exchangeUntuk(event.event_type), 'poem.events');
    assert.equal(event.aggregate_id, POEM, 'aggregate_id = poem_id, juga untuk case.decided (aggregate_id = case_id)');
    assert.equal(event.causation_id, masuk.event_id);
    assert.equal(event.correlation_id, masuk.correlation_id);
    assert.equal(event.producer, 'publication-service');
    // event_id deterministik: event sumber yang dikirim ulang menghasilkan event_id yang sama
    assert.equal(eventTurunan(masuk, keluar.jenis, keluar.payload, { aggregateId: POEM }).event_id, event.event_id);
  });
}
