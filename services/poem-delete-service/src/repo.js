/**
 * Penghapusan lunak: cek kepemilikan + deletion + outbox poem.deleted dalam
 * satu transaksi. Idempoten: puisi yang sudah dihapus mengembalikan hasil
 * yang sama tanpa event baru.
 */
import { buatEvent, tulisOutbox } from '@puisiapp/events';

const keRepresentasi = (baris) => ({
  poem_id: baris.poem_id,
  status: 'DELETED',
  deleted_at: new Date(baris.deleted_at).toISOString(),
});

/**
 * @returns {Promise<{ jenis: 'baru'|'ulang', hasil: object } | { jenis: 'tidak_ada'|'bukan_pemilik' }>}
 */
export async function hapusPuisi(pool, { poemId, authorId, konteks }) {
  const tx = await pool.connect();
  try {
    await tx.query('BEGIN');
    const selesai = async (h) => {
      await tx.query('ROLLBACK');
      return h;
    };
    const { rows: milik } = await tx.query('SELECT * FROM poem_ownership WHERE poem_id = $1 FOR UPDATE', [poemId]);
    if (!milik[0]) return selesai({ jenis: 'tidak_ada' });
    if (milik[0].author_id !== authorId) return selesai({ jenis: 'bukan_pemilik' });

    const { rows: sudah } = await tx.query('SELECT * FROM deletion WHERE poem_id = $1', [poemId]);
    if (sudah[0]) return selesai({ jenis: 'ulang', hasil: keRepresentasi(sudah[0]) });

    const versi = milik[0].versi_terakhir;
    const { rows } = await tx.query(
      'INSERT INTO deletion (poem_id, author_id, versi_terakhir) VALUES ($1, $2, $3) RETURNING *',
      [poemId, authorId, versi],
    );
    await tulisOutbox(
      tx,
      buatEvent(
        'poem.deleted',
        poemId,
        versi,
        { poem_id: poemId, author_id: authorId, last_version: versi, deleted_at: new Date(rows[0].deleted_at).toISOString() },
        { correlationId: konteks.correlationId, traceparent: konteks.traceparent, occurredAt: rows[0].deleted_at },
      ),
    );
    await tx.query('COMMIT');
    return { jenis: 'baru', hasil: keRepresentasi(rows[0]) };
  } catch (err) {
    await tx.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    tx.release();
  }
}

/**
 * Handler konsumen q.poem-delete:
 *   poem.submitted -> salinan kepemilikan (versi 1)
 *   poem.revised   -> perbarui versi terakhir (dibuat bila submitted belum tiba)
 */
export async function tanganiEventKepemilikan(event, { tx }) {
  const p = event.payload;
  if (event.event_type === 'poem.submitted') {
    await tx.query(
      `INSERT INTO poem_ownership (poem_id, author_id) VALUES ($1, $2)
       ON CONFLICT (poem_id) DO NOTHING`,
      [p.poem_id, p.author_id],
    );
  } else if (event.event_type === 'poem.revised') {
    await tx.query(
      `INSERT INTO poem_ownership (poem_id, author_id, versi_terakhir) VALUES ($1, $2, $3)
       ON CONFLICT (poem_id) DO UPDATE
         SET versi_terakhir = GREATEST(poem_ownership.versi_terakhir, EXCLUDED.versi_terakhir)`,
      [p.poem_id, p.author_id, p.version],
    );
  }
}
