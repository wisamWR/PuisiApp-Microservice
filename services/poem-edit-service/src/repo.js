/**
 * Penyimpanan revisi: cek kepemilikan + revision + outbox poem.revised dalam
 * satu transaksi. Baris poem_ownership dikunci (FOR UPDATE), sehingga dua
 * revisi bersamaan untuk puisi yang sama mendapat nomor versi berurutan.
 */
import { buatEvent, tulisOutbox } from '@puisiapp/events';

export function keRepresentasi(baris) {
  return {
    poem_id: baris.poem_id,
    version: baris.versi,
    status: 'PROCESSING',
    author_id: baris.author_id,
    title: baris.judul,
    body: baris.isi,
    quote_stanza: baris.indeks_bait,
    quote_text: baris.bait_kutipan,
    template_id: baris.template,
    category: baris.kategori,
    keywords: baris.keyword_manual,
    revised_at: new Date(baris.created_at).toISOString(),
  };
}

/** Payload poem.revised (contracts/events/poem.revised.v1.json). */
export function kePayloadEvent(rep) {
  const { status, ...payload } = rep;
  return payload;
}

/**
 * @returns {Promise<{ jenis: 'baru'|'ulang', puisi: object } | { jenis: 'tidak_ada'|'bukan_pemilik'|'terhapus'|'konflik' }>}
 */
export async function simpanRevisi(pool, { poemId, authorId, idempotencyKey, hash, data, konteks }) {
  const tx = await pool.connect();
  try {
    await tx.query('BEGIN');
    const { rows: milik } = await tx.query('SELECT * FROM poem_ownership WHERE poem_id = $1 FOR UPDATE', [poemId]);
    const kepemilikan = milik[0];
    const selesai = async (hasil) => {
      await tx.query('ROLLBACK');
      return hasil;
    };
    if (!kepemilikan) return selesai({ jenis: 'tidak_ada' });
    if (kepemilikan.author_id !== authorId) return selesai({ jenis: 'bukan_pemilik' });
    if (kepemilikan.deleted) return selesai({ jenis: 'terhapus' });

    const { rows: lama } = await tx.query('SELECT * FROM revision WHERE poem_id = $1 AND idempotency_key = $2', [
      poemId,
      idempotencyKey,
    ]);
    if (lama[0]) {
      return selesai(lama[0].request_hash === hash ? { jenis: 'ulang', puisi: keRepresentasi(lama[0]) } : { jenis: 'konflik' });
    }

    const versi = kepemilikan.versi_terakhir + 1;
    const { rows } = await tx.query(
      `INSERT INTO revision
         (poem_id, versi, author_id, judul, isi, bait_kutipan, indeks_bait, template,
          kategori, keyword_manual, idempotency_key, request_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        poemId,
        versi,
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
    await tx.query('UPDATE poem_ownership SET versi_terakhir = $2 WHERE poem_id = $1', [poemId, versi]);

    const puisi = keRepresentasi(rows[0]);
    await tulisOutbox(
      tx,
      buatEvent('poem.revised', poemId, versi, kePayloadEvent(puisi), {
        correlationId: konteks.correlationId,
        traceparent: konteks.traceparent,
        occurredAt: rows[0].created_at,
      }),
    );
    await tx.query('COMMIT');
    return { jenis: 'baru', puisi };
  } catch (err) {
    await tx.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    tx.release();
  }
}

/**
 * Handler konsumen q.poem-edit: bangun salinan kepemilikan.
 *   poem.submitted -> baris baru (versi 1)
 *   poem.deleted   -> tandai terhapus (final; dibuat bila submitted belum tiba)
 */
export async function tanganiEventKepemilikan(event, { tx }) {
  const p = event.payload;
  if (event.event_type === 'poem.submitted') {
    await tx.query(
      `INSERT INTO poem_ownership (poem_id, author_id) VALUES ($1, $2)
       ON CONFLICT (poem_id) DO NOTHING`,
      [p.poem_id, p.author_id],
    );
  } else if (event.event_type === 'poem.deleted') {
    await tx.query(
      `INSERT INTO poem_ownership (poem_id, author_id, deleted, versi_terakhir) VALUES ($1, $2, true, $3)
       ON CONFLICT (poem_id) DO UPDATE SET deleted = true`,
      [p.poem_id, p.author_id, p.last_version],
    );
  }
}
