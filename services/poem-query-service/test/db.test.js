/**
 * Uji dengan PostgreSQL (dan Redis) asli. Dilewati bila variabelnya kosong:
 *   TEST_DATABASE_URL=postgres://postgres:postgres_dev_only@localhost:5433/poem_read_uji
 *   TEST_REDIS_URL=redis://:redis_dev_only@localhost:6379
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { buatStorePg, jalankanMigrasi } from '@puisiapp/events';
import { proyeksikan, targetDari } from '../src/proyeksi.js';
import { ambilBundel, daftarPenulis, poemIdPenulis } from '../src/repo.js';
import { lihatDetail } from '../src/tampilan.js';
import { buatCache, denganInvalidasi } from '../src/cache.js';
import { buatApp } from '../src/app.js';
import { e, PEMILIK, ORANG_LAIN, PENULIS } from './bantu.js';

const URL_DB = process.env.TEST_DATABASE_URL;
const URL_REDIS = process.env.TEST_REDIS_URL;
const folderMigrasi = path.join(path.dirname(fileURLToPath(import.meta.url)), '../migrations');
const diam = { debug() {}, info() {}, warn() {}, error() {}, anak() { return diam; } };

/** Acak urutan (Fisher-Yates). */
const acak = (xs) => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

describe('read model dengan PostgreSQL', { skip: !URL_DB && 'TEST_DATABASE_URL kosong' }, () => {
  let pool;
  let store;

  before(async () => {
    const nama = new URL(URL_DB).pathname.slice(1);
    const admin = new pg.Client({ connectionString: URL_DB.replace(`/${nama}`, '/postgres') });
    await admin.connect();
    if (!(await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [nama])).rowCount) {
      await admin.query(`CREATE DATABASE "${nama}"`);
    }
    await admin.end();
    pool = new pg.Pool({ connectionString: URL_DB, max: 20 });
    await jalankanMigrasi(pool, { folder: folderMigrasi });
    store = buatStorePg(pool);
  });
  after(async () => pool?.end());
  beforeEach(async () => pool.query('TRUNCATE poem, poem_versi, penulis, processed_event'));

  const proses = (ev, s = store) =>
    s.proses(ev, async ({ tx }) => {
      await proyeksikan(tx, ev);
      return 'diproses';
    });
  const jalankan = async (events) => {
    for (const ev of events) await proses(ev);
  };
  const detail = async (id, pembaca) => lihatDetail(await ambilBundel(pool, id), pembaca);
  // submitted_at berbeda per puisi uji (dibuat berurutan); yang dibandingkan hasil proyeksinya.
  const tanpaWaktu = (d) => d && { ...d, updated_at: undefined, submitted_at: undefined };

  test('urutan kedatangan event tidak mengubah hasil akhir (20 urutan acak)', async () => {
    const buat = (id) => [
      e.diajukan(id), e.gambar(id), e.kataKunci(id), e.tema(id), e.emosi(id), e.kemiripan(id),
      e.terbit(id, 1, '2026-11-20T09:00:00.000Z'),
      e.skor(id, 4, '2026-11-20T10:00:00.000Z'), e.skor(id, 9, '2026-11-20T11:00:00.000Z'),
      e.terdaftar(), e.profil(PENULIS, 'Rinai Senja', '2026-11-20T12:00:00.000Z'),
    ];
    const acuan = randomUUID();
    await jalankan(buat(acuan));
    const harapan = tanpaWaktu(await detail(acuan, ORANG_LAIN));
    assert.equal(harapan.status, 'PUBLISHED');
    assert.equal(harapan.analysis.emotion.dominant, 'sedih');
    assert.deepEqual(harapan.analysis.originality, { level: 'original', score: 0.04 });
    assert.equal(harapan.image.width, 1080);
    assert.deepEqual(harapan.score, { value: 9, vote_count: 12 }, 'skor terbaru menang');
    assert.deepEqual(harapan.author, { id: PENULIS, username: 'rinai', display_name: 'Rinai Senja' });

    for (let i = 0; i < 20; i++) {
      const id = randomUUID();
      await jalankan(acak(buat(id)));
      const d = tanpaWaktu(await detail(id, ORANG_LAIN));
      assert.deepEqual({ ...d, poem_id: acuan, image: { ...d.image, url: harapan.image.url } }, harapan, `urutan ke-${i}`);
    }
  });

  test('revisi: orang lain tetap melihat versi terbit beserta analisisnya sampai versi baru terbit', async () => {
    const id = randomUUID();
    await jalankan([e.diajukan(id), e.tema(id, 1), e.terbit(id, 1), e.direvisi(id, 2), e.tema(id, 2)]);
    const lain = await detail(id, ORANG_LAIN);
    assert.equal(lain.version, 1);
    assert.match(lain.body, /v1/);
    const milik = await detail(id, PEMILIK);
    assert.equal(milik.status, 'REPROCESSING');
    assert.equal(milik.version, 2);
    assert.match(milik.body, /v2/);

    await proses(e.terbit(id, 2));
    const baru = await detail(id, ORANG_LAIN);
    assert.equal(baru.version, 2);
    assert.equal((await detail(id, PEMILIK)).status, 'PUBLISHED');
  });

  test('event status yang lebih lama diabaikan', async () => {
    const id = randomUUID();
    await jalankan([
      e.diajukan(id),
      e.disembunyikan(id, 1, '2026-11-21T00:00:00.000Z'),
      e.terbit(id, 1, '2026-11-20T00:00:00.000Z'), // tiba belakangan tetapi lebih lama
    ]);
    assert.equal(await detail(id, ORANG_LAIN), null);
    assert.equal((await detail(id, PEMILIK)).status, 'HIDDEN');
  });

  test('DELETED final dan hilang dari detail maupun daftar', async () => {
    const id = randomUUID();
    await jalankan([e.diajukan(id), e.terbit(id, 1), e.dihapus(id, 1), e.terbit(id, 1, '2099-01-01T00:00:00.000Z')]);
    assert.equal(await detail(id, PEMILIK), null);
    assert.equal(await detail(id, ORANG_LAIN), null);
    const { total } = await daftarPenulis(pool, { authorId: PENULIS, semua: true, page: 1, size: 20 });
    assert.equal(total, 0);
  });

  test('profil yang lebih baru tidak ditimpa user.registered yang terlambat', async () => {
    const id = randomUUID();
    await jalankan([e.diajukan(id), e.terbit(id), e.profil(PENULIS, 'Nama Baru'), e.terdaftar()]);
    assert.deepEqual((await detail(id, ORANG_LAIN)).author, { id: PENULIS, username: 'rinai', display_name: 'Nama Baru' });
  });

  test('daftar penulis: penulis melihat semua status, orang lain hanya terbit, dengan halaman', async () => {
    const [a, b, c] = [randomUUID(), randomUUID(), randomUUID()];
    await jalankan([e.diajukan(a), e.diajukan(b), e.diajukan(c), e.terbit(a), e.ditahan(b)]);
    const milik = await daftarPenulis(pool, { authorId: PENULIS, semua: true, page: 1, size: 2 });
    assert.equal(milik.total, 3);
    assert.equal(milik.baris.length, 2);
    const kedua = await daftarPenulis(pool, { authorId: PENULIS, semua: true, page: 2, size: 2 });
    assert.equal(kedua.baris.length, 1);
    const lain = await daftarPenulis(pool, { authorId: PENULIS, semua: false, page: 1, size: 20 });
    assert.deepEqual(lain.baris.map((r) => r.poem_id), [a]);
  });

  test('event yang sama dikirim ulang: duplikat', async () => {
    const ev = e.diajukan(randomUUID());
    assert.equal(await proses(ev), 'diproses');
    assert.equal(await proses(ev), 'duplikat');
  });

  test('invalidasi cache setelah commit: poem.* hapus satu puisi, user.* semua puisi penulis', async () => {
    const dihapus = [];
    const s = denganInvalidasi(store, {
      cache: { hapus: async (ids) => dihapus.push(...ids) },
      log: diam,
      targetDari: async (ev) => {
        const t = targetDari(ev);
        return t.poemId ? [t.poemId] : poemIdPenulis(pool, t.userId);
      },
    });
    const [a, b] = [randomUUID(), randomUUID()];
    await proses(e.diajukan(a), s);
    await proses(e.diajukan(b), s);
    assert.deepEqual(dihapus, [a, b]);
    dihapus.length = 0;
    const ulang = e.profil(PENULIS, 'Nama Lain');
    await proses(ulang, s);
    assert.deepEqual(new Set(dihapus), new Set([a, b]));
    dihapus.length = 0;
    await proses(ulang, s);
    assert.deepEqual(dihapus, [], 'duplikat tidak menghapus cache');
  });

  describe('dengan Redis', { skip: !URL_REDIS && 'TEST_REDIS_URL kosong' }, () => {
    let cache;
    before(async () => {
      cache = await buatCache({ url: URL_REDIS, log: diam, ttlDetik: 30 });
      for (let i = 0; i < 50 && !cache.siap(); i++) await new Promise((r) => setTimeout(r, 100));
      assert.ok(cache.siap(), 'Redis tidak bisa dihubungi');
    });
    after(async () => cache?.tutup());

    test('hit ratio cache detail minimal 80% pada 1.000 baca berulang (INFO stats)', async () => {
      const id = randomUUID();
      await jalankan([e.diajukan(id), e.terbit(id)]);
      await cache.hapus([id]);
      const app = buatApp({
        ambilBundel: (x) => ambilBundel(pool, x),
        daftarPenulis: (q) => daftarPenulis(pool, q),
        cache,
        cekSiap: async () => {},
        log: diam,
      });
      const awal = await cache.statistik();
      for (let i = 0; i < 1000; i++) {
        const r = await app.inject({ method: 'GET', url: `/api/poems/${id}`, headers: { 'x-user-id': 'u-lain' } });
        assert.equal(r.statusCode, 200);
      }
      const akhir = await cache.statistik();
      const hits = akhir.hits - awal.hits;
      const misses = akhir.misses - awal.misses;
      const rasio = hits / (hits + misses);
      assert.ok(rasio >= 0.8, `hit ratio ${rasio}`);
      assert.ok(hits >= 999);
    });

    test('event mengubah puisi: cache dihapus, baca berikutnya MISS dengan data baru', async () => {
      const id = randomUUID();
      await jalankan([e.diajukan(id), e.terbit(id)]);
      await cache.simpan(id, await ambilBundel(pool, id));
      assert.ok(await cache.ambil(id));
      const s = denganInvalidasi(store, { cache, log: diam, targetDari: (ev) => [targetDari(ev).poemId] });
      await proses(e.disembunyikan(id), s);
      assert.equal(await cache.ambil(id), undefined);
    });
  });
});
