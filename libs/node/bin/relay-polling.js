#!/usr/bin/env node
/**
 * Entrypoint relay outbox polling (cadangan Debezium). Satu proses per
 * database ber-outbox. Variabel: DATABASE_URL, RABBITMQ_*, RELAY_INTERVAL_MS.
 */
import pg from 'pg';
import { hubungkan, buatLogger } from '../src/index.js';
import { jalankanRelayPolling } from '../src/relay-polling.js';

const log = buatLogger();
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL belum diisi');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const koneksi = await hubungkan({ log });
const relay = await jalankanRelayPolling({
  pool,
  koneksi,
  log,
  intervalMs: Number(process.env.RELAY_INTERVAL_MS) || undefined,
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
