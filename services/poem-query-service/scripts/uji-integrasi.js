/**
 * Uji integrasi T2.3 dengan event asli dari T2.1 (poem-create + outbox relay),
 * T2.2 (publication-service), dan T2.5 (image-render-worker). Event milik
 * kelompok lain yang belum ada (analisis, skor suara, akun) dikirim palsu.
 *
 * Dijalankan di dalam container supaya bisa memanggil poem-create dan
 * poem-query langsung sebagai beberapa pengguna (stub auth gateway selalu
 * memberi "stub-user"):
 *
 *   docker compose exec poem-query-service node scripts/uji-integrasi.js
 *
 * Memeriksa:
 *   1. poem.submitted asli -> detail PROCESSING untuk penulis, 404 untuk orang lain
 *   2. poem.image.rendered asli -> gambar muncul
 *   3. analisis + skor kemiripan -> publication-service menerbitkan -> semua
 *      hasil analisis terlihat orang lain
 *   4. cache: baca setelah perubahan MISS lalu HIT; event baru menghapus cache
 *   5. HIDE -> poem.hidden asli -> orang lain 404, penulis HIDDEN, hilang dari daftar
 *   6. hit ratio Redis >= 80% pada 1.000 baca berulang (INFO stats)
 */
import { randomUUID } from 'node:crypto';
import { buatEvent, buatPublisher, hubungkan } from '@puisiapp/events';
import { buatCache } from '../src/cache.js';

const CREATE = process.env.POEM_CREATE_URL ?? 'http://poem-create-service:8080';
const QUERY = process.env.POEM_QUERY_URL ?? 'http://127.0.0.1:8080';
const BATAS_MS = Number(process.env.BATAS_MS) || 30_000;
process.env.SERVICE_NAME = 'uji-integrasi-poem-query';

let gagal = 0;
const cek = (nama, kondisi, info = '') => {
  console.log(`${kondisi ? 'OK   ' : 'GAGAL'} ${nama}${info ? `  (${info})` : ''}`);
  if (!kondisi) gagal++;
};
const jeda = (ms) => new Promise((r) => setTimeout(r, ms));
const diam = { info() {}, warn() {}, error: console.error };

const koneksi = await hubungkan({ keluarSaatPutus: false, log: diam });
const publisher = await buatPublisher(koneksi);
const kirim = (tipe, aggId, versi, payload, producer) =>
  publisher.terbitkan(buatEvent(tipe, aggId, versi, payload, { producer }));

const baca = async (id, user) => {
  const r = await fetch(`${QUERY}/api/poems/${id}`, { headers: { 'x-user-id': user, 'x-user-role': 'writer' } });
  return { status: r.status, cache: r.headers.get('x-cache'), json: r.status === 200 ? await r.json() : null };
};
async function tunggu(id, user, syarat, batas = BATAS_MS) {
  const akhir = Date.now() + batas;
  let r;
  while (Date.now() < akhir) {
    r = await baca(id, user);
    if (syarat(r)) return r;
    await jeda(300);
  }
  return r;
}

async function ajukan(penulis, judul) {
  const r = await fetch(`${CREATE}/api/poems`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': `uji-${randomUUID()}`, 'x-user-id': penulis },
    body: JSON.stringify({
      title: judul,
      body: 'sore turun tanpa permisi\nhujan mengetuk kaca\n\nseperti nama yang tak jadi kupanggil',
      quote_stanza: 0,
      template_id: 'latar2',
      keywords: ['hujan'],
    }),
  });
  cek(`POST ${judul} -> 202`, r.status === 202, `status ${r.status}`);
  return (await r.json()).poem_id;
}

const penulis = `uji-${randomUUID().slice(0, 8)}`;
const lain = 'pembaca-lain';
await kirim('user.registered', penulis, 1, { username: penulis.slice(0, 50), email: `${penulis}@contoh.id` }, 'register-palsu');
await kirim('user.profile.updated', penulis, 2, { display_name: 'Penulis Uji', bio: 'uji integrasi' }, 'profile-palsu');

// ---- 1. submitted asli
const a = await ajukan(penulis, 'Uji Query A');
const proses = await tunggu(a, penulis, (r) => r.status === 200);
cek('penulis melihat puisinya PROCESSING', proses.json?.status === 'PROCESSING', proses.json?.status);
cek('isi dari poem.submitted asli', proses.json?.title === 'Uji Query A' && proses.json?.quote?.text?.startsWith('sore'));
cek('nama penulis dari event akun', proses.json?.author?.display_name === 'Penulis Uji', JSON.stringify(proses.json?.author));
cek('orang lain: 404 selama PROCESSING', (await baca(a, lain)).status === 404);

// ---- 2. gambar asli dari image-render-worker
const bergambar = await tunggu(a, penulis, (r) => r.json?.image != null);
cek('gambar kutipan dari poem.image.rendered asli', !!bergambar.json?.image?.url, bergambar.json?.image?.url);

