#!/usr/bin/env node
/**
 * Entrypoint relay outbox polling (cadangan Debezium). Satu proses per
 * database ber-outbox. Variabel: DATABASE_URL, RABBITMQ_*, RELAY_INTERVAL_MS.
 *
 * Mode kuras (failover, docs/runbook.md "Failover PostgreSQL"):
 *   RELAY_SEJAK=<timestamp ISO>  hanya baris outbox dengan created_at >= nilai ini
 *   RELAY_SEKALI=1               berhenti (exit 0) setelah tidak ada baris tersisa
 * Baris yang diterbitkan dihapus dari outbox; duplikat disaring konsumen
 * (processed_event), jadi rentang yang tumpang tindih dengan Debezium aman.
 */
import pg from 'pg';
import { hubungkan, buatLogger } from '../src/index.js';
import { jalankanRelayPolling, relaySatuPutaran } from '../src/relay-polling.js';

const log = buatLogger();
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL belum diisi');

const sejak = process.env.RELAY_SEJAK || null;
if (sejak && Number.isNaN(Date.parse(sejak))) throw new Error(`RELAY_SEJAK bukan timestamp: ${sejak}`);

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const koneksi = await hubungkan({ log, keluarSaatPutus: !process.env.RELAY_SEKALI });

if (process.env.RELAY_SEKALI) {
  const ch = await koneksi.createConfirmChannel();
  let total = 0;
  for (;;) {
    const n = await relaySatuPutaran(pool, ch, 100, sejak);
    if (n === 0) break;
    total += n;
  }
  log.info('outbox selesai dikuras', { jumlah: total, sejak });
  await ch.close().catch(() => {});
  await koneksi.close().catch(() => {});
  await pool.end().catch(() => {});
  process.exit(0);
}

const relay = await jalankanRelayPolling({
  pool,
  koneksi,
  log,
  intervalMs: Number(process.env.RELAY_INTERVAL_MS) || undefined,
  sejak,
});

for (const sinyal of ['SIGTERM', 'SIGINT']) {
  process.on(sinyal, async () => {
    log.info('berhenti', { sinyal });
    await relay.berhenti();
    await koneksi.close().catch(() => {});
    await pool.end().catch(() => {});
    process.exit(0);
  });
}
