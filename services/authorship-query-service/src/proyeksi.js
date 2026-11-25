import { GalatPermanen } from '@puisiapp/events';

export const IKATAN = ['authorship.recorded'];

const POLA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function proyeksikan(tx, event) {
  if (event.event_type !== 'authorship.recorded') return;

  const p = event.payload ?? {};

  if (!POLA_UUID.test(p.poem_id ?? '') ||
      !Number.isInteger(p.version) || p.version < 1 ||
      !/^[a-f0-9]{64}$/.test(p.content_hash ?? '') ||
      !/^[a-f0-9]{64}$/.test(p.previous_hash ?? '') ||
      !/^[a-f0-9]{64}$/.test(p.chain_hash ?? '') ||
      p.algorithm !== 'SHA-256' ||
      !Number.isFinite(Date.parse(p.recorded_at ?? ''))) {
    throw new GalatPermanen('Payload authorship.recorded tidak valid');
  }

  await tx.query(
    `INSERT INTO authorship_projection (
      poem_id, version, content_hash, previous_hash,
      chain_hash, recorded_at, algorithm, source_event_id
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (poem_id, version) DO NOTHING`,
    [
      p.poem_id,
      p.version,
      p.content_hash,
      p.previous_hash,
      p.chain_hash,
      p.recorded_at,
      p.algorithm,
      event.event_id,
    ],
  );
}
