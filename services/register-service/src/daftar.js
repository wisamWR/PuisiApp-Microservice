/**
 * Logika registrasi: hash kata sandi, simpan akun, lalu tulis dua event ke outbox dalam SATU transaksi:
 *   - user.registered          { username, email }                 (kontrak T0.6, untuk semua konsumen)
 *   - user.credentials.created { username, password_hash, role }   (hanya untuk login-service)
 * Kata sandi asli tidak pernah masuk log atau event.
 */
import { randomUUID } from 'node:crypto';
import { hash, Algorithm } from '@node-rs/argon2';
import { buatEvent, simpanDenganOutbox } from '@puisiapp/events';

export class GalatDuplikat extends Error {
  constructor() {
    super('username atau email sudah dipakai');
    this.name = 'GalatDuplikat';
    this.status = 409;
  }
}

/** Argon2id dengan parameter bawaan @node-rs/argon2. */
export function hashKataSandi(password) {
  return hash(password, { algorithm: Algorithm.Argon2id });
}

/**
 * @param {import('pg').Pool} pool
 * @param {{ username: string, email: string, password: string, display_name: string }} data
 * @param {{ correlationId?: string }} [ctx]
 * @returns {Promise<{ id: string, username: string }>}
 */
export async function daftarAkun(pool, data, ctx = {}) {
  const id = randomUUID();
  const passwordHash = await hashKataSandi(data.password);

  try {
    return await simpanDenganOutbox(pool, async (tx) => {
      await tx.query(
        `INSERT INTO accounts (id, username, email, display_name, password_hash, role)
         VALUES ($1, $2, $3, $4, $5, 'writer')`,
        [id, data.username, data.email, data.display_name, passwordHash],
      );
      const eventUser = buatEvent(
        'user.registered',
        id,
        1,
        { id, username: data.username, email: data.email, display_name: data.display_name, role: 'writer' },
        { correlationId: ctx.correlationId },
      );
      const eventKredensial = buatEvent(
        'user.credentials.created',
        id,
        1,
        { username: data.username, password_hash: passwordHash, role: 'writer' },
        { correlationId: ctx.correlationId },
      );
      return { hasil: { id, username: data.username }, events: [eventUser, eventKredensial] };
    });
  } catch (err) {
    // 23505 = unique_violation: username atau email sudah ada
    if (err && err.code === '23505') throw new GalatDuplikat();
    throw err;
  }
}
