/**
 * Logika profil. Setiap perubahan menulis baris outbox user.profile.updated dalam transaksi yang sama.
 */
import { buatEvent, simpanDenganOutbox } from '@puisiapp/events';

export const EVENT_PROFIL = 'user.profile.updated';

/** Konsumen user.registered: buat profil awal. Idempoten (ON CONFLICT DO NOTHING). */
export async function buatProfilAwal(event, { tx }) {
  const p = event.payload;
  await tx.query(
    `INSERT INTO profiles (id, username, display_name, bio)
     VALUES ($1, $2, $3, '')
     ON CONFLICT (id) DO NOTHING`,
    [p.id, p.username, p.display_name],
  );
}

export async function ambilProfil(pool, id) {
  const { rows } = await pool.query(
    'SELECT id, username, display_name, bio FROM profiles WHERE id = $1',
    [id],
  );
  return rows[0] ?? null;
}

/**
 * Ubah profil milik pengguna. id berasal dari header X-User-Id (gateway), tidak dari body:
 * dengan begitu pengguna tidak bisa mengubah profil orang lain.
 * @returns {Promise<object|null>} profil baru, atau null bila belum ada
 */
export async function ubahProfil(pool, id, { display_name, bio }, ctx = {}) {
  return simpanDenganOutbox(pool, async (tx) => {
    const { rows } = await tx.query(
      `UPDATE profiles
         SET display_name = $2, bio = $3, version = version + 1, updated_at = now()
       WHERE id = $1
       RETURNING id, username, display_name, bio, version, updated_at`,
      [id, display_name, bio],
    );
    const baru = rows[0];
    if (!baru) return { hasil: null, event: null };

    const event = buatEvent(
      EVENT_PROFIL,
      baru.id,
      baru.version,
      // Payload sesuai kontrak user.profile.updated (contracts/events): hanya display_name dan bio.
      // Identitas ada di aggregate_id, versi di aggregate_version.
      { display_name: baru.display_name, bio: baru.bio },
      { correlationId: ctx.correlationId },
    );
    return { hasil: baru, event };
  });
}
