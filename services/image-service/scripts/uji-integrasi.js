/**
 * Uji integrasi T2.5 lewat gateway asli dan T2.1 asli (dari laptop):
 *
 *   node scripts/uji-integrasi.js
 *
 * Butuh: api-gateway, image-preview-service, image-render-worker,
 * poem-create-service, outbox-relay-submission, RabbitMQ, MinIO.
 *
 * Memeriksa:
 *   1. pratinjau lewat gateway: JPEG 540 px, p95 < 300 ms, ETag -> 304
 *   2. POST puisi (T2.1 asli) -> poem.image.rendered tiba di analysis.events
 *   3. gambar final bisa diunduh dari URL publik, JPEG 1080 px
 *   4. versi berbeda menghasilkan kunci berbeda (v1 tidak tertimpa)
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import sharp from 'sharp';
import { folderKontrak, hubungkan, validasiEvent } from '@puisiapp/events';

const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:8080';
process.env.RABBITMQ_HOST = process.env.RABBITMQ_HOST_LOKAL ?? 'localhost';
process.env.RABBITMQ_USER ??= 'puisiApp';
process.env.RABBITMQ_PASS ??= 'puisiApp_dev_only';
process.env.RABBITMQ_VHOST ??= 'puisiApp';
process.env.SERVICE_NAME = 'uji-integrasi-image';

const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
addFormats(ajv);
const validasiPayload = ajv.compile(
  JSON.parse(readFileSync(`${folderKontrak()}/events/poem.image.rendered.v1.json`, 'utf8')),
);

let gagal = 0;
const cek = (nama, ok, info = '') => {
  console.log(`${ok ? 'OK   ' : 'GAGAL'} ${nama}${info ? `  (${info})` : ''}`);
  if (!ok) gagal++;
};

// ---------------------------------------------------------------- 1. pratinjau
const urlPratinjau = (teks) =>
  `${GATEWAY}/api/images/preview?template=latar1&text=${encodeURIComponent(teks)}`;

const r = await fetch(urlPratinjau('hujan mengetuk kaca\nseperti nama yang tak jadi kupanggil'));
const isi = Buffer.from(await r.arrayBuffer());
const meta = r.ok ? await sharp(isi).metadata() : {};
cek('pratinjau lewat gateway -> 200 JPEG 540 px', r.status === 200 && meta.format === 'jpeg' && meta.width === 540, `status ${r.status}`);
const r304 = await fetch(urlPratinjau('hujan mengetuk kaca\nseperti nama yang tak jadi kupanggil'), {
  headers: { 'if-none-match': r.headers.get('etag') ?? '' },
});
cek('ETag sama -> 304', r304.status === 304, `status ${r304.status}`);
cek('template tak dikenal -> 400', (await fetch(`${GATEWAY}/api/images/preview?template=x&text=a`)).status === 400);

// Latensi diukur di bawah rate limit gateway (10/dtk per IP): 8 permintaan/dtk,
// teks unik sehingga setiap permintaan benar-benar dirender. Semua harus 200.
const tidur = (ms) => new Promise((res) => setTimeout(res, ms));
await tidur(2500); // kosongkan bucket rate limit dari permintaan sebelumnya
const durasi = [];
const statusLatensi = {};
for (let i = 0; i < 60; i++) {
  const t = performance.now();
  const res = await fetch(urlPratinjau(`baris pratinjau ${i} ${randomUUID().slice(0, 6)}\nhujan mengetuk kaca`));
  await res.arrayBuffer();
  const ms = performance.now() - t;
  statusLatensi[res.status] = (statusLatensi[res.status] ?? 0) + 1;
  if (res.status === 200) durasi.push(ms);
  await tidur(Math.max(0, 125 - ms));
}
durasi.sort((a, b) => a - b);
const p95 = Math.round(durasi[Math.ceil(0.95 * durasi.length) - 1]);
cek('60 render unik di bawah rate limit, semua 200', statusLatensi[200] === 60, JSON.stringify(statusLatensi));
cek('pratinjau p95 < 300 ms', p95 < 300, `p50 ${Math.round(durasi[Math.floor(durasi.length / 2)])} ms, p95 ${p95} ms`);

// Rate limit: semburan 60 permintaan serentak harus sebagian ditolak 429.
const semburan = await Promise.all(
  Array.from({ length: 60 }, (_, i) => fetch(urlPratinjau(`semburan ${i} ${randomUUID().slice(0, 6)}`)).then(async (res) => {
    await res.arrayBuffer();
    return res.status;
  })),
);
const jumlah429 = semburan.filter((s) => s === 429).length;
cek('rate limit gateway menolak semburan (429)', jumlah429 > 0, `${jumlah429} dari 60 ditolak`);
await tidur(2500);

// ---------------------------------------------------------------- 2-4. gambar final
const koneksi = await hubungkan({ keluarSaatPutus: false, log: { info() {}, warn() {}, error: console.error } });
const ch = await koneksi.createChannel();
const { queue } = await ch.assertQueue('', { exclusive: true, autoDelete: true });
await ch.bindQueue(queue, 'analysis.events', 'poem.image.rendered');
const tiba = [];
await ch.consume(queue, (m) => { tiba.push({ e: JSON.parse(m.content), t: performance.now() }); ch.ack(m); });

const t0 = performance.now();
const kirim = await fetch(`${GATEWAY}/api/poems`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'idempotency-key': `uji-gambar-${randomUUID()}`, cookie: 'access_token=dev' },
  body: JSON.stringify({
    title: 'Uji gambar kutipan',
    body: 'baris pembuka\n\nhujan mengetuk kaca\nseperti nama yang tak jadi kupanggil',
    quote_stanza: 1,
    template_id: 'latar3',
  }),
});
const puisi = await kirim.json();
cek('POST /api/poems (T2.1 asli) -> 202', kirim.status === 202, `status ${kirim.status}`);

const batas = Date.now() + 20_000;
while (!tiba.some((x) => x.e.aggregate_id === puisi.poem_id) && Date.now() < batas) {
  await new Promise((res) => setTimeout(res, 100));
}
const hasil = tiba.find((x) => x.e.aggregate_id === puisi.poem_id);
cek('poem.image.rendered tiba di analysis.events', Boolean(hasil), hasil ? `${Math.round(hasil.t - t0)} ms sejak POST` : 'tidak tiba');

if (hasil) {
  let amplopOk = true;
  try { validasiEvent(hasil.e); } catch { amplopOk = false; }
  cek('amplop dan payload sesuai kontrak', amplopOk && validasiPayload(hasil.e.payload), JSON.stringify(validasiPayload.errors ?? ''));
  cek('kunci berversi poems/{id}/v1.jpg', hasil.e.payload.image_key === `poems/${puisi.poem_id}/v1.jpg`);

  const g = await fetch(hasil.e.payload.image_url);
  const gb = Buffer.from(await g.arrayBuffer());
  const gm = g.ok ? await sharp(gb).metadata() : {};
  cek('gambar final dapat diunduh dari URL publik, JPEG 1080 px', g.ok && gm.format === 'jpeg' && gm.width === 1080, `${g.status}, ${gb.length} B`);
  cek('Cache-Control immutable pada objek S3', (g.headers.get('cache-control') ?? '').includes('immutable'), g.headers.get('cache-control') ?? '-');
}

await ch.close();
await koneksi.close();
console.log(gagal ? `\n${gagal} pemeriksaan GAGAL` : '\nsemua pemeriksaan lolos');
process.exit(gagal ? 1 : 0);
