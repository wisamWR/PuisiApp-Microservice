import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { buatEvent, folderKontrak, uuidv5, validasiEvent } from '@puisiapp/events';
import { buatPenangan } from '../src/peringkat.js';
import { buatKlienRedis, buatToko } from '../src/toko.js';
import { wilson } from '../src/wilson.js';

process.env.SERVICE_NAME ??= 'ranking-worker-uji';
const NS = '5b0c2f4e-8a1d-4f7b-9e3c-2d6a9b1c7e40';
const logSenyap = { info() {}, warn() {}, error() {} };

/** Tiruan toko dengan semantik sama dengan skrip Lua (src/toko.js). */
function tokoTiruan() {
  const v = new Map();
  const c = new Map();
  const ambilC = (p) => c.get(p) ?? { up: 0, down: 0, wup: 0, wdown: 0, seq: 0, pub: null };
  return {
    async terapkan(poem, user, nilai, bobot, seq) {
      const k = `${poem}|${user}`;
      const lama = v.get(k) ?? { nilai: 0, bobot: 0, seq: 0 };
      const h = { ...ambilC(poem) };
      if (lama.seq >= seq) return { diterapkan: false, ...h };
      if (lama.nilai === 1) { h.up--; h.wup -= lama.bobot; } else if (lama.nilai === -1) { h.down--; h.wdown -= lama.bobot; }
      if (nilai === 1) { h.up++; h.wup += bobot; } else if (nilai === -1) { h.down++; h.wdown += bobot; }
      h.seq = Math.max(h.seq, seq);
      v.set(k, { nilai, bobot, seq });
      c.set(poem, h);
      return { diterapkan: true, ...h };
    },
    async klaim(poem, w, ambang, skor) {
      const h = ambilC(poem);
      const baru = `${w}|${skor}`;
      if (!h.pub) {
        c.set(poem, { ...h, pub: baru });
        return { klaim: true, sebelumnya: '' };
      }
      const [pw, ps] = h.pub.split('|').map(Number);
      if (Math.abs(w - pw) > ambang || (w === 0 && skor !== ps)) {
        c.set(poem, { ...h, pub: baru });
        return { klaim: true, sebelumnya: h.pub };
      }
      return { klaim: false, sebelumnya: h.pub };
    },
    async batalKlaim(poem, w, skor, sebelumnya) {
      const h = ambilC(poem);
      if (h.pub === `${w}|${skor}`) c.set(poem, { ...h, pub: sebelumnya || null });
    },
  };
}

const POEM = '0193b1a8-7f4e-4c2a-9d3e-5a6b7c8d9e0f';
function vote({ poem = POEM, user = 'u1', nilai = 1, lama = 0, seq = 1, bobot = 1 } = {}) {
  const id = uuidv5(`vote.cast:${poem}:${seq}`, NS);
  return buatEvent('vote.cast', poem, seq, {
    vote_id: id, poem_id: poem, user_id: user, vote_value: nilai, previous_value: lama,
    weight: bobot, sequence: seq, cast_at: new Date(Date.UTC(2026, 10, 23, 10, 0, 0, seq)).toISOString(),
  }, { eventId: id, producer: 'vote-service' });
}

test('Wilson z=1,96 sesuai contoh spesifikasi', () => {
  assert.equal(wilson(2, 0).toFixed(3), '0.342');
  assert.equal(wilson(10, 1).toFixed(3), '0.623');
  assert.equal(wilson(90, 10).toFixed(3), '0.826');
  assert.equal(wilson(0, 0), 0);
  assert.equal(wilson(0, 5), 0);
  assert.ok(wilson(90, 10) > wilson(2, 0), 'banyak suara positif mengalahkan sedikit suara positif');
});

function siapkan(gagal = 0) {
  const terbit = [];
  let sisa = gagal;
  const toko = tokoTiruan();
  const tangani = buatPenangan({
    toko,
    ambang: 0.001,
    terbitkan: async (e) => {
      if (sisa-- > 0) throw new Error('broker mati');
      validasiEvent(e);
      terbit.push(e);
    },
  });
  return { tangani, terbit, toko };
}

test('poem.score.updated terbit dengan nilai benar dan sesuai skema', async () => {
  const skema = JSON.parse(readFileSync(`${folderKontrak()}/events/poem.score.updated.v1.json`, 'utf8').replace(/^﻿/, ''));
  const ajv = new Ajv2020({ allErrors: true });
  addFormats(ajv);
  const validasi = ajv.compile(skema);

  const { tangani, terbit } = siapkan();
  await tangani(vote({ user: 'a', seq: 1 }));
  await tangani(vote({ user: 'b', seq: 2 }));
  const e = terbit.at(-1);
  assert.equal(e.event_type, 'poem.score.updated');
  assert.equal(e.aggregate_id, POEM);
  assert.equal(e.aggregate_version, 2);
  assert.deepEqual(
    { ...e.payload, updated_at: undefined },
    { poem_id: POEM, score: 2, vote_count: 2, up: 2, down: 0, wilson_score: 0.342372, updated_at: undefined },
  );
  for (const x of terbit) assert.ok(validasi(x.payload), JSON.stringify(validasi.errors));
});

