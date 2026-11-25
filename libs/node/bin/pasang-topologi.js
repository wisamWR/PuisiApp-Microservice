#!/usr/bin/env node
/**
 * Pasang topologi RabbitMQ bersama dari contracts/routing.json (idempoten).
 * Dijalankan container rabbitmq-topologi; jalankan ulang setiap routing.json berubah:
 *   docker compose run --rm rabbitmq-topologi
 */
import { hubungkan, buatLogger } from '../src/index.js';
import { pasangTopologiBersama } from '../src/topologi.js';

process.env.SERVICE_NAME ??= 'rabbitmq-topologi';
const log = buatLogger();
const koneksi = await hubungkan({ log, keluarSaatPutus: false });
try {
  const ch = await koneksi.createChannel();
  const hasil = await pasangTopologiBersama(ch);
  log.info('topologi terpasang', hasil);
  await ch.close();
} finally {
  await koneksi.close();
}
