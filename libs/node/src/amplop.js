/**
 * Pembuatan amplop event sesuai contracts/envelope.v1.json.
 */
import { createHash, randomUUID } from 'node:crypto';
import { validasiEvent } from './kontrak.js';

/**
 * @typedef {object} Event
 * @property {string} event_id
 * @property {string} event_type
 * @property {number} schema_version
 * @property {string} occurred_at
 * @property {string} producer
 * @property {string} correlation_id
 * @property {string|null} [causation_id]
 * @property {string} [traceparent]
 * @property {string} aggregate_id
 * @property {number} aggregate_version
 * @property {Record<string, unknown>} payload
 */

/**
 * @typedef {object} OpsiEvent
 * @property {string} [eventId]        default UUIDv4 acak
 * @property {string} [correlationId]  default UUIDv4 baru (awal aksi pengguna); isi dari X-Request-Id gateway bila ada
 * @property {string|null} [causationId]
 * @property {string} [traceparent]
 * @property {number} [schemaVersion]  default 1
 * @property {string} [producer]       default env SERVICE_NAME
 * @property {Date|string} [occurredAt] default sekarang
 */

function namaLayanan(producer) {
  const nama = producer ?? process.env.SERVICE_NAME;
  if (!nama) throw new Error('Nama layanan kosong: isi variabel SERVICE_NAME atau opsi producer');
  return nama;
}

/**
 * UUID versi 5 (RFC 9562): SHA-1 dari namespace + nama. Hasilnya sama untuk
 * masukan yang sama, sehingga event hasil yang diterbitkan ulang punya
 * event_id yang sama dan dapat dikenali konsumen sebagai duplikat.
 * @param {string} nama
 * @param {string} namespace UUID
 */
export function uuidv5(nama, namespace) {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  if (ns.length !== 16) throw new Error(`Namespace bukan UUID: ${namespace}`);
  const hash = createHash('sha1').update(ns).update(Buffer.from(nama, 'utf8')).digest();
  const b = hash.subarray(0, 16);
  b[6] = (b[6] & 0x0f) | 0x50; // versi 5
  b[8] = (b[8] & 0x3f) | 0x80; // varian RFC 4122
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Buat amplop event baru dan validasi terhadap envelope.v1.json.
 * @param {string} eventType       mis. "poem.submitted" (juga routing key)
 * @param {string} aggregateId     mis. poem_id
 * @param {number} aggregateVersion
 * @param {Record<string, unknown>} payload
 * @param {OpsiEvent} [opsi]
 * @returns {Event}
 */
export function buatEvent(eventType, aggregateId, aggregateVersion, payload, opsi = {}) {
  const occurredAt = opsi.occurredAt ?? new Date();
  /** @type {Event} */
  const event = {
    event_id: opsi.eventId ?? randomUUID(),
    event_type: eventType,
    schema_version: opsi.schemaVersion ?? 1,
    occurred_at: occurredAt instanceof Date ? occurredAt.toISOString() : occurredAt,
    producer: namaLayanan(opsi.producer),
    correlation_id: opsi.correlationId ?? randomUUID(),
    causation_id: opsi.causationId ?? null,
    aggregate_id: String(aggregateId),
    aggregate_version: aggregateVersion,
    payload,
  };
  if (opsi.traceparent) event.traceparent = opsi.traceparent;
  return validasiEvent(event);
}

/**
 * Event hasil yang dipicu event lain (pola consume-process-publish-ack untuk
 * worker tanpa outbox). correlation_id dan traceparent diwarisi, causation_id
 * menunjuk event sumber, dan event_id deterministik:
 *   uuidv5(nama = "<producer>:<eventType>", namespace = event_id sumber)
 * Pustaka Python memakai rumus yang sama.
 *
 * @param {Event} sumber
 * @param {string} eventType
 * @param {Record<string, unknown>} payload
 * @param {Omit<OpsiEvent, 'correlationId'|'causationId'|'eventId'> & { aggregateId?: string, aggregateVersion?: number }} [opsi]
 */
export function eventTurunan(sumber, eventType, payload, opsi = {}) {
  const producer = namaLayanan(opsi.producer);
  return buatEvent(
    eventType,
    opsi.aggregateId ?? sumber.aggregate_id,
    opsi.aggregateVersion ?? sumber.aggregate_version,
    payload,
    {
      ...opsi,
      producer,
      eventId: uuidv5(`${producer}:${eventType}`, sumber.event_id),
      correlationId: sumber.correlation_id,
      causationId: sumber.event_id,
      traceparent: opsi.traceparent ?? sumber.traceparent,
    },
  );
}