test('hanya terbit bila Wilson berubah lebih dari 0,001', async () => {
  const { tangani, terbit } = siapkan();
  let seq = 0;
  for (let i = 0; i < 2000; i++) await tangani(vote({ user: `u${i}`, seq: ++seq }));
  // Wilson untuk 2000 upvote mendekati 1 dan berubah sangat sedikit per suara.
  assert.ok(terbit.length < 300, `terbit ${terbit.length} kali untuk 2000 suara`);
  const akhir = terbit.at(-1).payload.wilson_score;
  assert.ok(Math.abs(wilson(2000, 0) - akhir) <= 0.001);
});

test('selama Wilson 0, perubahan skor (hanya downvote) tetap terbit', async () => {
  const { tangani, terbit } = siapkan();
  await tangani(vote({ user: 'a', nilai: -1, seq: 1 }));
  await tangani(vote({ user: 'b', nilai: -1, seq: 2 }));
  assert.deepEqual(terbit.map((e) => e.payload.score), [-1, -2]);
});

test('ganti suara dan bobot akun baru dihitung dari kontribusi tersimpan', async () => {
  const { tangani, terbit } = siapkan();
  await tangani(vote({ user: 'baru', nilai: 1, bobot: 0.5, seq: 1 }));
  await tangani(vote({ user: 'lama', nilai: 1, seq: 2 }));
  // Akun "baru" sudah melewati 24 jam saat mengganti suara: bobot lama 0,5 yang dikurangi.
  const h = await tangani(vote({ user: 'baru', nilai: -1, lama: 1, bobot: 1, seq: 3 }));
  assert.deepEqual([h.up, h.down, h.wup, h.wdown], [1, 1, 1, 1]);
  assert.equal(terbit.at(-1).payload.score, 0);
});

test('duplikat dan suara terlambat diabaikan', async () => {
  const { tangani } = siapkan();
  await tangani(vote({ user: 'a', nilai: 1, seq: 1 }));
  await tangani(vote({ user: 'a', nilai: -1, lama: 1, seq: 3 }));
  const dup = await tangani(vote({ user: 'a', nilai: -1, lama: 1, seq: 3 }));
  const telat = await tangani(vote({ user: 'a', nilai: 1, seq: 2 }));
  assert.equal(dup.diterapkan, false);
  assert.equal(telat.diterapkan, false);
  assert.deepEqual([telat.up, telat.down], [0, 1]);
});

test('gagal terbit -> galat (retry), percobaan ulang menerbitkan event yang sama', async () => {
  const { tangani, terbit } = siapkan(1);
  const e = vote({ user: 'a', seq: 1 });
  await assert.rejects(tangani(e), /broker mati/);
  assert.equal(terbit.length, 0);
  await tangani(e); // redelivery: suara sudah diterapkan, tetapi skor tetap diterbitkan
  assert.equal(terbit.length, 1);
  assert.equal(terbit[0].payload.up, 1);
});

test('payload tidak valid -> GalatPermanen', async () => {
  const { tangani } = siapkan();
  const e = vote();
  e.payload.weight = 0;
  await assert.rejects(tangani(e), { name: 'GalatPermanen' });
});

// ------------------------------------------------ Lua terhadap Redis sungguhan
const url = process.env.REDIS_URL_UJI;
const lewati = !url && 'REDIS_URL_UJI tidak diisi';
let klien;
before(async () => {
  if (!lewati) klien = await buatKlienRedis({ url, log: logSenyap });
});
after(async () => {
  await klien?.quit();
});

test('Lua: hasil sama dengan tiruan, termasuk 1.000 suara bersamaan', { skip: lewati }, async () => {
  const toko = buatToko(klien);
  const terbit = [];
  const tangani = buatPenangan({ toko, terbitkan: async (e) => terbit.push(e) });
  const poem = randomUUID();

  await tangani(vote({ poem, user: 'baru', nilai: 1, bobot: 0.5, seq: 1 }));
  await tangani(vote({ poem, user: 'lama', nilai: 1, seq: 2 }));
  let h = await tangani(vote({ poem, user: 'baru', nilai: -1, lama: 1, bobot: 1, seq: 3 }));
  assert.deepEqual([h.up, h.down, h.wup, h.wdown], [1, 1, 1, 1]);
  assert.equal((await tangani(vote({ poem, user: 'baru', nilai: 1, seq: 2 }))).diterapkan, false);

  const poem2 = randomUUID();
  await Promise.all(
    Array.from({ length: 1000 }, (_, i) => tangani(vote({ poem: poem2, user: `u${i}`, nilai: i % 4 === 0 ? -1 : 1, bobot: i % 10 === 0 ? 0.5 : 1, seq: i + 1 }))),
  );
  h = await toko.terapkan(poem2, 'pengamat', 0, 1, 1);
  assert.deepEqual([h.up, h.down], [750, 250]);
  // 100 akun bobot 0,5 (i % 10 == 0): 50 di antaranya downvote (i % 20 == 0).
  assert.ok(Math.abs(h.wup - 725) < 1e-6 && Math.abs(h.wdown - 225) < 1e-6, `${h.wup} ${h.wdown}`);
  assert.equal(h.seq, 1000);
});