// ---- 3. analisis palsu + skor kemiripan -> publication-service -> poem.published asli
await kirim('poem.keywords.extracted', a, 1, { poem_id: a, keywords: ['hujan', 'kaca'] }, 'keyword-worker-palsu');
await kirim('poem.themes.extracted', a, 1, { poem_id: a, themes: ['rindu', 'alam'] }, 'theme-worker-palsu');
await kirim('poem.emotion.analyzed', a, 1, {
  poem_id: a,
  emotions: [
    { line_number: 1, label: 'sedih', score: 0.7 },
    { line_number: 2, label: 'sedih', score: 0.6 },
    { line_number: 4, label: 'cinta', score: 0.8 },
  ],
}, 'emotion-worker-palsu');
await kirim('poem.similarity.scored', a, 1, { poem_id: a, score: 0.05, level: 'original', comparisons: [] }, 'similarity-worker-palsu');
await kirim('poem.score.updated', a, 1, { poem_id: a, score: 7, vote_count: 9, updated_at: new Date().toISOString() }, 'ranking-palsu');

const terbit = await tunggu(a, lain, (r) => r.status === 200 && r.json?.analysis?.emotion && r.json?.score?.value === 7);
const d = terbit.json;
cek('orang lain melihat setelah PUBLISHED', terbit.status === 200 && d?.status === 'PUBLISHED', `status ${terbit.status}`);
cek('detail memuat semua hasil analisis',
  d?.analysis?.keywords?.length === 2 && d?.analysis?.themes?.length === 2 &&
  d?.analysis?.emotion?.dominant === 'sedih' && d?.analysis?.originality?.level === 'original' && !!d?.image,
  JSON.stringify(d?.analysis));
cek('skor suara', d?.score?.value === 7 && d?.score?.vote_count === 9);
cek('published_at terisi', !!d?.published_at);

// ---- 4. cache
const c1 = await baca(a, lain);
const c2 = await baca(a, lain);
cek('baca berulang dari cache (HIT)', c1.cache === 'HIT' || c2.cache === 'HIT', `${c1.cache},${c2.cache}`);
await kirim('poem.score.updated', a, 1, { poem_id: a, score: 8, vote_count: 10, updated_at: new Date().toISOString() }, 'ranking-palsu');
const segar = await tunggu(a, lain, (r) => r.json?.score?.value === 8, 5000);
cek('event baru menghapus cache: skor baru langsung terlihat', segar.json?.score?.value === 8, `x-cache ${segar.cache}`);

// ---- 5. HIDE -> poem.hidden asli
await kirim('case.decided', randomUUID(), 1, {
  case_id: randomUUID(), poem_id: a, moderator_id: 'moderator-palsu', decision: 'HIDE',
  reason: 'uji integrasi', decided_at: new Date().toISOString(),
}, 'case-decision-palsu');
const sembunyi = await tunggu(a, lain, (r) => r.status === 404);
cek('HIDDEN: orang lain 404', sembunyi.status === 404);
cek('HIDDEN: penulis tetap melihat statusnya', (await baca(a, penulis)).json?.status === 'HIDDEN');
const daftarLain = await (await fetch(`${QUERY}/api/poems?author=${penulis}`, { headers: { 'x-user-id': lain } })).json();
const daftarMilik = await (await fetch(`${QUERY}/api/poems?author=${penulis}`, { headers: { 'x-user-id': penulis } })).json();
cek('daftar orang lain tanpa puisi tersembunyi', daftarLain.total === 0, JSON.stringify(daftarLain));
cek('daftar penulis memuat statusnya', daftarMilik.items?.[0]?.status === 'HIDDEN', JSON.stringify(daftarMilik.items?.[0]?.status));

// ---- 6. hit ratio
const b = await ajukan(penulis, 'Uji Query B');
await jeda(1500);
await kirim('poem.similarity.scored', b, 1, { poem_id: b, score: 0.3, level: 'inspired', comparisons: [] }, 'similarity-worker-palsu');
await tunggu(b, lain, (r) => r.status === 200);
await jeda(1500); // tunggu event lain untuk B (gambar) supaya tidak menghapus cache di tengah pengukuran
const cache = await buatCache({ log: diam });
for (let i = 0; i < 50 && !cache.siap(); i++) await jeda(100);
const awal = await cache.statistik();
let ok = 0;
for (let i = 0; i < 1000; i++) if ((await baca(b, lain)).status === 200) ok++;
const akhir = await cache.statistik();
const hits = akhir.hits - awal.hits;
const misses = akhir.misses - awal.misses;
const rasio = hits / (hits + misses);
cek('1.000 baca berhasil', ok === 1000, `${ok}`);
cek('hit ratio cache >= 80%', rasio >= 0.8, `hits ${hits}, misses ${misses}, rasio ${rasio.toFixed(3)}`);

await cache.tutup();
await publisher.tutup();
await koneksi.close();
console.log(gagal ? `\n${gagal} pemeriksaan gagal` : '\nsemua pemeriksaan lolos');
process.exit(gagal ? 1 : 0);
