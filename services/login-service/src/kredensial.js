/**
 * Handler event user.registered: simpan salinan kredensial ke tabel credentials.
 * Dijalankan di dalam transaksi konsumen (store.proses), jadi idempoten lewat event_id.
 * Versi basi (aggregate_version lebih lama) diabaikan oleh pustaka lewat versiTersimpan.
 */
export async function simpanKredensial(event, { tx }) {
  const p = event.payload;
  await tx.query(
    `INSERT INTO credentials (id, username, password_hash, role)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE
       SET username = EXCLUDED.username,
           password_hash = EXCLUDED.password_hash,
           role = EXCLUDED.role,
           updated_at = now()`,
    [p.id, p.username, p.password_hash, p.role ?? 'writer'],
  );
}
