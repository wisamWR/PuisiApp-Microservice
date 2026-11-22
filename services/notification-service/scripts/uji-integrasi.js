/**
 * Uji integrasi T2.8 lewat gateway dengan layanan asli: poem-create (T2.1),
 * publication-service (T2.2), poem-query (T2.3), image-render-worker (T2.5),
 * processing-tracker (T2.7). Hasil worker kelompok lain dikirim palsu.
 *
 *   GATEWAY_URL=http://localhost:8080 node scripts/uji-integrasi.js
 *
 * Memeriksa:
 *   1. puisi terbit -> notifikasi "sudah terbit" untuk penulisnya
 *   2. semua langkah selesai (processing-tracker asli) -> notifikasi "analisis selesai"
 *   3. puisi ditahan -> notifikasi "ditahan"; Puisi Saya menampilkan HELD beserta alasannya
 *   4. event yang sama dikirim dua kali -> notifikasi tidak bertambah
 *   5. badge (unread-count), tandai dibaca, tandai semua dibaca
 */
import { randomUUID } from 'node:crypto';
import { buatEvent, buatPublisher, hubungkan } from '@puisiapp/events';
import { sesiUji } from '@puisiapp/poem-common';

const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:8080';
process.env.RABBITMQ_HOST = process.env.RABBITMQ_HOST_LOKAL ?? 'localhost';
process.env.RABBITMQ_USER ??= 'puisiApp';
process.env.RABBITMQ_PASS ??= 'puisiApp_dev_only';
process.env.RABBITMQ_VHOST ??= 'puisiApp';
process.env.SERVICE_NAME = 'uji-integrasi-notifikasi';

let gagal = 0;
const cek = (nama, kondisi, info = '') => {
  console.log(`${kondisi ? 'OK   ' : 'GAGAL'} ${nama}${info ? `  (${info})` : ''}`);
  if (!kondisi) gagal++;
};
const jeda = (ms) => new Promise((r) => setTimeout(r, ms));
async function tunggu(f, ms = 30_000) {
  const akhir = Date.now() + ms;
  for (;;) {
    const hasil = await f();
    if (hasil || Date.now() > akhir) return hasil;
    await jeda(400);
  }
}

const sesi = await sesiUji(GATEWAY, { log: (m) => console.log(`(sesi) ${m}`) });
const minta = async (method, path) => {
  const r = await fetch(`${GATEWAY}${path}`, { method, headers: { cookie: sesi.cookie } });
  return { status: r.status, json: r.status < 300 ? await r.json() : null };
};
const notifikasiPuisi = async (poemId) =>
  (await minta('GET', '/api/notifications?size=50')).json?.items.filter((n) => n.poem_id === poemId) ?? [];

// Tangkap poem.published asli untuk diuji kirim ulang.
const koneksi = await hubungkan({ keluarSaatPutus: false, log: { info() {}, warn() {}, error: console.error } });
const ch = await koneksi.createChannel();
const { queue } = await ch.assertQueue('', { exclusive: true, autoDelete: true });
await ch.bindQueue(queue, 'poem.events', 'poem.published');
const terbitAsli = [];
await ch.consume(queue, (m) => {
  terbitAsli.push(JSON.parse(m.content.toString('utf8')));
  ch.ack(m);
});
const publisher = await buatPublisher(koneksi);
const kirim = (tipe, id, payload) => publisher.terbitkan(buatEvent(tipe, id, 1, payload, { producer: 'worker-palsu' }));

async function ajukan(judul) {
  const r = await fetch(`${GATEWAY}/api/poems`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': `uji-${randomUUID()}`, cookie: sesi.cookie },
    body: JSON.stringify({ title: judul, body: 'baris satu\nbaris dua\n\nbait kedua', quote_stanza: 0, template_id: 'latar1' }),
  });
  cek(`POST "${judul}" -> 202`, r.status === 202, `status ${r.status}`);
  return (await r.json()).poem_id;
}

const awal = (await minta('GET', '/api/notifications/unread-count')).json?.unread ?? 0;

