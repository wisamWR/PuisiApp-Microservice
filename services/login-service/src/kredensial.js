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

/**
 * Konsumen user.role.changed (T1.7): perbarui peran di credentials.
 * Login berikutnya memakai peran ini saat menerbitkan token. Idempoten lewat event_id.
 */
const PERAN_VALID = ['reader', 'writer', 'moderator', 'admin'];

export async function ubahPeranKredensial(event, { tx }) {
  const role = event.payload?.new_role;
  if (!PERAN_VALID.includes(role)) return; // peran tidak dikenal: abaikan, jangan gagalkan konsumen
  await tx.query(
    'UPDATE credentials SET role = $2, updated_at = now() WHERE id = $1',
    [event.aggregate_id, role],
  );
}

