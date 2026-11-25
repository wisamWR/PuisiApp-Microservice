/**
 * Uji beban lokal vote-service: LAJU suara per detik selama DURASI detik pada
 * satu puisi yang sudah terbit, lalu cocokkan skor di layanan dengan hitungan
 * yang diharapkan. Pengukuran resmi lewat gateway ada di T10.2.
 *
 *   BASE_URL=http://127.0.0.1:8080 POEM_ID=<uuid terbit> LAJU=200 DURASI=10 node scripts/uji-beban.js
 *
 * Langsung ke layanan (tanpa gateway), jadi header X-User-Id diisi sendiri.
 * Setiap pengguna maya memberi beberapa suara acak (naik, turun, tarik)
 * sehingga perubahan suara ikut teruji, bukan hanya suara baru.
 */
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8080';
const POEM = process.env.POEM_ID;
const LAJU = Number(process.env.LAJU ?? 200);
const DURASI = Number(process.env.DURASI ?? 10);
const PENGGUNA = Number(process.env.PENGGUNA ?? 2000);
if (!POEM) throw new Error('Isi POEM_ID dengan puisi berstatus PUBLISHED');

const RUN = Math.random().toString(36).slice(2, 8); // pengguna maya baru setiap run
const akhir = new Map(); // user -> nilai terakhir yang diterima server
const status = new Map();
const latensi = [];

async function pilih(user, nilai) {
  const t0 = performance.now();
  const r = await fetch(`${BASE}/api/poems/${POEM}/vote`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-user-id': user },
    body: JSON.stringify({ nilai }),
  });
  latensi.push(performance.now() - t0);
  status.set(r.status, (status.get(r.status) ?? 0) + 1);
  if (r.status === 200) {
    const isi = await r.json();
    if (isi.nilai !== nilai) throw new Error(`nilai balasan ${isi.nilai} != ${nilai}`);
  } else {
    await r.text();
  }
  return r.status;
}

const lihat = async () => (await fetch(`${BASE}/api/poems/${POEM}/vote`, { headers: { 'x-user-id': 'pengamat-beban' } })).json();
const awal = await lihat();

// Satu pengguna tidak boleh punya dua permintaan bersamaan, supaya "suara
// terakhir" di sisi uji jelas urutannya (di dunia nyata klien yang sama juga berurutan).
const sibuk = new Set();
const total = LAJU * DURASI;
const tugas = [];
const mulai = performance.now();
for (let i = 0; i < total; i++) {
  const target = mulai + (i * 1000) / LAJU;
  const tunggu = target - performance.now();
  if (tunggu > 0) await new Promise((r) => setTimeout(r, tunggu));
  let u;
  do u = `beban-${RUN}-${Math.floor(Math.random() * PENGGUNA)}`;
  while (sibuk.has(u));
  const nilai = [1, 1, -1, 0][Math.floor(Math.random() * 4)];
  sibuk.add(u);
  tugas.push(
    pilih(u, nilai)
      .then((s) => {
        if (s === 200) akhir.set(u, nilai);
      })
      .finally(() => sibuk.delete(u)),
  );
}
await Promise.all(tugas);
const detik = (performance.now() - mulai) / 1000;

const harapUp = [...akhir.values()].filter((v) => v === 1).length;
const harapDown = [...akhir.values()].filter((v) => v === -1).length;
const skor = await lihat();

latensi.sort((a, b) => a - b);
const p = (q) => latensi[Math.min(latensi.length - 1, Math.floor(q * latensi.length))].toFixed(1);
const ringkas = {
  permintaan: total,
  detik: Number(detik.toFixed(2)),
  laju_tercapai: Math.round(total / detik),
  status: Object.fromEntries(status),
  latensi_ms: { p50: p(0.5), p95: p(0.95), p99: p(0.99) },
  skor_awal: { skor: awal.skor, jumlah_suara: awal.jumlah_suara },
  skor_layanan: { skor: skor.skor, jumlah_suara: skor.jumlah_suara },
  skor_harapan: { skor: awal.skor + harapUp - harapDown, jumlah_suara: awal.jumlah_suara + harapUp + harapDown },
};
console.log(JSON.stringify(ringkas, null, 2));
const cocok = skor.skor === awal.skor + harapUp - harapDown && skor.jumlah_suara === awal.jumlah_suara + harapUp + harapDown;
const tanpaGalat = [...status.keys()].every((k) => k === 200);
console.log(cocok && tanpaGalat ? 'HASIL: COCOK, tanpa galat' : 'HASIL: TIDAK COCOK atau ada galat');
process.exit(cocok && tanpaGalat ? 0 : 1);
