/**
 * Logika registrasi: hash kata sandi, simpan akun, dan tulis event user.registered
 * ke outbox dalam SATU transaksi (T1.1 butir 5).
 *
 * Kata sandi tidak pernah masuk ke log atau ke payload event. Payload hanya berisi
 * hash kredensial, sesuai kebutuhan login-service.
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

/** Argon2id dengan parameter bawaan @node-rs/argon2 (memori 19 MiB, 2 iterasi). */
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
      const event = buatEvent(
        'user.registered',
        id,
        1,
        {
          id,
          username: data.username,
          display_name: data.display_name,
          password_hash: passwordHash,
          role: 'writer',
        },
        { correlationId: ctx.correlationId },
      );
      return { hasil: { id, username: data.username }, event };
    });
  } catch (err) {
    // 23505 = unique_violation: username atau email sudah ada
    if (err && err.code === '23505') throw new GalatDuplikat();
    throw err;
  }
}
