/**
 * Uji integrasi T2.4 (edit + hapus) lewat gateway dengan layanan asli:
 * poem-create (T2.1), poem-edit, poem-delete, relay outbox, image-render-worker (T2.5).
 *
 *   docker compose --profile lengkap up -d --build
 *   node scripts/uji-integrasi.js
 *
 * Siklus: buat -> revisi v2 -> gambar v2 (v1 tetap ada) -> hapus -> hapus lagi
 * -> revisi setelah dihapus ditolak.
 * 403 (bukan pemilik) diuji di uji unit: stub auth gateway selalu memberi
 * identitas yang sama sampai token-service (T1.2) tersedia.
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
process.env.SERVICE_NAME = 'uji-integrasi-edit-hapus';

const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
addFormats(ajv);
const skema = (n) => ajv.compile(JSON.parse(readFileSync(`${folderKontrak()}/events/${n}.v1.json`, 'utf8')));
const vRevised = skema('poem.revised');
const vDeleted = skema('poem.deleted');

let gagal = 0;
const cek = (nama, ok, info = '') => {
  console.log(`${ok ? 'OK   ' : 'GAGAL'} ${nama}${info ? `  (${info})` : ''}`);
  if (!ok) gagal++;
};
const tidur = (ms) => new Promise((r) => setTimeout(r, ms));
const minta = (method, path, body, key) =>
  fetch(`${GATEWAY}${path}`, {
    method,
    headers: {
      cookie: 'access_token=dev',
      ...(body && { 'content-type': 'application/json' }),
      ...(key && { 'idempotency-key': key }),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

// ---------------------------------------------------------------- dengarkan event
const koneksi = await hubungkan({ keluarSaatPutus: false, log: { info() {}, warn() {}, error: console.error } });
const ch = await koneksi.createChannel();
const { queue } = await ch.assertQueue('', { exclusive: true, autoDelete: true });
for (const [ex, rk] of [['poem.events', 'poem.revised'], ['poem.events', 'poem.deleted'], ['analysis.events', 'poem.image.rendered']]) {
  await ch.bindQueue(queue, ex, rk);
}
const event = [];
await ch.consume(queue, (m) => { event.push(JSON.parse(m.content)); ch.ack(m); });
const tungguEvent = async (cocok, ms = 15_000) => {
  const batas = Date.now() + ms;
  while (Date.now() < batas) {
    const e = event.find(cocok);
    if (e) return e;
    await tidur(100);
  }
  return undefined;
};

// ---------------------------------------------------------------- 1. buat
const asli = { title: 'Uji siklus', body: 'baris satu\n\nbait kutipan pertama', quote_stanza: 1, template_id: 'latar1' };
const dibuat = await (await minta('POST', '/api/poems', asli, `uji-buat-${randomUUID()}`)).json();
const id = dibuat.poem_id;
cek('puisi dibuat (T2.1)', Boolean(id), id);

// ---------------------------------------------------------------- 2. revisi
// Salinan kepemilikan dibangun dari poem.submitted secara asinkron; tunggu sebentar bila 404.
const revisi = { ...asli, body: 'baris satu diubah\n\nbait kutipan kedua', template_id: 'latar3' };
const keyRevisi = `uji-revisi-${randomUUID()}`;
let r;
for (let i = 0; i < 30; i++) {
  r = await minta('PUT', `/api/poems/${id}`, revisi, keyRevisi);
  if (r.status !== 404) break;
  await tidur(300);
}
const j = await r.json();
cek('PUT pemilik -> 202 versi 2', r.status === 202 && j.version === 2, `status ${r.status}, versi ${j.version}`);

const ulang = await minta('PUT', `/api/poems/${id}`, revisi, keyRevisi);
cek('PUT ulang key sama -> versi sama, Idempotent-Replayed', (await ulang.json()).version === 2 && ulang.headers.get('idempotent-replayed') === 'true');
cek('PUT key sama isi beda -> 409', (await minta('PUT', `/api/poems/${id}`, { ...revisi, title: 'x' }, keyRevisi)).status === 409);

const evRevisi = await tungguEvent((e) => e.event_type === 'poem.revised' && e.aggregate_id === id);
let amplopOk = Boolean(evRevisi);
try { if (evRevisi) validasiEvent(evRevisi); } catch { amplopOk = false; }
cek('poem.revised terbit, amplop + payload sesuai kontrak', amplopOk && vRevised(evRevisi.payload), JSON.stringify(vRevised.errors ?? ''));
cek('aggregate_version 2, quote_text bait baru', evRevisi?.aggregate_version === 2 && evRevisi?.payload.quote_text === 'bait kutipan kedua');
cek('tepat satu poem.revised untuk tiga PUT', event.filter((e) => e.event_type === 'poem.revised' && e.aggregate_id === id).length === 1);

// ---------------------------------------------------------------- 3. diproses ulang worker (gambar v2)
const g1 = await tungguEvent((e) => e.event_type === 'poem.image.rendered' && e.aggregate_id === id && e.aggregate_version === 1);
const g2 = await tungguEvent((e) => e.event_type === 'poem.image.rendered' && e.aggregate_id === id && e.aggregate_version === 2);
cek('revisi diproses ulang worker: gambar v2 dirender', Boolean(g2), g2?.payload.image_key);
if (g1 && g2) {
  const [h1, h2] = await Promise.all([fetch(g1.payload.image_url, { method: 'HEAD' }), fetch(g2.payload.image_url, { method: 'HEAD' })]);
  cek('gambar v1 tetap ada, v2 di kunci berbeda', h1.ok && h2.ok && g1.payload.image_key !== g2.payload.image_key);
}

// ---------------------------------------------------------------- 4. hapus
await tidur(1500); // beri waktu poem-delete mencatat versi terakhir dari poem.revised
const h = await minta('DELETE', `/api/poems/${id}`);
const hj = await h.json();
cek('DELETE pemilik -> 202 DELETED', h.status === 202 && hj.status === 'DELETED', `status ${h.status}`);
const h2 = await minta('DELETE', `/api/poems/${id}`);
cek('DELETE ulang -> 202 sama (idempoten)', h2.status === 202 && (await h2.json()).deleted_at === hj.deleted_at);

const evHapus = await tungguEvent((e) => e.event_type === 'poem.deleted' && e.aggregate_id === id);
let hapusOk = Boolean(evHapus);
try { if (evHapus) validasiEvent(evHapus); } catch { hapusOk = false; }
cek('poem.deleted terbit, sesuai kontrak', hapusOk && vDeleted(evHapus.payload), JSON.stringify(vDeleted.errors ?? ''));
cek('last_version = 2 (versi terakhir dari poem.revised)', evHapus?.payload.last_version === 2, String(evHapus?.payload.last_version));
await tidur(1500);
cek('tepat satu poem.deleted untuk dua DELETE', event.filter((e) => e.event_type === 'poem.deleted' && e.aggregate_id === id).length === 1);

// ---------------------------------------------------------------- 5. edit setelah dihapus
let tolak;
for (let i = 0; i < 30; i++) {
  tolak = await minta('PUT', `/api/poems/${id}`, { ...revisi, title: 'setelah hapus' }, `uji-akhir-${randomUUID()}`);
  if (tolak.status === 404) break;
  await tidur(300);
}
cek('PUT setelah dihapus -> 404', tolak.status === 404, `status ${tolak.status}`);

await ch.close();
await koneksi.close();
console.log(gagal ? `\n${gagal} pemeriksaan GAGAL` : '\nsemua pemeriksaan lolos');
process.exit(gagal ? 1 : 0);
