/**
 * Uji integrasi T2.7 lewat gateway asli: POST puisi (T2.1, poem.submitted
 * asli lewat relay), gambar dari image-render-worker asli (T2.5), keputusan
 * publikasi dari publication-service asli (T2.2). Hasil worker kelompok lain
 * dikirim palsu.
 *
 *   GATEWAY_URL=http://localhost:8080 node scripts/uji-integrasi.js
 *
 * Memeriksa:
 *   1. stream SSE lewat gateway: header text/event-stream, snapshot awal
 *   2. setiap langkah tercentang tanpa refresh, urutan tidak mundur
 *   3. poem.processing.updated / completed terbit ke RabbitMQ dan sesuai kontrak
 *   4. sambung ulang di tengah proses: langsung mendapat status terkini
 *   5. beberapa koneksi bersamaan (dibagi ke replika berbeda) menerima perubahan yang sama
 *   6. puisi orang lain / tak dikenal: 404; tanpa login: 401
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { buatEvent, buatPublisher, folderKontrak, hubungkan, validasiEvent } from '@puisiapp/events';
import { sesiUji } from '@puisiapp/poem-common';

const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:8080';
const COOKIE = (await sesiUji(GATEWAY, { log: (m) => console.log(`(sesi) ${m}`) })).cookie;
process.env.RABBITMQ_HOST = process.env.RABBITMQ_HOST_LOKAL ?? 'localhost';
process.env.RABBITMQ_USER ??= 'puisiApp';
process.env.RABBITMQ_PASS ??= 'puisiApp_dev_only';
process.env.RABBITMQ_VHOST ??= 'puisiApp';
process.env.SERVICE_NAME = 'uji-integrasi-status';

let gagal = 0;
const cek = (nama, kondisi, info = '') => {
  console.log(`${kondisi ? 'OK   ' : 'GAGAL'} ${nama}${info ? `  (${info})` : ''}`);
  if (!kondisi) gagal++;
};
const jeda = (ms) => new Promise((r) => setTimeout(r, ms));
const tunggu = async (syarat, ms = 20_000) => {
  const akhir = Date.now() + ms;
  while (!syarat() && Date.now() < akhir) await jeda(100);
  return syarat();
};

const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
addFormats(ajv);
const skema = (t) => ajv.compile(JSON.parse(readFileSync(`${folderKontrak()}/events/${t}.v1.json`, 'utf8').replace(/^﻿/, '')));
const validator = { 'poem.processing.updated': skema('poem.processing.updated'), 'poem.processing.completed': skema('poem.processing.completed') };

async function buka(poemId, cookie = COOKIE) {
  const ac = new AbortController();
  const r = await fetch(`${GATEWAY}/api/poems/${poemId}/status/stream`, { headers: { cookie }, signal: ac.signal });
  const snapshot = [];
  if (r.status === 200) {
    (async () => {
      let teks = '';
      const dec = new TextDecoder();
      try {
        for await (const b of r.body) {
          teks += dec.decode(b, { stream: true });
          let i;
          while ((i = teks.indexOf('\n\n')) >= 0) {
            const data = teks.slice(0, i).split('\n').find((l) => l.startsWith('data: '));
            teks = teks.slice(i + 2);
            if (data) snapshot.push(JSON.parse(data.slice(6)));
          }
        }
      } catch {
        /* ditutup */
      }
    })();
  }
  return { status: r.status, headers: r.headers, snapshot, tutup: () => ac.abort(), akhir: () => snapshot.at(-1) };
}

// ---- dengarkan event keluaran tracker
const koneksi = await hubungkan({ keluarSaatPutus: false, log: { info() {}, warn() {}, error: console.error } });
const ch = await koneksi.createChannel();
const { queue } = await ch.assertQueue('', { exclusive: true, autoDelete: true });
for (const k of ['poem.processing.updated', 'poem.processing.completed']) await ch.bindQueue(queue, 'processing.events', k);
const diterima = [];
await ch.consume(queue, (m) => {
  diterima.push(JSON.parse(m.content.toString('utf8')));
  ch.ack(m);
});
const publisher = await buatPublisher(koneksi);
const kirim = (tipe, id, v, payload) => publisher.terbitkan(buatEvent(tipe, id, v, payload, { producer: 'worker-palsu' }));

const r = await fetch(`${GATEWAY}/api/poems`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'idempotency-key': `uji-${randomUUID()}`, cookie: COOKIE },
  body: JSON.stringify({ title: 'Uji Status Langsung', body: 'baris satu\nbaris dua\n\nbait kedua', quote_stanza: 1, template_id: 'latar2' }),
});
const { poem_id: id } = await r.json();
cek('POST puisi -> 202', r.status === 202, id);

