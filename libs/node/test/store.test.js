import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buatStorePg } from '../src/index.js';

/** Pool palsu yang meniru transaksi PostgreSQL untuk tabel processed_event. */
function poolPalsu() {
  const tersimpan = new Set();
  const log = [];
  return {
    tersimpan,
    log,
    async connect() {
      let tertunda = null;
      return {
        async query(sql, params) {
          log.push(sql.split(' ')[0]);
          if (sql === 'BEGIN') tertunda = new Set();
          else if (sql === 'COMMIT') { for (const id of tertunda) tersimpan.add(id); tertunda = null; }
          else if (sql === 'ROLLBACK') tertunda = null;
          else if (sql.startsWith('INSERT INTO processed_event')) {
            const id = params[0];
            if (tersimpan.has(id) || tertunda.has(id)) return { rowCount: 0 };
            tertunda.add(id);
            return { rowCount: 1 };
          }
          return { rowCount: 0, rows: [] };
        },
        release() { log.push('release'); },
      };
    },
  };
}

const event = {
  event_id: '6f1c2a4e-3b7d-4e1a-9c55-0b8f2d1e7a10',
  event_type: 'poem.submitted',
  aggregate_id: 'p-0193',
};

test('advisory lock per agregat diambil setelah pencatatan, sebelum handler', async () => {
  const pool = poolPalsu();
  const kueri = [];
  const asli = pool.connect.bind(pool);
  pool.connect = async () => {
    const k = await asli();
    const q = k.query.bind(k);
    k.query = async (sql, p) => { kueri.push({ sql, p }); return q(sql, p); };
    return k;
  };
  await buatStorePg(pool).proses(event, async () => { kueri.push({ sql: 'HANDLER' }); return 'diproses'; });
  const urutan = kueri.map((k) => k.sql.split(' ')[0]);
  assert.deepEqual(urutan, ['BEGIN', 'INSERT', 'SELECT', 'HANDLER', 'COMMIT']);
  assert.match(kueri[2].sql, /pg_advisory_xact_lock/);
  assert.deepEqual(kueri[2].p, ['p-0193']);
});

test('commit mencatat event_id; event kedua dianggap duplikat', async () => {
  const pool = poolPalsu();
  const store = buatStorePg(pool);
  assert.equal(await store.proses(event, async () => 'diproses'), 'diproses');
  assert.equal(await store.proses(event, async () => 'diproses'), 'duplikat');
  assert.ok(pool.tersimpan.has(event.event_id));
});

test('handler gagal -> rollback, event_id tidak tercatat, koneksi dilepas', async () => {
  const pool = poolPalsu();
  const store = buatStorePg(pool);
  await assert.rejects(store.proses(event, async () => { throw new Error('gagal'); }), /gagal/);
  assert.equal(pool.tersimpan.size, 0);
  assert.ok(pool.log.includes('ROLLBACK'));
  assert.equal(pool.log.at(-1), 'release');
  // percobaan berikutnya tetap diproses
  assert.equal(await store.proses(event, async () => 'diproses'), 'diproses');
});

test('fn menerima tx yang sama dengan transaksi pencatatan', async () => {
  const pool = poolPalsu();
  const store = buatStorePg(pool);
  let tx;
  await store.proses(event, async (ctx) => { tx = ctx.tx; return 'diproses'; });
  assert.equal(typeof tx.query, 'function');
});
