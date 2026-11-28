
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buatEvent,
  simpanDenganOutbox,
  relaySatuPutaran,
  EXCHANGE_RELAY,
  GalatPermanen,
} from '../src/index.js';

process.env.SERVICE_NAME = 'uji-layanan';

const POEM_ID = '0b7d6f0e-4a8b-4a52-9d0b-3f4f0e9b2a10';
const REPORT_ID = '550e8400-e29b-41d4-a716-446655440000';

const payloadPuisi = {
  poem_id: POEM_ID,
  version: 1,
  author_id: 'u-0042',
  title: 'Jendela yang Basah',
  body: 'sore turun tanpa permisi\nhujan mengetuk kaca',
  quote_stanza: 0,
  quote_text: 'sore turun tanpa permisi\nhujan mengetuk kaca',
  template_id: 'latar2',
  category: 'lirik',
  keywords: ['hujan', 'rindu'],
  submitted_at: '2026-11-17T03:00:00.120Z',
};

const payloadLaporan = {
  report_id: REPORT_ID,
  poem_id: POEM_ID,
  reporter_id: 'u-1',
  reason: 'konten bermasalah',
  created_at: '2026-11-17T10:00:00.000Z',
};

/** Pool palsu dengan tabel outbox di memori dan transaksi sederhana. */
function poolPalsu() {
  const outbox = [];
  const kueri = [];

  return {
    outbox,
    kueri,
    async connect() {
      let tertunda = null;
      let hapus = null;

      return {
        async query(sql, p) {
          kueri.push(sql.trim().split(/\s+/)[0]);

          if (sql === 'BEGIN') {
            tertunda = [];
            hapus = [];
          } else if (sql === 'COMMIT') {
            outbox.push(...tertunda);

            for (const id of hapus) {
              outbox.splice(
                outbox.findIndex((r) => r.event_id === id),
                1,
              );
            }

            tertunda = hapus = null;
          } else if (sql === 'ROLLBACK') {
            tertunda = hapus = null;
          } else if (sql.startsWith('INSERT INTO outbox')) {
            tertunda.push({
              event_id: p[0],
              aggregate_type: p[1],
              aggregate_id: p[2],
              event_type: p[3],
              payload: p[4],
            });
          } else if (sql.startsWith('SELECT event_id')) {
            return { rows: outbox.slice(0, p[0]) };
          } else if (sql.startsWith('DELETE FROM outbox')) {
            hapus.push(...p[0]);
          }

          return { rows: [], rowCount: 0 };
        },
        release() {},
      };
    },
  };
}

test('simpanDenganOutbox: data dan event ditulis dalam satu transaksi', async () => {
  const pool = poolPalsu();
  const event = buatEvent('poem.submitted', POEM_ID, 1, payloadPuisi);

  const hasil = await simpanDenganOutbox(pool, async (tx) => {
    await tx.query('INSERT INTO submission VALUES (1)');
    return { hasil: { poemId: POEM_ID }, event };
  });

  assert.deepEqual(hasil, { poemId: POEM_ID });
  assert.equal(pool.outbox.length, 1);
  assert.equal(pool.outbox[0].event_type, 'poem.submitted');
  assert.equal(pool.outbox[0].aggregate_type, 'poem');
  assert.equal(
    pool.outbox[0].payload.event_id,
    event.event_id,
    'payload = amplop lengkap',
  );
  assert.deepEqual(pool.kueri, ['BEGIN', 'INSERT', 'INSERT', 'COMMIT']);
});

test('simpanDenganOutbox: event tak terdaftar di routing.json -> rollback, tidak ada baris', async () => {
  const pool = poolPalsu();

  const event = {
    ...buatEvent('poem.submitted', POEM_ID, 1, payloadPuisi),
    event_type: 'poem.tidak_ada',
  };

  await assert.rejects(
    simpanDenganOutbox(pool, async () => event),
    GalatPermanen,
  );

  assert.equal(pool.outbox.length, 0);
  assert.ok(pool.kueri.includes('ROLLBACK'));
});

test('simpanDenganOutbox: galat di logika bisnis membatalkan event juga', async () => {
  const pool = poolPalsu();

  await assert.rejects(
    simpanDenganOutbox(pool, async () => {
      throw new Error('validasi gagal');
    }),
    /validasi gagal/,
  );

  assert.equal(pool.outbox.length, 0);
});

test('relay polling: terbitkan ke outbox.relay lalu hapus baris yang terkonfirmasi', async () => {
  const pool = poolPalsu();

  const events = [
    buatEvent('poem.submitted', POEM_ID, 1, payloadPuisi),
    buatEvent('report.created', REPORT_ID, 1, payloadLaporan),
  ];

  for (const e of events) {
    await simpanDenganOutbox(pool, async () => e);
  }

  const terbit = [];

  const ch = {
    publish: (ex, rk, body, opsi, cb) => {
      terbit.push({
        ex,
        rk,
        id: opsi.messageId,
      });
      cb(null);
      return true;
    },
  };

  assert.equal(await relaySatuPutaran(pool, ch, 100), 2);

  assert.deepEqual(
    terbit.map((t) => [t.ex, t.rk]),
    [
      [EXCHANGE_RELAY, 'poem.submitted'],
      [EXCHANGE_RELAY, 'report.created'],
    ],
  );

  assert.equal(pool.outbox.length, 0);
  assert.equal(await relaySatuPutaran(pool, ch, 100), 0);
});

test('relay polling: publish gagal -> baris tetap di outbox (tidak hilang)', async () => {
  const pool = poolPalsu();

  await simpanDenganOutbox(
    pool,
    async () => buatEvent('poem.submitted', POEM_ID, 1, payloadPuisi),
  );

  const ch = {
    publish: (_ex, _rk, _b, _o, cb) => {
      cb(new Error('broker mati'));
      return true;
    },
  };

  await assert.rejects(
    relaySatuPutaran(pool, ch, 100),
    /broker mati/,
  );

  assert.equal(pool.outbox.length, 1);
});

test('relay polling: parameter sejak diteruskan ke query (mode kuras failover)', async () => {
  const params = [];
  const pool = {
    async connect() {
      return {
        async query(sql, p) {
          if (sql.startsWith('SELECT event_id')) params.push(p);
          return { rows: [], rowCount: 0 };
        },
        release() {},
      };
    },
  };
  const ch = { publish: (_e, _r, _b, _o, cb) => cb(null) };

  assert.equal(await relaySatuPutaran(pool, ch, 50, '2026-11-27T06:00:00Z'), 0);
  assert.equal(await relaySatuPutaran(pool, ch, 50), 0);
  assert.deepEqual(params, [[50, '2026-11-27T06:00:00Z'], [50, null]]);
});
