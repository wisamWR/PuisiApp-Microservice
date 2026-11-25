/**
 * Handler dengan PostgreSQL asli: penerima yang tepat, tanpa duplikat,
 * urutan event. Dilewati bila TEST_DATABASE_URL kosong, misalnya:
 *   TEST_DATABASE_URL=postgres://postgres:postgres_dev_only@localhost:5433/notif_uji
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { buatStorePg, jalankanMigrasi } from '@puisiapp/events';
import { buatHandler } from '../src/handler.js';
import * as repo from '../src/repo.js';
import { e, diam, PENULIS, PELAPOR } from './bantu.js';

const URL_DB = process.env.TEST_DATABASE_URL;
const folderMigrasi = path.join(path.dirname(fileURLToPath(import.meta.url)), '../migrations');

describe('notification-service dengan PostgreSQL', { skip: !URL_DB && 'TEST_DATABASE_URL kosong' }, () => {
  let pool;
  let store;
  const tangani = buatHandler();

  before(async () => {
    const nama = new URL(URL_DB).pathname.slice(1);
    const admin = new pg.Client({ connectionString: URL_DB.replace(`/${nama}`, '/postgres') });
    await admin.connect();
    if (!(await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [nama])).rowCount) await admin.query(`CREATE DATABASE "${nama}"`);
    await admin.end();
    pool = new pg.Pool({ connectionString: URL_DB, max: 10 });
    await jalankanMigrasi(pool, { folder: folderMigrasi });
    store = buatStorePg(pool);
  });
  after(async () => pool?.end());
  beforeEach(async () => pool.query('TRUNCATE notifikasi, puisi, laporan, kasus, processed_event'));

  const proses = (ev) =>
    store.proses(ev, async (ctx) => {
      await tangani(ev, { ...ctx, log: diam });
      return 'diproses';
    });
  const milik = async (user) => (await repo.daftar(pool, { userId: user, page: 1, size: 50, belumDibaca: false })).items;

  test('penulis menerima notifikasi saat puisinya terbit dan saat ditahan', async () => {
    const a = randomUUID();
    const b = randomUUID();
    await proses(e.diajukan(a, 'Hujan'));
    await proses(e.diajukan(b, 'Senja'));
    await proses(e.terbit(a));
    await proses(e.ditahan(b));
    const n = await milik(PENULIS);
    assert.deepEqual(n.map((x) => x.type).sort(), ['poem_held', 'poem_published']);
    const tahan = n.find((x) => x.type === 'poem_held');
    assert.match(tahan.message, /"Senja".*0,91/);
    assert.equal(tahan.link, `/poems/${b}`);
    assert.equal(tahan.read, false);
  });

  test('event yang sama dua kali (bahkan dengan store dilewati) tidak menggandakan notifikasi', async () => {
    const a = randomUUID();
    await proses(e.diajukan(a));
    const ev = e.terbit(a);
    assert.equal(await proses(ev), 'diproses');
    assert.equal(await proses(ev), 'duplikat');
    // Lapisan kedua: walau processed_event hilang, UNIQUE (event_id, penerima) menahan duplikat.
    const tx = await pool.connect();
    try {
      await tx.query('BEGIN');
      await pool.query('DELETE FROM processed_event');
      await tangani(ev, { tx, log: diam });
      await tx.query('COMMIT');
    } finally {
      tx.release();
    }
    assert.equal((await milik(PENULIS)).length, 1);
  });

  test('event status sebelum poem.submitted: ditunda (di-retry), tidak hilang', async () => {
    const a = randomUUID();
    const ev = e.terbit(a);
    await assert.rejects(proses(ev), { name: 'GalatTunda' });
    await proses(e.diajukan(a));
    assert.equal(await proses(ev), 'diproses');
    assert.equal((await milik(PENULIS)).length, 1);
  });

  test('laporan: penulis dan pelapor diberi tahu; keputusan sampai ke pelapor', async () => {
    const a = randomUUID();
    const reportId = randomUUID();
    const caseId = randomUUID();
    await proses(e.diajukan(a));
    await proses(e.terbit(a));
    await proses(e.dilaporkan(a, reportId));
    await proses(e.kasusDibuka(a, caseId, reportId));
    await proses(e.diputuskan(a, caseId, 'HIDE'));
    await proses(e.disembunyikan(a));
    assert.deepEqual((await milik(PELAPOR)).map((x) => x.type).sort(), ['case_decided_reporter', 'report_received']);
    // Penulis: terbit, dilaporkan, disembunyikan; keputusan HIDE tidak dikirim dua kali ke penulis.
    assert.deepEqual((await milik(PENULIS)).map((x) => x.type).sort(), ['poem_hidden', 'poem_published', 'poem_reported']);
  });

  test('laporan ditolak pada puisi terbit: penulis diberi tahu puisinya tetap tampil', async () => {
    const a = randomUUID();
    const reportId = randomUUID();
    const caseId = randomUUID();
    await proses(e.diajukan(a));
    await proses(e.terbit(a));
    await proses(e.dilaporkan(a, reportId));
    await proses(e.kasusDibuka(a, caseId, reportId));
    await proses(e.diputuskan(a, caseId, 'REJECT'));
    assert.ok((await milik(PENULIS)).some((x) => x.type === 'case_decided_author'));
  });

  test('banding dan keputusan yang memulihkan: tampil kembali', async () => {
    const a = randomUUID();
    const caseId = randomUUID();
    await proses(e.diajukan(a, 'Hujan'));
    await proses(e.terbit(a));
    await proses(e.kasusDibuka(a, caseId, null));
    await proses(e.disembunyikan(a));
    await proses(e.banding(caseId));
    await proses(e.terbit(a));
    const n = await milik(PENULIS);
    assert.ok(n.some((x) => x.type === 'appeal_filed' && /"Hujan"/.test(x.message)));
    assert.ok(n.some((x) => x.type === 'poem_published' && x.title === 'Puisimu tampil kembali'));
  });

  test('pemrosesan selesai versi lama dan puisi yang dihapus tidak memberi notifikasi', async () => {
    const a = randomUUID();
    await proses(e.diajukan(a));
    await proses(e.direvisi(a, 2));
    await proses(e.selesai(a, 1));
    assert.equal((await milik(PENULIS)).length, 0);
    await proses(e.selesai(a, 2));
    assert.equal((await milik(PENULIS)).length, 1);
    await proses(e.dihapus(a));
    await proses(e.terbit(a, 2));
    assert.equal((await milik(PENULIS)).length, 1);
  });

  test('tandai dibaca hanya milik sendiri; jumlah belum dibaca', async () => {
    const a = randomUUID();
    await proses(e.diajukan(a));
    await proses(e.terbit(a));
    await proses(e.selesai(a));
    const [n1] = await milik(PENULIS);
    assert.equal(await repo.jumlahBelumDibaca(pool, PENULIS), 2);
    assert.equal(await repo.tandaiDibaca(pool, { userId: PELAPOR, id: n1.id }), null);
    assert.equal((await repo.tandaiDibaca(pool, { userId: PENULIS, id: n1.id })).read, true);
    assert.equal(await repo.jumlahBelumDibaca(pool, PENULIS), 1);
    assert.equal(await repo.tandaiSemua(pool, PENULIS), 1);
    assert.equal(await repo.jumlahBelumDibaca(pool, PENULIS), 0);
  });
});
