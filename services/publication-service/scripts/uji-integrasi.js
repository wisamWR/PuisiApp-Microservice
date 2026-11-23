/**
 * Uji integrasi T2.2 dengan layanan asli: gateway (T0.4), poem-create-service
 * (T2.1, poem.submitted asli), outbox relay Debezium (T0.3), dan
 * publication-service. Skor kemiripan dan keputusan moderator dikirim palsu
 * karena T7.2 dan kelompok 8 belum siap.
 *
 * Dijalankan dari laptop setelah `docker compose up -d`:
 *
 *   node scripts/uji-integrasi.js
 *
 * Variabel (bawaan untuk laptop): GATEWAY_URL=http://localhost:8080,
 * RABBITMQ_* dari .env dengan host localhost.
 *
 * Memeriksa:
 *   A. submitted -> skor original -> poem.published (versi 1, causation = skor)
 *   B. submitted -> skor dugaan jiplakan -> poem.held -> APPROVE -> poem.published
 *   C. puisi terbit -> HIDE -> poem.hidden -> RESTORE (banding) -> poem.published
 *   D. keputusan saat masih PROCESSING ditolak: tidak ada event sebelum skor ada
 *   E. skor yang tiba sebelum poem.submitted ditunda lalu tetap diproses
 *   Semua event keluar lolos amplop dan skema payload contracts/events.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { buatEvent, buatPublisher, folderKontrak, hubungkan, validasiEvent } from '@puisiapp/events';

const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:8080';
process.env.RABBITMQ_HOST = process.env.RABBITMQ_HOST_LOKAL ?? 'localhost';
process.env.RABBITMQ_USER ??= 'puisiApp';
process.env.RABBITMQ_PASS ??= 'puisiApp_dev_only';
process.env.RABBITMQ_VHOST ??= 'puisiApp';
process.env.SERVICE_NAME = 'uji-integrasi-publication';
const BATAS_MS = Number(process.env.BATAS_MS) || 30_000;

const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
addFormats(ajv);
const skema = (t) =>
  ajv.compile(JSON.parse(readFileSync(`${folderKontrak()}/events/${t}.v1.json`, 'utf8').replace(/^﻿/, '')));
const validator = Object.fromEntries(['poem.published', 'poem.held', 'poem.hidden'].map((t) => [t, skema(t)]));

let gagal = 0;
const cek = (nama, kondisi, info = '') => {
  console.log(`${kondisi ? 'OK   ' : 'GAGAL'} ${nama}${info ? `  (${info})` : ''}`);
  if (!kondisi) gagal++;
};
const jeda = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- dengarkan event keluaran publication-service
const koneksi = await hubungkan({ keluarSaatPutus: false, log: { info() {}, warn() {}, error: console.error } });
const ch = await koneksi.createChannel();
const { queue } = await ch.assertQueue('', { exclusive: true, autoDelete: true });
for (const k of ['poem.published', 'poem.held', 'poem.hidden']) await ch.bindQueue(queue, 'poem.events', k);
const diterima = [];
await ch.consume(queue, (m) => {
  diterima.push(JSON.parse(m.content.toString('utf8')));
  ch.ack(m);
});
const publisher = await buatPublisher(koneksi);

/** Tunggu event keluaran untuk poemId dengan jenis tertentu (yang ke-n). */
async function tunggu(poemId, jenis, n = 1, batas = BATAS_MS) {
  const akhir = Date.now() + batas;
  while (Date.now() < akhir) {
    const cocok = diterima.filter((e) => e.aggregate_id === poemId && e.event_type === jenis);
    if (cocok.length >= n) return cocok[n - 1];
    await jeda(200);
  }
  return null;
}
const eventUntuk = (poemId) => diterima.filter((e) => e.aggregate_id === poemId).map((e) => e.event_type);

function sahkan(nama, e) {
  if (!e) return;
  let amplopSah = true;
  try {
    validasiEvent(e);
  } catch {
    amplopSah = false;
  }
  cek(`${nama}: amplop dan payload ${e.event_type} sesuai kontrak`, amplopSah && validator[e.event_type](e.payload),
    ajv.errorsText(validator[e.event_type].errors));
  cek(`${nama}: producer publication-service`, e.producer === 'publication-service', e.producer);
}

