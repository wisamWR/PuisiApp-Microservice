/**
 * Publisher dengan publisher confirm: terbitkan() baru selesai setelah broker
 * mengonfirmasi pesan tersimpan. Exchange ditentukan dari contracts/routing.json,
 * routing key = event_type.
 */
import { validasiEvent, exchangeUntuk } from './kontrak.js';
import { pastikanExchangeDomain } from './topologi.js';

/**
 * Opsi AMQP standar untuk satu event. Dipakai juga oleh retry dan outbox relay.
 * correlation_id dan traceparent ikut di header AMQP agar bisa dibaca tanpa
 * mem-parsing body (propagasi tracing).
 * @param {import('./amplop.js').Event} event
 * @param {Record<string, unknown>} [headerTambahan]
 */
export function opsiPesan(event, headerTambahan = {}) {
  /** @type {Record<string, unknown>} */
  const headers = { correlation_id: event.correlation_id, ...headerTambahan };
  if (event.traceparent) headers.traceparent = event.traceparent;
  return {
    persistent: true,
    contentType: 'application/json',
    contentEncoding: 'utf-8',
    messageId: event.event_id,
    correlationId: event.correlation_id,
    type: event.event_type,
    appId: event.producer,
    timestamp: Math.floor(Date.parse(event.occurred_at) / 1000),
    headers,
  };
}

/**
 * @param {import('amqplib').ConfirmChannel} ch
 * @param {string} exchange
 * @param {string} routingKey
 * @param {Buffer} body
 * @param {import('amqplib').Options.Publish} opsi
 */
export function publishDenganKonfirmasi(ch, exchange, routingKey, body, opsi) {
  return new Promise((resolve, reject) => {
    ch.publish(exchange, routingKey, body, opsi, (err) => (err ? reject(err) : resolve()));
  });
}

/**
 * @param {import('amqplib').ChannelModel} koneksi
 */
export async function buatPublisher(koneksi) {
  const ch = await koneksi.createConfirmChannel();
  const exchangeSiap = new Set();

  return {
    /**
     * @param {import('./amplop.js').Event} event
     * @param {{ headers?: Record<string, unknown> }} [opsi]
     */
    async terbitkan(event, opsi = {}) {
      validasiEvent(event);
      const exchange = exchangeUntuk(event.event_type);
      if (!exchangeSiap.has(exchange)) {
        await pastikanExchangeDomain(ch, exchange);
        exchangeSiap.add(exchange);
      }
      const body = Buffer.from(JSON.stringify(event), 'utf8');
      await publishDenganKonfirmasi(ch, exchange, event.event_type, body, opsiPesan(event, opsi.headers));
    },
    async tutup() {
      await ch.close();
    },
  };
}
