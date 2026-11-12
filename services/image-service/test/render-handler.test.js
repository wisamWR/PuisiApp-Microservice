import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { buatEvent, buatLogger, folderKontrak, GalatPermanen, uuidv5, validasiEvent } from '@puisiapp/events';
import { muatTemplate } from '../src/render.js';
import { buatHandlerRender, kunciGambar } from '../src/render-handler.js';

process.env.SERVICE_NAME = 'image-render-worker';
const folder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets/templates');
const skema = JSON.parse(readFileSync(`${folderKontrak()}/events/poem.image.rendered.v1.json`, 'utf8'));
const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
addFormats(ajv);
const validasiPayload = ajv.compile(skema);

let templates;
before(async () => { templates = await muatTemplate(folder); });

function siapkan({ s3Gagal = false } = {}) {
  const unggahan = [];
  const terbit = [];
  const handler = buatHandlerRender({
    templates,
    s3: {
      unggah: async (kunci, isi, tipe) => {
        if (s3Gagal) throw new Error('S3 timeout');
        unggahan.push({ kunci, ukuran: isi.length, tipe });
      },
      urlPublik: (k) => `http://localhost:9000/puisi-images/${k}`,
    },
    publisher: { terbitkan: async (e) => terbit.push(e) },
  });
  const ctx = { log: buatLogger('uji', {}, { tulis: () => {} }), percobaan: 0 };
  return { handler, unggahan, terbit, ctx };
}

const poemId = '0b7d6f0e-4a8b-4a52-9d0b-3f4f0e9b2a10';
const submitted = (versi = 1, tambahan = {}) =>
  buatEvent(
    versi === 1 ? 'poem.submitted' : 'poem.revised',
    poemId,
    versi,
    { poem_id: poemId, version: versi, quote_text: 'hujan mengetuk kaca', template_id: 'latar2', ...tambahan },
    { producer: 'poem-create-service' },
  );

test('render, unggah ke kunci berversi, terbitkan poem.image.rendered yang valid', async () => {
  const { handler, unggahan, terbit, ctx } = siapkan();
  const sumber = submitted(1);
  await handler(sumber, ctx);

  assert.deepEqual(unggahan.map((u) => [u.kunci, u.tipe]), [[`poems/${poemId}/v1.jpg`, 'image/jpeg']]);
  assert.ok(unggahan[0].ukuran > 10_000);

  const e = terbit[0];
  assert.equal(e.event_type, 'poem.image.rendered');
  assert.doesNotThrow(() => validasiEvent(e));
  assert.ok(validasiPayload(e.payload), JSON.stringify(validasiPayload.errors));
  assert.equal(e.causation_id, sumber.event_id);
  assert.equal(e.correlation_id, sumber.correlation_id);
  assert.equal(e.event_id, uuidv5('image-render-worker:poem.image.rendered', sumber.event_id), 'id deterministik');
});

test('setiap versi punya gambar sendiri; versi lama tidak ditimpa', async () => {
  const { handler, unggahan, terbit, ctx } = siapkan();
  await handler(submitted(1), ctx);
  await handler(submitted(2), ctx);
  assert.deepEqual(unggahan.map((u) => u.kunci), [kunciGambar(poemId, 1), kunciGambar(poemId, 2)]);
  assert.deepEqual(terbit.map((e) => e.aggregate_version), [1, 2]);
});

test('event yang sama diproses ulang -> event hasil dengan id sama (aman untuk retry)', async () => {
  const { handler, terbit, ctx } = siapkan();
  const sumber = submitted(1);
  await handler(sumber, ctx);
  await handler(sumber, ctx);
  assert.equal(terbit[0].event_id, terbit[1].event_id);
});

test('template tak dikenal atau quote_text kosong -> GalatPermanen (langsung DLQ)', async () => {
  const { handler, ctx } = siapkan();
  await assert.rejects(handler(submitted(1, { template_id: 'latar9' }), ctx), GalatPermanen);
  await assert.rejects(handler(submitted(1, { quote_text: '' }), ctx), GalatPermanen);
});

test('S3 gagal -> galat sementara (dicoba ulang), tidak ada event terbit', async () => {
  const { handler, terbit, ctx } = siapkan({ s3Gagal: true });
  await assert.rejects(handler(submitted(1), ctx), (err) => !(err instanceof GalatPermanen));
  assert.equal(terbit.length, 0);
});

test('contoh di skema poem.image.rendered.v1 valid', () => {
  for (const c of skema.examples) assert.ok(validasiPayload(c), JSON.stringify(validasiPayload.errors));
});
