import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buatEvent, tanganiPesan, GalatPermanen, buatLogger, HEADER_PERCOBAAN } from '../src/index.js';

process.env.SERVICE_NAME = 'uji-layanan';

/** Store palsu yang meniru buatStorePg: catat event_id, rollback bila fn gagal. */
function storeMemori() {
  const tercatat = new Set();
  return {
    tercatat,
    async proses(event, fn) {
      if (tercatat.has(event.event_id)) return 'duplikat';
      const hasil = await fn({ tx: 'tx-palsu' });
      tercatat.add(event.event_id); // commit hanya bila fn sukses
      return hasil;
    },
  };
}

function pesanDari(event, headers = {}) {
  return {
    content: Buffer.from(typeof event === 'string' ? event : JSON.stringify(event)),
    properties: { messageId: event.event_id, headers },
    fields: {},
  };
}

function siapkan({ handler, versiTersimpan, store = storeMemori(), jadwalGagal = false } = {}) {
  const log = [];
  const aksi = [];
  const jadwal = [];
  const deps = {
    store,
    handler: handler ?? (async () => {}),
    versiTersimpan,
    log: buatLogger('uji', {}, { level: 'debug', tulis: (b) => log.push(JSON.parse(b)) }),
    ack: () => aksi.push('ack'),
    keDlq: () => aksi.push('dlq'),
    kembalikan: () => aksi.push('kembalikan'),
    jadwalkanUlang: async (percobaan, jedaMs) => {
      if (jadwalGagal) throw new Error('broker sibuk');
      jadwal.push({ percobaan, jedaMs });
    },
    maksPercobaan: 3,
    jedaDasarMs: 2000,
    faktor: 4,
    acak: () => 0.999,
  };
  return { deps, log, aksi, jadwal, store };
}

test('event yang sama dikirim dua kali hanya diproses satu kali', async () => {
  let dipanggil = 0;
  const { deps, aksi, log } = siapkan({ handler: async () => { dipanggil++; } });
  const e = buatEvent('poem.submitted', 'p-1', 1, {});

  assert.equal(await tanganiPesan(pesanDari(e), deps), 'diproses');
  assert.equal(await tanganiPesan(pesanDari(e), deps), 'duplikat');
  assert.equal(dipanggil, 1);
  assert.deepEqual(aksi, ['ack', 'ack']);
  assert.ok(log.some((l) => l.msg === 'event duplikat diabaikan' && l.event_id === e.event_id));
});

test('event dengan versi lebih lama diabaikan dan tercatat di log', async () => {
  let dipanggil = 0;
  const versi = new Map([['p-1', 3]]);
  const { deps, aksi, log, store } = siapkan({
    handler: async () => { dipanggil++; },
    versiTersimpan: async (event, ctx) => {
      assert.equal(ctx.tx, 'tx-palsu');
      return versi.get(event.aggregate_id);
    },
  });
  const basi = buatEvent('poem.revised', 'p-1', 2, {});
  const sama = buatEvent('poem.emotion.analyzed', 'p-1', 3, {});

  assert.equal(await tanganiPesan(pesanDari(basi), deps), 'basi');
  assert.equal(await tanganiPesan(pesanDari(sama), deps), 'diproses');
  assert.equal(dipanggil, 1);
  assert.deepEqual(aksi, ['ack', 'ack']);
  assert.ok(store.tercatat.has(basi.event_id), 'event basi tetap dicatat agar tidak dinilai ulang');
  const baris = log.find((l) => l.msg === 'event basi diabaikan');
  assert.equal(baris.level, 'warn');
  assert.equal(baris.versi_tersimpan, 3);
  assert.equal(baris.aggregate_version, 2);
});

test('galat sementara dicoba ulang 3 kali (2, 8, 32 dtk) lalu masuk DLQ', async () => {
  let dipanggil = 0;
  const { deps, aksi, jadwal, store } = siapkan({
    handler: async () => { dipanggil++; throw new Error('db sibuk'); },
  });
  const e = buatEvent('poem.submitted', 'p-1', 1, {});

  const hasil = [];
  for (let percobaan = 0; percobaan <= 3; percobaan++) {
    const headers = percobaan ? { [HEADER_PERCOBAAN]: percobaan } : {};
    hasil.push(await tanganiPesan(pesanDari(e, headers), deps));
  }

  assert.deepEqual(hasil, ['retry', 'retry', 'retry', 'dlq']);
  assert.equal(dipanggil, 4);
  assert.deepEqual(aksi, ['ack', 'ack', 'ack', 'dlq']);
  assert.deepEqual(jadwal.map((j) => j.percobaan), [1, 2, 3]);
  // full jitter: jeda acak di bawah batas 2, 8, 32 detik
  const batas = [2000, 8000, 32000];
  jadwal.forEach((j, i) => {
    assert.ok(j.jedaMs >= 0 && j.jedaMs < batas[i], `jeda ${j.jedaMs} < ${batas[i]}`);
    assert.ok(j.jedaMs > batas[i] * 0.9, 'acak=0.999 harus dekat batas');
  });
  assert.equal(store.tercatat.size, 0, 'event gagal tidak boleh tercatat sebagai diproses');
});

test('galat permanen langsung ke DLQ tanpa retry', async () => {
  const { deps, aksi, jadwal } = siapkan({
    handler: async () => { throw new GalatPermanen('template tidak dikenal'); },
  });
  const e = buatEvent('poem.submitted', 'p-1', 1, {});
  assert.equal(await tanganiPesan(pesanDari(e), deps), 'dlq');
  assert.deepEqual(aksi, ['dlq']);
  assert.equal(jadwal.length, 0);
});

test('body bukan JSON atau amplop tidak valid langsung ke DLQ', async () => {
  const { deps, aksi } = siapkan();
  assert.equal(await tanganiPesan(pesanDari('{bukan json'), deps), 'tidak_valid');
  assert.equal(await tanganiPesan(pesanDari({ event_id: 'x' }), deps), 'tidak_valid');
  assert.deepEqual(aksi, ['dlq', 'dlq']);
});

test('bila retry gagal diterbitkan, pesan dikembalikan ke queue (tidak hilang)', async () => {
  const { deps, aksi } = siapkan({
    handler: async () => { throw new Error('db sibuk'); },
    jadwalGagal: true,
  });
  const e = buatEvent('poem.submitted', 'p-1', 1, {});
  assert.equal(await tanganiPesan(pesanDari(e), deps), 'dikembalikan');
  assert.deepEqual(aksi, ['kembalikan']);
});

test('handler menerima tx, log, dan nomor percobaan', async () => {
  let ctxDiterima;
  const { deps } = siapkan({ handler: async (_e, ctx) => { ctxDiterima = ctx; } });
  const e = buatEvent('poem.submitted', 'p-1', 1, {});
  await tanganiPesan(pesanDari(e, { [HEADER_PERCOBAAN]: 2 }), deps);
  assert.equal(ctxDiterima.tx, 'tx-palsu');
  assert.equal(ctxDiterima.percobaan, 2);
  assert.equal(typeof ctxDiterima.log.info, 'function');
});
