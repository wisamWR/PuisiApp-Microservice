/**
 * Deklarasi topologi RabbitMQ (idempoten; aman dipanggil setiap start):
 *
 *   <domain>.events   topic exchange, routing key = event_type
 *   dlx               direct exchange tujuan dead-letter
 *   retry.delayed     x-delayed-message (direct): pesan ditahan x-delay ms
 *                     lalu dirutekan kembali ke queue asal
 *   q.<layanan>       quorum queue milik satu layanan konsumen
 *   q.<layanan>.dlq   quorum queue penampung pesan gagal permanen
 */
import { exchangeUntuk } from './kontrak.js';

export const EXCHANGE_DLX = 'dlx';
export const EXCHANGE_RETRY = 'retry.delayed';
/** Jaring pengaman: pesan yang membuat worker crash berulang tetap berakhir di DLQ. */
export const BATAS_PENGIRIMAN = 5;

/** @param {import('amqplib').Channel} ch @param {string} exchange */
export async function pastikanExchangeDomain(ch, exchange) {
  await ch.assertExchange(exchange, 'topic', { durable: true });
}

/**
 * @param {import('amqplib').Channel} ch
 * @param {string} antrean   nama queue, mis. "q.poem-query"
 * @param {string[]} ikatan  daftar event_type yang dikonsumsi
 */
export async function pastikanAntrean(ch, antrean, ikatan) {
  if (!antrean.startsWith('q.')) throw new Error(`Nama queue harus diawali "q.": ${antrean}`);
  const dlq = `${antrean}.dlq`;

  await ch.assertExchange(EXCHANGE_DLX, 'direct', { durable: true });
  await ch.assertExchange(EXCHANGE_RETRY, 'x-delayed-message', {
    durable: true,
    arguments: { 'x-delayed-type': 'direct' },
  });

  await ch.assertQueue(dlq, { durable: true, arguments: { 'x-queue-type': 'quorum' } });
  await ch.bindQueue(dlq, EXCHANGE_DLX, dlq);

  await ch.assertQueue(antrean, {
    durable: true,
    arguments: {
      'x-queue-type': 'quorum',
      'x-dead-letter-exchange': EXCHANGE_DLX,
      'x-dead-letter-routing-key': dlq,
      'x-delivery-limit': BATAS_PENGIRIMAN,
    },
  });
  await ch.bindQueue(antrean, EXCHANGE_RETRY, antrean);

  for (const eventType of ikatan) {
    const exchange = exchangeUntuk(eventType);
    await pastikanExchangeDomain(ch, exchange);
    await ch.bindQueue(antrean, exchange, eventType);
  }
  return { antrean, dlq };
}