async function ajukan(judul) {
  const r = await fetch(`${GATEWAY}/api/poems`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': `uji-${randomUUID()}`, cookie: 'access_token=dev' },
    body: JSON.stringify({ title: judul, body: 'baris satu\nbaris dua\n\nbait kedua', quote_stanza: 1, template_id: 'latar1' }),
  });
  const j = await r.json();
  cek(`POST ${judul} -> 202`, r.status === 202, `status ${r.status}`);
  return j.poem_id;
}

async function skor(poemId, versi, level, score) {
  const e = buatEvent('poem.similarity.scored', poemId, versi,
    { poem_id: poemId, score, level, comparisons: [{ compared_poem_id: randomUUID(), score }] },
    { producer: 'similarity-worker-palsu' });
  await publisher.terbitkan(e);
  return e;
}

async function kasus(poemId, decision) {
  const caseId = randomUUID();
  const e = buatEvent('case.decided', caseId, 1, {
    case_id: caseId, poem_id: poemId, moderator_id: 'moderator-palsu', decision,
    reason: `Keputusan ${decision} (uji integrasi)`, decided_at: new Date().toISOString(),
  }, { producer: 'case-decision-palsu' });
  await publisher.terbitkan(e);
  return e;
}

// ---- A. terbit langsung
const a = await ajukan('Uji Publikasi A');
await jeda(1500);
const skorA = await skor(a, 1, 'original', 0.05);
const terbitA = await tunggu(a, 'poem.published');
cek('A: poem.published tiba', !!terbitA);
sahkan('A', terbitA);
cek('A: aggregate_version 1, causation = event skor', terbitA?.aggregate_version === 1 && terbitA?.causation_id === skorA.event_id);
cek('A: correlation_id diwarisi dari skor', terbitA?.correlation_id === skorA.correlation_id);

// ---- B. ditahan lalu diloloskan moderator
const b = await ajukan('Uji Publikasi B');
await jeda(1500);
await skor(b, 1, 'suspected_plagiarism', 0.92);
const tahanB = await tunggu(b, 'poem.held');
cek('B: poem.held tiba', !!tahanB, tahanB?.payload?.reason);
sahkan('B', tahanB);
await kasus(b, 'APPROVE');
const terbitB = await tunggu(b, 'poem.published');
cek('B: APPROVE -> poem.published', !!terbitB);

// ---- C. disembunyikan lalu banding dikabulkan
await kasus(a, 'HIDE');
const sembunyiA = await tunggu(a, 'poem.hidden');
cek('C: HIDE -> poem.hidden', !!sembunyiA, sembunyiA?.payload?.reason);
sahkan('C', sembunyiA);
await jeda(50); // decided_at RESTORE harus lebih baru dari HIDE
await kasus(a, 'RESTORE');
cek('C: RESTORE -> poem.published lagi', !!(await tunggu(a, 'poem.published', 2)));

// ---- D. keputusan sebelum skor ditolak
const d = await ajukan('Uji Publikasi D');
await jeda(1500);
await kasus(d, 'APPROVE');
await jeda(4000);
cek('D: APPROVE saat PROCESSING tidak menerbitkan apa pun', eventUntuk(d).length === 0, eventUntuk(d).join(','));
await skor(d, 1, 'inspired', 0.3);
cek('D: setelah skor ada baru terbit', !!(await tunggu(d, 'poem.published')));

// ---- E. skor mendahului poem.submitted (di-retry sampai submitted tiba)
const e = await ajukan('Uji Publikasi E');
await skor(e, 1, 'similar', 0.6); // tanpa jeda: bisa tiba sebelum poem.submitted diproses
const terbitE = await tunggu(e, 'poem.published', 1, 60_000);
cek('E: skor yang mendahului submitted tetap diproses', !!terbitE);

cek('tidak ada event ganda untuk A', eventUntuk(a).join(',') === 'poem.published,poem.hidden,poem.published', eventUntuk(a).join(','));

await publisher.tutup();
await koneksi.close();
console.log(gagal ? `\n${gagal} pemeriksaan gagal` : '\nsemua pemeriksaan lolos');
process.exit(gagal ? 1 : 0);
