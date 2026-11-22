/**
 * Hapus akun (T1.7). Konfirmasi kata sandi wajib. Akun ditandai dihapus dan event user.deleted
 * (deletion_status: pending) ditulis ke outbox dalam satu transaksi.
 */
import { verify } from '@node-rs/argon2';
import { buatEvent, simpanDenganOutbox } from '@puisiapp/events';

export const EVENT_HAPUS = 'user.deleted';

/** @returns {Promise<{status: 'ok'|'tidak_ada'|'sudah'|'salah'}>} */
export async function hapusAkun(pool, id, password, ctx = {}) {
  return simpanDenganOutbox(pool, async (tx) => {
    const { rows } = await tx.query(
      'SELECT id, password_hash, dihapus_pada FROM accounts WHERE id = $1 FOR UPDATE',
      [id],
    );
    const akun = rows[0];
    if (!akun) return { hasil: { status: 'tidak_ada' }, event: null };
    if (akun.dihapus_pada) return { hasil: { status: 'sudah' }, event: null };

    let cocok = false;
    try {
      cocok = await verify(akun.password_hash, password);
    } catch {
      cocok = false;
    }
    if (!cocok) return { hasil: { status: 'salah' }, event: null };

    const { rows: [baru] } = await tx.query(
      'UPDATE accounts SET dihapus_pada = now(), version = version + 1 WHERE id = $1 RETURNING version',
      [id],
    );
    const event = buatEvent(EVENT_HAPUS, id, baru.version, { deletion_status: 'pending' }, { correlationId: ctx.correlationId });
    return { hasil: { status: 'ok' }, event };
  });
}
