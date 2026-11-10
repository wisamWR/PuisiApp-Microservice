/**
 * Penyimpanan pengajuan puisi: submission + outbox poem.submitted dalam satu
 * transaksi lokal (Transactional Outbox).
 */
import { randomUUID } from 'node:crypto';
import { buatEvent, tulisOutbox } from '@puisiapp/events';

/** Bentuk respons 202 dan payload event dari satu baris submission. */
export function keRepresentasi(baris) {
  return {
    poem_id: baris.poem_id,
    version: 1,
    status: 'PROCESSING',
    author_id: baris.author_id,
    title: baris.judul,
    body: baris.isi,
    quote_stanza: baris.indeks_bait,
    quote_text: baris.bait_kutipan,
    template_id: baris.template,
    category: baris.kategori,
    keywords: baris.keyword_manual,
    submitted_at: new Date(baris.created_at).toISOString(),
  };
}

/** Payload poem.submitted (contracts/events/poem.submitted.v1.json). */
export function kePayloadEvent(rep) {
  const { status, ...payload } = rep;
  return payload;
}

/**
 * @param {import('pg').Pool} pool
 * @param {object} p
 * @param {string} p.authorId
 * @param {string} p.idempotencyKey
 * @param {string} p.hash            hashPengajuan(data)
 * @param {object} p.data            validasiPengajuan().data
 * @param {{ correlationId: string, traceparent?: string }} p.konteks
 * @returns {Promise<{ jenis: 'baru'|'ulang', puisi: object } | { jenis: 'konflik' }>}
 */
export async function simpanPengajuan(pool, { authorId, idempotencyKey, hash, data, konteks }) {
  const tx = await pool.connect();
  try {
    await tx.query('BEGIN');
    const sisip = await tx.query(
      `INSERT INTO submission
         (poem_id, author_id, judul, isi, bait_kutipan, indeks_bait, template,
          kategori, keyword_manual, idempotency_key, request_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (author_id, idempotency_key) DO NOTHING
       RETURNING *`,
      [
        randomUUID(),
        authorId,
        data.judul,
        data.isi,
        data.baitKutipan,
        data.indeksBait,
        data.template,
        data.kategori,
        data.kataKunci,
        idempotencyKey,
        hash,
      ],
    );

    if (sisip.rowCount === 0) {
      // Key sudah dipakai. Bila ada permintaan bersamaan dengan key yang sama,
      // INSERT di atas menunggu transaksi pertama commit, jadi barisnya pasti terlihat.
      await tx.query('ROLLBACK');
      const { rows } = await pool.query(
        'SELECT * FROM submission WHERE author_id = $1 AND idempotency_key = $2',
        [authorId, idempotencyKey],
      );
      if (rows[0].request_hash !== hash) return { jenis: 'konflik' };
      return { jenis: 'ulang', puisi: keRepresentasi(rows[0]) };
    }

    const baris = sisip.rows[0];
    const puisi = keRepresentasi(baris);
    const event = buatEvent('poem.submitted', baris.poem_id, 1, kePayloadEvent(puisi), {
      correlationId: konteks.correlationId,
      traceparent: konteks.traceparent,
      occurredAt: baris.created_at,
    });
    await tulisOutbox(tx, event);
    await tx.query('COMMIT');
    return { jenis: 'baru', puisi };
  } catch (err) {
    await tx.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    tx.release();
  }
}
