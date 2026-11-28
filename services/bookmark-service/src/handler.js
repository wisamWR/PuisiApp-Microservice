// Read model ringkas dari event poem.* dan user.deleted. Idempotensi lewat buatStorePg.
// Urutan event tidak dijamin, jadi semua tulisan berupa upsert. status_at mencegah
// status lama menimpa yang baru, dan DELETED bersifat final.

const waktu = (event, nilai) => nilai ?? event.occurred_at ?? new Date().toISOString();

async function ubahStatus(tx, id, status, statusAt) {
  await tx.query(
    `INSERT INTO puisi_simpan (poem_id, status, status_at) VALUES ($1, $2, $3::timestamptz)
     ON CONFLICT (poem_id) DO UPDATE SET status = EXCLUDED.status, status_at = EXCLUDED.status_at, diubah_at = now()
     WHERE puisi_simpan.status <> 'DELETED'
       AND (puisi_simpan.status_at IS NULL OR puisi_simpan.status_at <= EXCLUDED.status_at)`,
    [id, status, statusAt],
  );
}

/**
 * @param {object} event
 * @param {{ tx: import('pg').PoolClient, hapusCache?: (poemId: string) => Promise<void> }} ctx
 */
export async function tanganiPuisi(event, { tx, hapusCache }) {
  const p = event.payload || {};
  const id = p.poem_id || event.aggregate_id;
  if (!id) return;

  switch (event.event_type) {
    case 'poem.submitted':
    case 'poem.revised': {
      const versi = Number(event.aggregate_version ?? p.version ?? 1) || 1;
      await tx.query(
        `INSERT INTO puisi_simpan (poem_id, judul, kutipan, versi) VALUES ($1, $2, $3, $4)
         ON CONFLICT (poem_id) DO UPDATE SET judul = EXCLUDED.judul, kutipan = EXCLUDED.kutipan,
           versi = EXCLUDED.versi, diubah_at = now()
         WHERE puisi_simpan.versi <= EXCLUDED.versi`,
        [id, p.title ?? null, p.quote_text ?? null, versi],
      );
      break;
    }
    case 'poem.published':
      await ubahStatus(tx, id, 'PUBLISHED', waktu(event, p.published_at));
      break;
    case 'poem.held':
      await ubahStatus(tx, id, 'HELD', waktu(event));
      break;
    case 'poem.hidden':
      await ubahStatus(tx, id, 'HIDDEN', waktu(event, p.hidden_at));
      break;
    case 'poem.deleted':
      await tx.query(
        `INSERT INTO puisi_simpan (poem_id, status, status_at) VALUES ($1, 'DELETED', now())
         ON CONFLICT (poem_id) DO UPDATE SET status = 'DELETED', status_at = now(), diubah_at = now()`,
        [id],
      );
      break;
    default:
      return;
  }

  // Pratinjau Open Graph di Redis tidak boleh menampilkan isi lama atau puisi yang disembunyikan.
  if (hapusCache) await hapusCache(id);
}

/** Akun dihapus: bookmark miliknya ikut dihapus. */
export async function tanganiHapusAkun(event, { tx }) {
  const userId = event.aggregate_id ?? event.payload?.id;
  if (!userId) return;
  await tx.query('DELETE FROM bookmark WHERE user_id = $1', [String(userId)]);
}
