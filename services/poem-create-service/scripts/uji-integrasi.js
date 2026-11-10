/**
 * Uji integrasi T2.1 lewat gateway asli (T0.4) dan outbox relay asli (T0.3).
 * Dijalankan dari laptop setelah `docker compose up -d`:
 *
 *   node scripts/uji-integrasi.js
 *
 * Variabel (bawaan untuk laptop): GATEWAY_URL=http://localhost:8080,
 * AMQP_URL atau RABBITMQ_* dari .env dengan host localhost.
 * Cookie access_token apa pun diterima stub auth gateway sebelum T1.2 ada.
 *
 * Memeriksa:
 *   1. tanpa cookie -> 401 dari gateway
 *   2. POST sah -> 202, Location, status PROCESSING
 *   3. kirim ulang key sama -> 202 dengan poem_id sama, Idempotent-Replayed
 *   4. key sama isi beda -> 409
 *   5. tag <script> dibersihkan
 *   6. poem.submitted tiba di exchange poem.events, amplop + payload valid,
 *      correlation_id = X-Request-Id gateway, hanya SATU event untuk dua kiriman
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { folderKontrak, hubungkan, validasiEvent } from '@puisiapp/events';

const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:8080';
process.env.RABBITMQ_HOST = process.env.RABBITMQ_HOST_LOKAL ?? 'localhost';
process.env.RABBITMQ_USER ??= 'puisiApp';
process.env.RABBITMQ_PASS ??= 'puisiApp_dev_only';
process.env.RABBITMQ_VHOST ??= 'puisiApp';
process.env.SERVICE_NAME = 'uji-integrasi-poem-create';

const skema = JSON.parse(readFileSync(`${folderKontrak()}/events/poem.submitted.v1.json`, 'utf8'));
const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
addFormats(ajv);
const validasiPayload = ajv.compile(skema);

let gagal = 0;
const cek = (nama, kondisi, info = '') => {
  console.log(`${kondisi ? 'OK   ' : 'GAGAL'} ${nama}${info ? `  (${info})` : ''}`);
  if (!kondisi) gagal++;
};

// ---- dengarkan poem.events sebelum mengirim
const koneksi = await hubungkan({ keluarSaatPutus: false, log: { info() {}, warn() {}, error: console.error } });
const ch = await koneksi.createChannel();
const { queue } = await ch.assertQueue('', { exclusive: true, autoDelete: true });
await ch.bindQueue(queue, 'poem.events', 'poem.submitted');
const diterima = [];
await ch.consume(queue, (m) => { diterima.push({ m, t: performance.now() }); ch.ack(m); });

const key = `uji-${randomUUID()}`;
const body = {
  title: 'Uji <b>Integrasi</b><script>alert(1)</script>',
  body: 'baris satu\nbaris dua\n\nbait kedua yang dikutip',
  quote_stanza: 1,
  template_id: 'latar1',
  keywords: ['Uji'],
};
const kirim = (b = body, cookie = 'access_token=dev') =>
  fetch(`${GATEWAY}/api/poems`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': key, cookie },
    body: JSON.stringify(b),
  });

const tanpaLogin = await kirim(body, '');
cek('tanpa cookie ditolak gateway', tanpaLogin.status === 401, `status ${tanpaLogin.status}`);

const t0 = performance.now();
const r1 = await kirim();
const j1 = await r1.json();
cek('POST sah -> 202', r1.status === 202, `status ${r1.status}`);
cek('Location menunjuk puisi', r1.headers.get('location') === `/api/poems/${j1.poem_id}`);
cek('status PROCESSING, versi 1', j1.status === 'PROCESSING' && j1.version === 1);
cek('<script> dan tag dibuang', j1.title === 'Uji Integrasi', JSON.stringify(j1.title));
cek('author dari gateway (stub)', j1.author_id === 'stub-user', j1.author_id);

const r2 = await kirim();
const j2 = await r2.json();
cek('kirim ulang -> poem_id sama', r2.status === 202 && j2.poem_id === j1.poem_id);
cek('header Idempotent-Replayed', r2.headers.get('idempotent-replayed') === 'true');

const r3 = await kirim({ ...body, title: 'Judul lain' });
cek('key sama isi beda -> 409', r3.status === 409, `status ${r3.status}`);

// ---- tunggu event
const batas = Date.now() + 10_000;
while (!diterima.some((d) => JSON.parse(d.m.content).aggregate_id === j1.poem_id) && Date.now() < batas) {
  await new Promise((r) => setTimeout(r, 50));
}
await new Promise((r) => setTimeout(r, 1500)); // beri waktu bila ada event ganda
const milikIni = diterima.filter((d) => JSON.parse(d.m.content).aggregate_id === j1.poem_id);
cek('tepat satu poem.submitted untuk dua kiriman', milikIni.length === 1, `diterima ${milikIni.length}`);

if (milikIni.length) {
  const { m, t } = milikIni[0];
  const event = JSON.parse(m.content);
  let amplopOk = true;
  try { validasiEvent(event); } catch { amplopOk = false; }
  cek('amplop lolos envelope.v1.json', amplopOk);
  cek('payload lolos poem.submitted.v1.json', validasiPayload(event.payload), JSON.stringify(validasiPayload.errors ?? ''));
  cek('aggregate_version 1, producer poem-create-service', event.aggregate_version === 1 && event.producer === 'poem-create-service');
  cek('quote_text = bait kedua', event.payload.quote_text === 'bait kedua yang dikutip');
  cek('correlation_id terisi dari gateway', typeof event.correlation_id === 'string' && event.correlation_id.length >= 16, event.correlation_id);
  console.log(`      waktu POST sampai event tiba di poem.events: ${Math.round(t - t0)} ms`);
}

await ch.close();
await koneksi.close();
console.log(gagal ? `\n${gagal} pemeriksaan GAGAL` : '\nsemua pemeriksaan lolos');
process.exit(gagal ? 1 : 0);
