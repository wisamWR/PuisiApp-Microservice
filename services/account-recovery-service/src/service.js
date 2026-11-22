import { randomUUID } from 'node:crypto';
import { hash, Algorithm } from '@node-rs/argon2';
import { buatEvent, simpanDenganOutbox } from '@puisiapp/events';
import { buatTokenMentah, hashToken, hitungKedaluwarsa, TOKEN_TTL_MENIT } from './token.js';

export class RecoveryError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'RecoveryError';
    this.status = status;
  }
}

export function hashPasswordBaru(password) {
  return hash(password, { algorithm: Algorithm.Argon2id });
}

function buatActionUrl(baseUrl, jenis, token) {
  const bersih = (baseUrl || 'http://localhost:8080').replace(/\/+$/, '');
  if (jenis === 'verify_email') {
    return `${bersih}/verify-email?token=${encodeURIComponent(token)}`;
  }
  return `${bersih}/reset-password?token=${encodeURIComponent(token)}`;
}

/**
 * Handler event user.registered: mencatat proyeksi akun, membuat token verifikasi
 * berlaku 30 menit, dan menerbitkan event email.send.requested lewat outbox.
 */
export async function tanganiUserRegistered(event, { tx }, appBaseUrl = '') {
  const payload = event?.payload || {};
  const userId = payload.id || payload.user_id || event?.aggregate_id;
  if (!userId) return;

  const email = payload.email || `${userId}@placeholder.local`;
  const username = payload.username || null;

  const tokenMentah = buatTokenMentah();
  const tokenHash = hashToken(tokenMentah);
  const expiresAt = hitungKedaluwarsa(TOKEN_TTL_MENIT);

  await tx.query(
    `INSERT INTO recovery_accounts (user_id, email, username, email_verified, updated_at)
     VALUES ($1, $2, $3, FALSE, now())
     ON CONFLICT (user_id) DO UPDATE
       SET email = COALESCE(EXCLUDED.email, recovery_accounts.email),
           username = COALESCE(EXCLUDED.username, recovery_accounts.username),
           updated_at = now()`,
    [userId, email, username],
  );

  await tx.query(
    `INSERT INTO recovery_tokens (id, user_id, jenis, token_hash, expires_at)
     VALUES ($1, $2, 'verify_email', $3, $4)`,
    [randomUUID(), userId, tokenHash, expiresAt.toISOString()],
  );

  const emailEvent = buatEvent(
    'email.send.requested',
    userId,
    1,
    {
      to: email,
      template: 'verify_email',
      user_id: userId,
      username,
      token: tokenMentah,
      action_url: buatActionUrl(appBaseUrl, 'verify_email', tokenMentah),
      expires_at: expiresAt.toISOString(),
    },
    {
      correlationId: event?.correlation_id,
      causationId: event?.event_id ?? null,
    },
  );

  await simpanDenganOutbox(tx, async () => ({ hasil: null, event: emailEvent }));
}

export async function verifikasiEmail(pool, token) {
  if (!token || typeof token !== 'string') {
    throw new RecoveryError('token wajib diisi', 400);
  }

  const hashed = hashToken(token.trim());
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `UPDATE recovery_tokens
          SET used_at = now()
        WHERE token_hash = $1
          AND jenis = 'verify_email'
          AND used_at IS NULL
          AND expires_at > now()
      RETURNING user_id`,
      [hashed],
    );

    if (rows.length === 0) {
      await client.query('ROLLBACK');
      throw new RecoveryError('token verifikasi tidak valid, sudah dipakai, atau kedaluwarsa', 400);
    }

    const userId = rows[0].user_id;
    await client.query(
      `UPDATE recovery_accounts
          SET email_verified = TRUE, updated_at = now()
        WHERE user_id = $1`,
      [userId],
    );

    await client.query('COMMIT');
    return { user_id: userId, email_verified: true };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function mintaResetPassword(pool, email, ctx = {}, appBaseUrl = '') {
  if (!email || typeof email !== 'string') {
    return { accepted: true };
  }

  const normalizedEmail = email.trim().toLowerCase();
  const { rows } = await pool.query(
    `SELECT user_id, email, username
       FROM recovery_accounts
      WHERE lower(email) = $1
      LIMIT 1`,
    [normalizedEmail],
  );

  if (rows.length === 0) {
    return { accepted: true };
  }

  const akun = rows[0];
  const tokenMentah = buatTokenMentah();
  const tokenHash = hashToken(tokenMentah);
  const expiresAt = hitungKedaluwarsa(TOKEN_TTL_MENIT);

  await simpanDenganOutbox(pool, async (tx) => {
    await tx.query(
      `INSERT INTO recovery_tokens (id, user_id, jenis, token_hash, expires_at)
       VALUES ($1, $2, 'reset_password', $3, $4)`,
      [randomUUID(), akun.user_id, tokenHash, expiresAt.toISOString()],
    );

    const emailEvent = buatEvent(
      'email.send.requested',
      akun.user_id,
      1,
      {
        to: akun.email,
        template: 'reset_password',
        user_id: akun.user_id,
        username: akun.username,
        token: tokenMentah,
        action_url: buatActionUrl(appBaseUrl, 'reset_password', tokenMentah),
        expires_at: expiresAt.toISOString(),
      },
      { correlationId: ctx.correlationId },
    );

    return { hasil: null, event: emailEvent };
  });

  return { accepted: true };
}

export async function cabutSemuaRefreshTokenUser(redis, userId) {
  if (!redis || !userId) return 0;
  let dihapus = 0;
  for await (const kunci of redis.scanIterator({ MATCH: 'rt:*', COUNT: 100 })) {
    const raw = await redis.get(kunci);
    if (!raw) continue;
    try {
      const data = JSON.parse(raw);
      if (data && data.sub === userId) {
        await redis.del(kunci);
        dihapus += 1;
      }
    } catch {
      // Abaikan entri rusak
    }
  }
  return dihapus;
}

export async function resetPassword(pool, { token, password }, deps = {}, ctx = {}) {
  if (!token || typeof token !== 'string' || !password || typeof password !== 'string') {
    throw new RecoveryError('token dan password baru wajib diisi', 400);
  }
  if (password.length < 8) {
    throw new RecoveryError('password minimal 8 karakter', 400);
  }

  const hashedToken = hashToken(token.trim());
  const passwordHash = await hashPasswordBaru(password);

  const hasil = await simpanDenganOutbox(pool, async (tx) => {
    const { rows } = await tx.query(
      `UPDATE recovery_tokens
          SET used_at = now()
        WHERE token_hash = $1
          AND jenis = 'reset_password'
          AND used_at IS NULL
          AND expires_at > now()
      RETURNING user_id`,
      [hashedToken],
    );

    if (rows.length === 0) {
      throw new RecoveryError('token reset tidak valid, sudah dipakai, atau kedaluwarsa', 400);
    }

    const userId = rows[0].user_id;
    await tx.query(
      `UPDATE recovery_accounts SET updated_at = now() WHERE user_id = $1`,
      [userId],
    );

    const resetEvent = buatEvent(
      'user.password.reset',
      userId,
      1,
      {
        id: userId,
        password_hash: passwordHash,
      },
      { correlationId: ctx.correlationId },
    );

    return { hasil: { user_id: userId, reset: true }, event: resetEvent };
  });

  if (deps.redis) {
    await cabutSemuaRefreshTokenUser(deps.redis, hasil.user_id);
  }

  return hasil;
}
