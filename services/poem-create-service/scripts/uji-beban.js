/**
 * Uji beban lokal POST /api/poems lewat gateway (kriteria T2.1: p95 < 500 ms).
 * Pengukuran resmi ada di T10.2; ini hanya pemeriksaan lokal.
 *
 *   node scripts/uji-beban.js [jumlah=500] [konkurensi=20]
 *
 * Setiap permintaan memakai Idempotency-Key unik sehingga semuanya membuat
 * puisi baru (jalur terberat: INSERT submission + INSERT outbox + COMMIT).
 */
import { randomUUID } from 'node:crypto';

const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:8080';
const jumlah = Number(process.argv[2] ?? 500);
const konkurensi = Number(process.argv[3] ?? 20);
const BATAS_P95_MS = 500;

const bodyPuisi = JSON.stringify({
  title: 'Uji beban',
  body: 'hujan turun pelan\nmengetuk kaca jendela\n\nkusimpan namamu\ndi saku jaket yang basah\n\nesok mungkin cerah',
  quote_stanza: 1,
  template_id: 'latar1',
});

const durasi = [];
const status = new Map();
let berikutnya = 0;

async function pekerja() {
  while (berikutnya < jumlah) {
    berikutnya++;
    const t = performance.now();
    const r = await fetch(`${GATEWAY}/api/poems`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': `beban-${randomUUID()}`,
        cookie: 'access_token=dev',
      },
      body: bodyPuisi,
    });
    await r.arrayBuffer();
    durasi.push(performance.now() - t);
    status.set(r.status, (status.get(r.status) ?? 0) + 1);
  }
}

// pemanasan agar koneksi pool dan JIT siap
for (let i = 0; i < 10; i++) {
  await fetch(`${GATEWAY}/api/poems`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': `hangat-${randomUUID()}`, cookie: 'access_token=dev' },
    body: bodyPuisi,
  }).then((r) => r.arrayBuffer());
}

const mulai = performance.now();
await Promise.all(Array.from({ length: konkurensi }, pekerja));
const total = (performance.now() - mulai) / 1000;

durasi.sort((a, b) => a - b);
const persentil = (p) => durasi[Math.min(durasi.length - 1, Math.ceil((p / 100) * durasi.length) - 1)];
const hasil = {
  permintaan: durasi.length,
  konkurensi,
  throughput_rps: Math.round(durasi.length / total),
  p50_ms: Math.round(persentil(50)),
  p95_ms: Math.round(persentil(95)),
  p99_ms: Math.round(persentil(99)),
  maks_ms: Math.round(durasi.at(-1)),
  status: Object.fromEntries(status),
};
console.table(hasil);
const lolos = hasil.p95_ms < BATAS_P95_MS && (status.get(202) ?? 0) === durasi.length;
console.log(lolos ? `p95 ${hasil.p95_ms} ms < ${BATAS_P95_MS} ms: LOLOS` : 'GAGAL');
process.exit(lolos ? 0 : 1);
