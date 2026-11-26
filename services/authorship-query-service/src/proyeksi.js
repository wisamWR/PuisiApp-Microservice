import { GalatPermanen } from '@puisiapp/events';

export const IKATAN = ['authorship.recorded', 'poem.submitted', 'poem.deleted'];

const POLA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function proyeksikan(tx, event) {
  if (event.event_type === 'authorship.recorded') {
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
    return;
  }

  if (event.event_type === 'poem.submitted') {
    const p = event.payload ?? {};
    const poemId = p.poem_id ?? event.aggregate_id ?? '';
    const authorId = p.author_id ?? '';

    if (!POLA_UUID.test(poemId) || !POLA_UUID.test(authorId)) {
      throw new GalatPermanen('Payload poem.submitted tidak valid');
    }

    await tx.query(
      `INSERT INTO poem_ownership_projection (poem_id, author_id, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (poem_id) DO UPDATE
         SET author_id = EXCLUDED.author_id,
             updated_at = now()`,
      [poemId, authorId],
    );
    return;
  }

  if (event.event_type === 'poem.deleted') {
    const p = event.payload ?? {};
    const poemId = p.poem_id ?? event.aggregate_id ?? '';

    if (!POLA_UUID.test(poemId)) {
      throw new GalatPermanen('Payload poem.deleted tidak valid');
    }

    await tx.query(
      `DELETE FROM poem_ownership_projection
       WHERE poem_id = $1`,
      [poemId],
    );
  }
}
