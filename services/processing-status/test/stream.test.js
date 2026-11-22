/**
 * status-stream-service dengan Redis asli: dua replika (dua instance app
 * dengan subscriber masing-masing), hak akses pemilik, sambung ulang.
 * Dilewati bila TEST_REDIS_URL kosong.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buatKeadaan, buatKlienRedis } from '../src/keadaan.js';
import { buatPelanggan } from '../src/pelanggan.js';
import { buatAppStream } from '../src/stream-app.js';
import { buatHandlerTracker } from '../src/handler-tracker.js';
import { e, diam, PENULIS } from './bantu.js';

process.env.SERVICE_NAME = 'processing-tracker';
const URL = process.env.TEST_REDIS_URL;
const LANGKAH = ['emotion', 'image'];

/** Baca event SSE dari fetch streaming. */
async function buka(base, poemId, user = PENULIS) {
  const ac = new AbortController();
  const r = await fetch(`${base}/api/poems/${poemId}/status/stream`, {
    headers: { 'x-user-id': user, 'x-user-role': 'writer' },
    signal: ac.signal,
  });
  const snapshot = [];
  let teks = '';
  if (r.status === 200) {
    (async () => {
      const dec = new TextDecoder();
      try {
        for await (const bagian of r.body) {
          teks += dec.decode(bagian, { stream: true });
          let i;
          while ((i = teks.indexOf('\n\n')) >= 0) {
            const blok = teks.slice(0, i);
            teks = teks.slice(i + 2);
            const data = blok.split('\n').find((l) => l.startsWith('data: '));
            if (data) snapshot.push(JSON.parse(data.slice(6)));
          }
        }
      } catch {
        /* dibatalkan */
      }
    })();
  }
  return { status: r.status, headers: r.headers, snapshot, tutup: () => ac.abort() };
}

const tunggu = async (syarat, ms = 3000) => {
  const akhir = Date.now() + ms;
  while (!syarat() && Date.now() < akhir) await new Promise((r) => setTimeout(r, 30));
  return syarat();
};

describe('status-stream-service dengan Redis', { skip: !URL && 'TEST_REDIS_URL kosong' }, () => {
  const klien = [];
  const replika = [];
  let proses;

  before(async () => {
    const redisTracker = buatKlienRedis(URL);
    await redisTracker.connect();
    klien.push(redisTracker);
    const tangani = buatHandlerTracker({
      keadaan: buatKeadaan(redisTracker, { langkah: LANGKAH, ttlDetik: 600 }),
      publisher: { terbitkan: async () => {} },
      langkah: LANGKAH,
    });
    proses = (ev) => tangani(ev, { log: diam });

    for (let i = 0; i < 2; i++) {
      const redis = buatKlienRedis(URL);
      await redis.connect();
      const sub = redis.duplicate();
      await sub.connect();
      klien.push(redis, sub);
      const s = buatAppStream({
        keadaan: buatKeadaan(redis, { langkah: LANGKAH }),
        pelanggan: buatPelanggan(sub),
        cekSiap: async () => {},
        log: diam,
        tungguPemilikMs: 1500,
      });
      await s.app.listen({ host: '127.0.0.1', port: 0 });
      replika.push({ ...s, base: `http://127.0.0.1:${s.app.server.address().port}` });
    }
  });

  after(async () => {
    for (const r of replika) {
      r.tutupSemua();
      await r.app.close();
    }
    for (const k of klien) await k.close().catch(() => {});
  });

  test('dua replika: setiap langkah tercentang di kedua koneksi tanpa refresh', async () => {
    const id = randomUUID();
    await proses(e.diajukan(id));
    const a = await buka(replika[0].base, id);
    const b = await buka(replika[1].base, id);
    assert.equal(a.status, 200);
    assert.match(a.headers.get('content-type'), /text\/event-stream/);
    assert.equal(a.headers.get('x-accel-buffering'), 'no');
    assert.ok(await tunggu(() => a.snapshot.length >= 1 && b.snapshot.length >= 1), 'snapshot awal');
    assert.equal(a.snapshot[0].steps_done, 0);

    await proses(e.emosi(id));
    await proses(e.gambar(id));
    await proses(e.terbit(id));
    for (const k of [a, b]) {
      assert.ok(await tunggu(() => k.snapshot.at(-1)?.publication === 'PUBLISHED'), 'perubahan terakhir tiba');
      assert.deepEqual(k.snapshot.at(-1).steps.map((s) => s.done), [true, true]);
      assert.equal(k.snapshot.at(-1).status, 'COMPLETED');
      const urut = k.snapshot.map((s) => s.steps_done);
      assert.deepEqual(urut, [...urut].sort((x, y) => x - y), 'langkah tidak pernah mundur');
    }
    a.tutup();
    b.tutup();
  });

  test('sambung ulang setelah terputus: langsung mendapat status terkini', async () => {
    const id = randomUUID();
    await proses(e.diajukan(id));
    const pertama = await buka(replika[0].base, id);
    assert.ok(await tunggu(() => pertama.snapshot.length >= 1));
    pertama.tutup(); // koneksi putus
    await proses(e.emosi(id)); // terjadi selama terputus
    const kedua = await buka(replika[1].base, id); // tersambung ke replika lain
    assert.ok(await tunggu(() => kedua.snapshot.length >= 1));
    assert.equal(kedua.snapshot[0].steps_done, 1);
    kedua.tutup();
  });

  test('bukan pemilik dan puisi tak dikenal: 404; tanpa identitas: 401', async () => {
    const id = randomUUID();
    await proses(e.diajukan(id));
    assert.equal((await buka(replika[0].base, id, 'orang-lain')).status, 404);
    assert.equal((await buka(replika[0].base, randomUUID())).status, 404);
    const r = await fetch(`${replika[0].base}/api/poems/${id}/status/stream`);
    assert.equal(r.status, 401);
  });

  test('stream dibuka sebelum tracker memproses poem.submitted: menunggu pemilik', async () => {
    const id = randomUUID();
    setTimeout(() => proses(e.diajukan(id)), 400);
    const k = await buka(replika[0].base, id);
    assert.equal(k.status, 200);
    assert.ok(await tunggu(() => k.snapshot.length >= 1));
    k.tutup();
  });

  test('langganan dilepas saat penonton terakhir pergi', async () => {
    const id = randomUUID();
    await proses(e.diajukan(id));
    const k1 = await buka(replika[0].base, id);
    const k2 = await buka(replika[0].base, id);
    assert.ok(await tunggu(() => replika[0].jumlahTerbuka() >= 2), `terbuka ${replika[0].jumlahTerbuka()}`);
    k1.tutup();
    k2.tutup();
    assert.ok(await tunggu(() => replika[0].jumlahTerbuka() === 0), `masih terbuka ${replika[0].jumlahTerbuka()}`);
  });
});
