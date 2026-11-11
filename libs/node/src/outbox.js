/**
 * Transactional Outbox: data bisnis dan event ditulis dalam SATU transaksi
 * lokal, sehingga keduanya tersimpan bersama atau tidak sama sekali
 * (solusi dual-write problem). Penerbitan ke RabbitMQ dikerjakan outbox-relay.
 */
import { validasiEvent, exchangeUntuk } from './kontrak.js';

/**
 * Sisipkan satu event ke tabel outbox memakai transaksi yang sedang berjalan.
 * Event divalidasi dan harus terdaftar di routing.json SEBELUM commit, jadi
 * event yang tidak bisa dirutekan tidak pernah masuk outbox.
 *
 * @param {import('pg').PoolClient} tx  klien di dalam BEGIN ... COMMIT
 * @param {import('./amplop.js').Event} event
 * @param {{ aggregateType?: string }} [opsi] default: segmen pertama event_type ('poem', 'report', ...)
 */
export async function tulisOutbox(tx, event, opsi = {}) {
  validasiEvent(event);
  exchangeUntuk(event.event_type);
  const aggregateType = opsi.aggregateType ?? event.event_type.split('.')[0];
  await tx.query(
    `INSERT INTO outbox (event_id, aggregate_type, aggregate_id, event_type, payload, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [event.event_id, aggregateType, event.aggregate_id, event.event_type, event, event.occurred_at],
  );
}

/**
 * Jalankan fn di dalam transaksi, lalu tulis event yang dikembalikannya ke
 * outbox di transaksi yang sama, kemudian commit.
 *
 *   const hasil = await simpanDenganOutbox(pool, async (tx) => {
 *     await tx.query('INSERT INTO submission ...', [...]);
 *     return { hasil: { poemId }, event: buatEvent('poem.submitted', poemId, 1, {...}) };
 *   });
 *
 * fn boleh mengembalikan { hasil, event }, { hasil, events: [...] }, atau
 * langsung satu event. Bila fn atau penulisan outbox gagal, semua di-rollback.
 *
 * @template T
 * @param {import('pg').Pool} pool
 * @param {(tx: import('pg').PoolClient) => Promise<{ hasil?: T, event?: any, events?: any[] } | any>} fn
 * @returns {Promise<T | undefined>}
 */
export async function simpanDenganOutbox(pool, fn) {
  const tx = await pool.connect();
  try {
    await tx.query('BEGIN');
    const keluaran = await fn(tx);
    const events = keluaran?.events ?? (keluaran?.event ? [keluaran.event] : keluaran?.event_id ? [keluaran] : []);
    for (const event of events) await tulisOutbox(tx, event);
    await tx.query('COMMIT');
    return keluaran?.hasil;
  } catch (err) {
    await tx.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    tx.release();
  }
}
