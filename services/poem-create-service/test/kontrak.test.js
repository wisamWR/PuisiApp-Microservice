import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { buatEvent, folderKontrak, validasiEvent } from '@puisiapp/events';
import { validasiPengajuan } from '@puisiapp/poem-common';
import { keRepresentasi, kePayloadEvent } from '../src/repo.js';

process.env.SERVICE_NAME = 'poem-create-service';

const skema = JSON.parse(readFileSync(`${folderKontrak()}/events/poem.submitted.v1.json`, 'utf8'));
const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
addFormats(ajv);
const validasiPayload = ajv.compile(skema);

test('contoh di skema poem.submitted.v1 valid', () => {
  for (const contoh of skema.examples) assert.ok(validasiPayload(contoh), JSON.stringify(validasiPayload.errors));
});

test('payload yang dibuat layanan lolos skema kontrak dan amplop', () => {
  const { data } = validasiPengajuan(
    {
      title: 'Jendela yang Basah',
      body: 'sore turun\n\nhujan mengetuk kaca',
      quote_stanza: 1,
      template_id: 'latar1',
      category: 'lirik',
      keywords: ['hujan'],
    },
    { templateSah: ['latar1'] },
  );
  const baris = {
    poem_id: '0b7d6f0e-4a8b-4a52-9d0b-3f4f0e9b2a10',
    author_id: 'u-0042',
    judul: data.judul,
    isi: data.isi,
    bait_kutipan: data.baitKutipan,
    indeks_bait: data.indeksBait,
    template: data.template,
    kategori: data.kategori,
    keyword_manual: data.kataKunci,
    created_at: new Date(),
  };
  const payload = kePayloadEvent(keRepresentasi(baris));
  assert.ok(validasiPayload(payload), JSON.stringify(validasiPayload.errors));

  const event = buatEvent('poem.submitted', baris.poem_id, 1, payload);
  assert.doesNotThrow(() => validasiEvent(event));
});

test('payload tanpa kategori dan kata kunci tetap valid', () => {
  const rep = keRepresentasi({
    poem_id: '0b7d6f0e-4a8b-4a52-9d0b-3f4f0e9b2a10',
    author_id: 'stub-user',
    judul: 'a',
    isi: 'b',
    bait_kutipan: 'b',
    indeks_bait: 0,
    template: 'latar1',
    kategori: null,
    keyword_manual: [],
    created_at: new Date(),
  });
  assert.ok(validasiPayload(kePayloadEvent(rep)), JSON.stringify(validasiPayload.errors));
});