// ---- 1 dan 2: terbit dan pemrosesan selesai
const a = await ajukan('Uji Notifikasi Terbit');
await jeda(1500);
await kirim('poem.emotion.analyzed', a, { poem_id: a, emotions: [{ line_number: 1, label: 'senang', score: 0.8 }] });
await kirim('poem.themes.extracted', a, { poem_id: a, themes: ['alam'] });
await kirim('poem.keywords.extracted', a, { poem_id: a, keywords: ['baris'] });
await kirim('authorship.recorded', a, { poem_id: a, version: 1, content_hash: 'b'.repeat(64), algorithm: 'SHA-256' });
await kirim('poem.similarity.scored', a, { poem_id: a, score: 0.04, level: 'original', comparisons: [] });
const nTerbit = await tunggu(async () => (await notifikasiPuisi(a)).find((n) => n.type === 'poem_published'));
cek('penulis menerima notifikasi "sudah terbit"', !!nTerbit, nTerbit?.message);
const nSelesai = await tunggu(async () => (await notifikasiPuisi(a)).find((n) => n.type === 'processing_completed'));
cek('notifikasi "analisis selesai" dari processing-tracker asli', !!nSelesai, nSelesai?.title);

// ---- 3: ditahan + Puisi Saya
const b = await ajukan('Uji Notifikasi Ditahan');
await jeda(1500);
await kirim('poem.similarity.scored', b, { poem_id: b, score: 0.93, level: 'suspected_plagiarism', comparisons: [{ compared_poem_id: a, score: 0.93 }] });
const nTahan = await tunggu(async () => (await notifikasiPuisi(b)).find((n) => n.type === 'poem_held'));
cek('penulis menerima notifikasi "ditahan"', !!nTahan, nTahan?.message);
const saya = await tunggu(async () => {
  const r = await minta('GET', '/api/me/poems?status=HELD');
  return r.json?.items.find((p) => p.poem_id === b) ? r : null;
});
const ditahan = saya?.json?.items.find((p) => p.poem_id === b);
cek('Puisi Saya menampilkan puisi ditahan beserta alasannya', ditahan?.status === 'HELD' && /0.93/.test(ditahan?.status_reason ?? ''), ditahan?.status_reason);
cek('Puisi Saya menghitung per status', (saya?.json?.counts?.HELD ?? 0) >= 1, JSON.stringify(saya?.json?.counts));

// ---- 4: kirim ulang event yang sama
await tunggu(async () => terbitAsli.find((ev) => ev.aggregate_id === a), 5000);
const asli = terbitAsli.find((ev) => ev.aggregate_id === a);
const sebelum = (await notifikasiPuisi(a)).length;
await publisher.terbitkan(asli);
await publisher.terbitkan(asli);
await jeda(3000);
cek('event yang sama dikirim dua kali: notifikasi tidak bertambah', (await notifikasiPuisi(a)).length === sebelum, `${sebelum} -> ${(await notifikasiPuisi(a)).length}`);

// ---- 5: badge dan tandai dibaca
const belum = (await minta('GET', '/api/notifications/unread-count')).json?.unread;
cek('badge belum dibaca bertambah', belum >= awal + 3, `${awal} -> ${belum}`);
const baca = await minta('POST', `/api/notifications/${nTerbit?.id}/read`);
cek('tandai satu dibaca', baca.status === 200 && baca.json?.notification?.read === true && baca.json.unread === belum - 1);
const semua = await minta('POST', '/api/notifications/read-all');
cek('tandai semua dibaca', semua.status === 200 && (await minta('GET', '/api/notifications/unread-count')).json?.unread === 0);
cek('notifikasi milik orang lain tidak bisa ditandai', (await minta('POST', `/api/notifications/${randomUUID()}/read`)).status === 404);
cek('tanpa login: 401', (await fetch(`${GATEWAY}/api/notifications`)).status === 401);

await publisher.tutup();
await koneksi.close();
console.log(gagal ? `\n${gagal} pemeriksaan gagal` : '\nsemua pemeriksaan lolos');
process.exit(gagal ? 1 : 0);
