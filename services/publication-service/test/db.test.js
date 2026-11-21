/**
 * Uji dengan PostgreSQL asli: handler + store idempoten + outbox, dan
 * optimistic locking untuk event bersamaan pada puisi yang sama.
 *
 * Dilewati bila TEST_DATABASE_URL kosong. Contoh (stack dev, superuser):
 *   TEST_DATABASE_URL=postgres://postgres:postgres_dev_only@localhost:5433/publication_uji
 * Basis data dibuat otomatis bila belum ada, dan tabel dikosongkan setiap uji.
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { buatStorePg, jalankanMigrasi } from '@puisiapp/events';
import { buatHandler } from '../src/handler.js';
import { ambil, simpan, GalatKonflik } from '../src/repo.js';
import { diajukan, direvisi, dinilai, diputuskan, dihapus, keadaan, sekarang } from './bantu.js';

process.env.SERVICE_NAME = 'publication-service';
const URL = process.env.TEST_DATABASE_URL;
const folderMigrasi = path.join(path.dirname(fileURLToPath(import.meta.url)), '../migrations');
const diam = { debug() {}, info() {}, warn() {}, error() {}, anak() { return diam; } };

describe('publication-service dengan PostgreSQL', { skip: !URL && 'TEST_DATABASE_URL kosong' }, () => {
  let pool;
  const handler = buatHandler({ sekarang });

  before(async () => {
    const u = new globalThis.URL(URL);
    const nama = u.pathname.slice(1);
    const admin = new pg.Client({ connectionString: URL.replace(`/${nama}`, '/postgres') });
    await admin.connect();
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [nama]);
    if (!rowCount) await admin.query(`CREATE DATABASE "${nama}"`);
    await admin.end();
    pool = new pg.Pool({ connectionString: URL, max: 30 });
    await jalankanMigrasi(pool, { folder: folderMigrasi, outbox: true });
  });
  after(async () => pool?.end());
  beforeEach(async () => pool.query('TRUNCATE publication, processed_event, outbox'));

  /** Jalankan satu event lewat store + handler seperti konsumen asli. */
  const proses = (event, store = buatStorePg(pool)) =>
    store.proses(event, async (ctx) => {
      await handler(event, { ...ctx, log: diam });
      return 'diproses';
    });

  const outbox = async (poemId) =>
    (await pool.query(
      'SELECT event_type, payload FROM outbox WHERE aggregate_id = $1 ORDER BY created_at, event_type',
      [poemId],
    )).rows;

  test('submitted -> skor original: status PUBLISHED dan poem.published di outbox dalam satu transaksi', async () => {
    const poemId = randomUUID();
    assert.equal(await proses(diajukan(poemId)), 'diproses');
    assert.equal((await ambil(pool, poemId)).status, 'PROCESSING');
    assert.deepEqual(await outbox(poemId), []);

    const skor = dinilai(1, 'original', 0.05, poemId);
    await proses(skor);
    const k = await ambil(pool, poemId);
    assert.equal(k.status, 'PUBLISHED');
    assert.equal(k.versi_tampil, 1);
    assert.equal(k.skor_kemiripan, 0.05);
    assert.equal(k.row_version, 2);

    const keluar = await outbox(poemId);
    assert.equal(keluar.length, 1);
    assert.equal(keluar[0].event_type, 'poem.published');
    assert.equal(keluar[0].payload.aggregate_version, 1);
    assert.equal(keluar[0].payload.causation_id, skor.event_id);

    assert.equal(await proses(skor), 'duplikat', 'event yang sama dikirim ulang tidak diproses dua kali');
    assert.equal((await outbox(poemId)).length, 1);
  });

  test('event ditunda (skor sebelum submitted) tidak meninggalkan jejak dan bisa diproses ulang', async () => {
    const poemId = randomUUID();
    const skor = dinilai(1, 'original', 0.05, poemId);
    await assert.rejects(proses(skor), { name: 'GalatTunda' });
    const { rowCount } = await pool.query('SELECT 1 FROM processed_event WHERE event_id = $1', [skor.event_id]);
    assert.equal(rowCount, 0, 'processed_event ikut di-rollback, jadi retry tidak dianggap duplikat');

    await proses(diajukan(poemId));
    assert.equal(await proses(skor), 'diproses');
    assert.equal((await ambil(pool, poemId)).status, 'PUBLISHED');
  });

  test('transisi tidak sah ditolak: status dan outbox tidak berubah, event tetap dicatat', async () => {
    const poemId = randomUUID();
    await proses(diajukan(poemId));
    const kasus = diputuskan('APPROVE', undefined, poemId);
    assert.equal(await proses(kasus), 'diproses');
    const k = await ambil(pool, poemId);
    assert.equal(k.status, 'PROCESSING');
    assert.equal(k.row_version, 1);
    assert.deepEqual(await outbox(poemId), []);
    assert.equal(await proses(kasus), 'duplikat');
  });

  test('optimistic locking: dua transaksi membaca versi yang sama, yang kedua gagal', async () => {
    const poemId = randomUUID();
    await proses(diajukan(poemId));
    const a = await pool.connect();
    const b = await pool.connect();
    try {
      await a.query('BEGIN');
      await b.query('BEGIN');
      const ka = await ambil(a, poemId);
      const kb = await ambil(b, poemId);
      await simpan(a, ka, { ...ka, status: 'HELD' });
      await a.query('COMMIT');
      await assert.rejects(simpan(b, kb, { ...kb, status: 'DELETED' }), GalatKonflik);
      await b.query('ROLLBACK');
    } finally {
      a.release();
      b.release();
    }
    const akhir = await ambil(pool, poemId);
    assert.equal(akhir.status, 'HELD');
    assert.equal(akhir.row_version, 2);
  });

  test('dua baris baru bersamaan: INSERT kedua gagal dengan GalatKonflik', async () => {
    const poemId = randomUUID();
    const baru = { ...keadaan('PROCESSING'), poem_id: poemId };
    const a = await pool.connect();
    const b = await pool.connect();
    try {
      await a.query('BEGIN');
      await b.query('BEGIN');
      await simpan(a, null, baru);
      const kedua = simpan(b, null, { ...baru, status: 'DELETED' }); // menunggu kunci baris a
      await a.query('COMMIT');
      await assert.rejects(kedua, GalatKonflik);
      await b.query('ROLLBACK');
    } finally {
      a.release();
      b.release();
    }
    assert.equal((await ambil(pool, poemId)).status, 'PROCESSING');
  });

  test('event bersamaan tanpa kunci agregat (case.decided memakai aggregate_id = case_id) tidak merusak status', async (t) => {
    let totalKonflik = 0;
    // Puisi HELD menerima keputusan HIDE dan RESTORE + poem.deleted bersamaan,
    // dengan store tanpa advisory lock supaya benar-benar paralel. Yang kalah
    // GalatKonflik dan di-retry seperti di konsumen asli.
    const tanpaKunci = buatStorePg(pool, { kunciAgregat: false });
    for (let putaran = 0; putaran < 10; putaran++) {
      const poemId = randomUUID();
      await proses(diajukan(poemId));
      await proses(dinilai(1, 'suspected_plagiarism', 0.9, poemId));

      const events = [
        diputuskan('HIDE', '2026-11-20T09:00:00.000Z', poemId),
        diputuskan('APPROVE', '2026-11-20T10:00:00.000Z', poemId),
        direvisi(2, poemId),
        dihapus(1, poemId),
      ];
      let konflik = 0;
      const denganRetry = async (e) => {
        for (;;) {
          try {
            return await proses(e, tanpaKunci);
          } catch (err) {
            if (!(err instanceof GalatKonflik)) throw err;
            konflik++;
          }
        }
      };
      await Promise.all(events.map(denganRetry));

      const k = await ambil(pool, poemId);
      assert.equal(k.status, 'DELETED', 'poem.deleted final, apa pun urutannya');
      // row_version = jumlah UPDATE yang benar-benar commit; tidak ada yang hilang diam-diam
      const { rows } = await pool.query(
        'SELECT count(*)::int AS n FROM processed_event WHERE event_id = ANY($1)',
        [events.map((e) => e.event_id)],
      );
      assert.equal(rows[0].n, events.length, 'semua event tercatat tepat sekali');
      // held, lalu paling banyak satu dari hidden / published: keputusan yang
      // lebih lama ditolak sebagai basi, dan keputusan setelah dihapus diabaikan.
      const terbit = (await outbox(poemId)).map((r) => r.event_type);
      assert.equal(terbit[0], 'poem.held');
      assert.ok(terbit.length <= 2, `event keluar berlebih: ${terbit}`);
      totalKonflik += konflik;
    }
    t.diagnostic(`konflik row_version yang di-retry: ${totalKonflik}`);
  });
});
