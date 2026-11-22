/**
 * Ubah peran akun (T1.7). Satu transaksi: kunci baris, ubah peran, naikkan version,
 * dan tulis outbox user.role.changed. Peran yang sama tidak menghasilkan event.
 */
import { buatEvent, simpanDenganOutbox } from '@puisiapp/events';

export const EVENT_PERAN = 'user.role.changed';

/**
 * @returns {Promise<{ status: 'ok', akun: object } | { status: 'tidak_ada' }>}
 */
export async function ubahPeran(pool, id, roleBaru, ctx = {}) {
  return simpanDenganOutbox(pool, async (tx) => {
    const { rows } = await tx.query(
      'SELECT id, username, role, version FROM accounts WHERE id = $1 FOR UPDATE',
      [id],
    );
    const akun = rows[0];
    if (!akun) return { hasil: { status: 'tidak_ada' }, event: null };

    if (akun.role === roleBaru) {
      return { hasil: { status: 'ok', akun: { id: akun.id, username: akun.username, role: akun.role, version: akun.version } }, event: null };
    }

    const { rows: [baru] } = await tx.query(
      `UPDATE accounts SET role = $2, version = version + 1
       WHERE id = $1
       RETURNING id, username, role, version`,
      [id, roleBaru],
    );

    // Payload sesuai kontrak user.role.changed: hanya old_role dan new_role.
    const event = buatEvent(
      EVENT_PERAN,
      baru.id,
      baru.version,
      { old_role: akun.role, new_role: baru.role },
      { correlationId: ctx.correlationId },
    );
    return { hasil: { status: 'ok', akun: { id: baru.id, username: baru.username, role: baru.role, version: baru.version } }, event };
  });
}
