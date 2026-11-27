// Pengisian read model pencarian dari event. Idempotensi lewat buatStorePg (processed_event).
// Sumber isi puisi: poem.submitted dan poem.revised (keduanya membawa title, body, author_id).
// poem.published hanya mengubah status dan published_at, tidak mengisi judul atau isi.
// Puisi hidden atau deleted tidak dihapus, hanya statusnya diubah.

export async function tanganiPuisi(event, { tx }) {
  const p = event.payload || {};
  const id = p.poem_id || event.aggregate_id;
  if (!id) return;

  const jenis = event.event_type;

  if (jenis === 'poem.submitted' || jenis === 'poem.revised') {
    await tx.query(
      `INSERT INTO poem_cari (poem_id, author_id, status, judul, isi, versi, diubah_at)
       VALUES ($1, $2, 'PROCESSING', $3, $4, $5, now())
       ON CONFLICT (poem_id) DO UPDATE SET
         author_id = EXCLUDED.author_id,
         judul = EXCLUDED.judul,
         isi = EXCLUDED.isi,
         versi = EXCLUDED.versi,
         diubah_at = now()
       WHERE poem_cari.versi <= EXCLUDED.versi`,
      [id, p.author_id ?? '', p.title ?? '', p.body ?? '', p.version ?? 1],
    );
    return;
  }

  if (jenis === 'poem.published') {
    await tx.query(
      `UPDATE poem_cari SET status = 'PUBLISHED',
         published_at = COALESCE(published_at, $2::timestamptz), diubah_at = now()
       WHERE poem_id = $1`,
      [id, p.published_at ?? null],
    );
    return;
  }

  if (jenis === 'poem.keywords.extracted') {
    const kata = (p.keywords || []).map((k) => k.term ?? k).join(' ');
    await tx.query(
      `UPDATE poem_cari SET kata_kunci = $2, diubah_at = now() WHERE poem_id = $1`,
      [id, kata],
    );
    return;
  }

  if (jenis === 'poem.hidden') {
    await tx.query(`UPDATE poem_cari SET status = 'HIDDEN', diubah_at = now() WHERE poem_id = $1`, [id]);
    return;
  }

  if (jenis === 'poem.deleted') {
    await tx.query(`UPDATE poem_cari SET status = 'DELETED', diubah_at = now() WHERE poem_id = $1`, [id]);
  }
}

export async function tanganiProfil(event, { tx }) {
  const p = event.payload || {};
  const userId = event.aggregate_id ?? p.user_id ?? p.id;
  if (!userId) return;
  await tx.query(
    `INSERT INTO penulis_cari (user_id, display_name, diubah_at)
     VALUES ($1, $2, now())
     ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name, diubah_at = now()`,
    [userId, p.display_name ?? ''],
  );
}