// ---- 1. stream dibuka tepat setelah 202 (tracker mungkin belum memproses submitted)
const a = await buka(id);
cek('stream lewat gateway: 200 text/event-stream', a.status === 200 && /text\/event-stream/.test(a.headers.get('content-type') ?? ''),
  `${a.status} ${a.headers.get('content-type')}`);
cek('snapshot awal diterima', await tunggu(() => a.snapshot.length >= 1), JSON.stringify(a.akhir()?.steps?.map((s) => s.name)));

// ---- 5. koneksi tambahan bersamaan
const lain = await Promise.all([buka(id), buka(id), buka(id)]);

// ---- 2. gambar asli + hasil palsu satu per satu
cek('langkah gambar tercentang dari image-render-worker asli',
  await tunggu(() => a.akhir()?.steps?.find((s) => s.name === 'image')?.done), `${a.akhir()?.steps_done}/${a.akhir()?.steps_total}`);
await kirim('poem.emotion.analyzed', id, 1, { poem_id: id, emotions: [{ line_number: 1, label: 'sedih', score: 0.7 }] });
await kirim('poem.themes.extracted', id, 1, { poem_id: id, themes: ['rindu'] });
cek('langkah emosi dan tema tercentang tanpa refresh',
  await tunggu(() => ['emotion', 'themes'].every((n) => a.akhir()?.steps?.find((s) => s.name === n)?.done)));

// ---- 4. sambung ulang di tengah proses
a.tutup();
await kirim('poem.keywords.extracted', id, 1, { poem_id: id, keywords: ['hujan'] }); // terjadi saat terputus
await jeda(500);
const b = await buka(id);
cek('sambung ulang: snapshot awal sudah memuat langkah saat terputus',
  await tunggu(() => b.snapshot[0]?.steps?.find((s) => s.name === 'keywords')?.done), `${b.snapshot[0]?.steps_done} langkah`);

await kirim('authorship.recorded', id, 1, { poem_id: id, version: 1, content_hash: 'a'.repeat(64), algorithm: 'SHA-256' });
await kirim('poem.similarity.scored', id, 1, { poem_id: id, score: 0.05, level: 'original', comparisons: [] });
cek('semua langkah selesai dan keputusan publikasi tiba (publication-service asli)',
  await tunggu(() => b.akhir()?.status === 'COMPLETED' && b.akhir()?.publication === 'PUBLISHED'),
  `${b.akhir()?.status} / ${b.akhir()?.publication}`);
const urut = b.snapshot.map((s) => s.steps_done);
cek('langkah tidak pernah mundur', urut.every((n, i) => i === 0 || n >= urut[i - 1]), urut.join(','));
cek('koneksi bersamaan menerima status akhir yang sama',
  await tunggu(() => lain.every((k) => k.akhir()?.status === 'COMPLETED' && k.akhir()?.publication === 'PUBLISHED')),
  lain.map((k) => `${k.akhir()?.steps_done}/${k.akhir()?.publication}`).join(' '));

// ---- 3. event ke RabbitMQ
await tunggu(() => diterima.some((x) => x.event_type === 'poem.processing.completed' && x.aggregate_id === id), 5000);
const milik = diterima.filter((x) => x.aggregate_id === id);
const upd = milik.filter((x) => x.event_type === 'poem.processing.updated');
const cmp = milik.filter((x) => x.event_type === 'poem.processing.completed');
cek('poem.processing.updated untuk 6 langkah', new Set(upd.map((x) => x.payload.stage)).size === 6, [...new Set(upd.map((x) => x.payload.stage))].join(','));
cek('poem.processing.completed terbit', cmp.length >= 1 && new Set(cmp.map((x) => x.event_id)).size === 1);
let sah = true;
for (const x of milik) {
  try {
    validasiEvent(x);
  } catch {
    sah = false;
  }
  if (!validator[x.event_type](x.payload)) sah = false;
}
cek('amplop dan payload sesuai kontrak', sah);

// ---- 6. hak akses
cek('puisi tak dikenal: 404', (await buka(randomUUID())).status === 404);
cek('tanpa login: 401', (await fetch(`${GATEWAY}/api/poems/${id}/status/stream`)).status === 401);

for (const k of [b, ...lain]) k.tutup();
await publisher.tutup();
await koneksi.close();
console.log(gagal ? `\n${gagal} pemeriksaan gagal` : '\nsemua pemeriksaan lolos');
process.exit(gagal ? 1 : 0);
