process.env.SERVICE_NAME = 'account-recovery-service';

import test from 'node:test';
import assert from 'node:assert/strict';
import { buatTokenMentah, hashToken, hitungKedaluwarsa } from '../src/token.js';
import {
  cabutSemuaRefreshTokenUser,
  tanganiUserRegistered,
  verifikasiEmail,
  mintaResetPassword,
  resetPassword,
  statusEmail,
} from '../src/service.js';

function buatFakePool(initialTokens = [], initialAccounts = []) {
  const tokens = [...initialTokens];
  const accounts = [...initialAccounts];
  const outbox = [];

  const runQuery = async (sql, params = []) => {
    const q = sql.replace(/\s+/g, ' ').trim();

    if (q.startsWith('BEGIN') || q.startsWith('COMMIT') || q.startsWith('ROLLBACK')) {
      return { rows: [] };
    }

    if (q.includes('INSERT INTO recovery_accounts')) {
      const [userId, email, username] = params;
      const idx = accounts.findIndex((a) => a.user_id === userId);
      if (idx >= 0) {
        accounts[idx] = { ...accounts[idx], email: email ?? accounts[idx].email, username: username ?? accounts[idx].username };
      } else {
        accounts.push({ user_id: userId, email, username, email_verified: false });
      }
      return { rows: [] };
    }

    if (q.includes('INSERT INTO recovery_tokens')) {
      const [id, userId, tokenHash, expiresAt] = params;
      const jenis = 'verify_email';
      tokens.push({
        id,
        user_id: userId,
        jenis,
        token_hash: tokenHash,
        expires_at: new Date(expiresAt),
        used_at: null,
      });
      return { rows: [] };
    }

    if (q.includes('INSERT INTO outbox')) {
      const [eventId, aggregateType, aggregateId, eventType, payload, createdAt] = params;
      outbox.push({ eventId, aggregateType, aggregateId, eventType, payload, createdAt });
      return { rows: [] };
    }

    if (q.includes('UPDATE recovery_tokens SET used_at = now()')) {
      const [hashed] = params;
      const jenisMatch = q.match(/jenis = '([^']+)'/);
      const jenis = jenisMatch ? jenisMatch[1] : null;
      const row = tokens.find(
        (t) =>
          t.token_hash === hashed &&
          (!jenis || t.jenis === jenis) &&
          t.used_at === null &&
          new Date(t.expires_at).getTime() > Date.now(),
      );
      if (!row) return { rows: [] };
      row.used_at = new Date();
      return { rows: [{ user_id: row.user_id }] };
    }

    if (q.includes('UPDATE recovery_accounts SET email_verified = TRUE')) {
      const [userId] = params;
      const acc = accounts.find((a) => a.user_id === userId);
      if (acc) acc.email_verified = true;
      return { rows: [] };
    }

    if (q.includes('SELECT user_id, email, username FROM recovery_accounts')) {
      const [normalizedEmail] = params;
      const acc = accounts.find((a) => String(a.email).toLowerCase() === normalizedEmail);
      return { rows: acc ? [acc] : [] };
    }

    if (q.includes('SELECT email_verified FROM recovery_accounts')) {
      const [userId] = params;
      const acc = accounts.find((a) => a.user_id === userId);
      return { rows: acc ? [{ email_verified: acc.email_verified }] : [] };
    }

    if (q.includes('UPDATE recovery_accounts SET updated_at = now()')) {
      return { rows: [] };
    }

    return { rows: [] };
  };

  return {
    tokens,
    accounts,
    outbox,
    query: runQuery,
    async connect() {
      return {
        query: runQuery,
        release() {},
      };
    },
  };
}

test('token mentah berbeda dari hash SHA-256 dan kedaluwarsa 30 menit', () => {
  const token = buatTokenMentah();
  const hashed = hashToken(token);
  assert.notEqual(token, hashed);
  assert.equal(hashed.length, 64);

  const sebelum = Date.now() + 29 * 60 * 1000;
  const exp = hitungKedaluwarsa(30).getTime();
  const sesudah = Date.now() + 31 * 60 * 1000;
  assert.ok(exp > sebelum && exp < sesudah);
});

test('user.registered membuat token verifikasi & menerbitkan email.send.requested lewat outbox', async () => {
  const pool = buatFakePool();
  await tanganiUserRegistered(
    {
      event_id: 'evt-1',
      aggregate_id: '11111111-1111-1111-1111-111111111111',
      payload: {
        id: '11111111-1111-1111-1111-111111111111',
        username: 'sabila',
        email: 'sabila@example.com',
      },
    },
    { tx: pool },
    'http://localhost:8080',
  );

  assert.equal(pool.accounts.length, 1);
  assert.equal(pool.tokens.length, 1);
  assert.equal(pool.tokens[0].jenis, 'verify_email');
  assert.equal(pool.outbox.length, 1);
  assert.equal(pool.outbox[0].eventType, 'email.send.requested');
  assert.equal(pool.outbox[0].payload.payload.to, 'sabila@example.com');
  assert.equal(pool.outbox[0].payload.payload.template, 'verify_email');
});

test('verifikasi email berhasil sekali, lalu ditolak bila dipakai ulang atau kedaluwarsa', async () => {
  const validToken = buatTokenMentah();
  const expiredToken = buatTokenMentah();
  const pool = buatFakePool(
    [
      {
        id: 't1',
        user_id: 'u-1',
        jenis: 'verify_email',
        token_hash: hashToken(validToken),
        expires_at: hitungKedaluwarsa(30),
        used_at: null,
      },
      {
        id: 't2',
        user_id: 'u-1',
        jenis: 'verify_email',
        token_hash: hashToken(expiredToken),
        expires_at: new Date(Date.now() - 1000),
        used_at: null,
      },
    ],
    [{ user_id: 'u-1', email: 'sabila@example.com', username: 'sabila', email_verified: false }],
  );

  await assert.rejects(() => verifikasiEmail(pool, expiredToken), /kedaluwarsa|tidak valid/i);

  const ok = await verifikasiEmail(pool, validToken);
  assert.equal(ok.email_verified, true);
  assert.equal(pool.accounts[0].email_verified, true);

  await assert.rejects(() => verifikasiEmail(pool, validToken), /sudah dipakai|tidak valid/i);
});

test('forgot-password mengembalikan accepted untuk email terdaftar maupun tidak terdaftar', async () => {
  const pool = buatFakePool(
    [],
    [{ user_id: 'u-1', email: 'terdaftar@example.com', username: 'sabila', email_verified: true }],
  );

  const resTerdaftar = await mintaResetPassword(pool, 'terdaftar@example.com');
  const resTidakTerdaftar = await mintaResetPassword(pool, 'tidakada@example.com');

  assert.deepEqual(resTerdaftar, { accepted: true });
  assert.deepEqual(resTidakTerdaftar, { accepted: true });
  assert.equal(pool.outbox.length, 1);
  assert.equal(pool.outbox[0].payload.payload.template, 'reset_password');
});

test('reset-password memperbarui token sekali pakai & mencabut semua refresh token pengguna', async () => {
  const resetToken = buatTokenMentah();
  const pool = buatFakePool([
    {
      id: 't-rst',
      user_id: 'user-1',
      jenis: 'reset_password',
      token_hash: hashToken(resetToken),
      expires_at: hitungKedaluwarsa(30),
      used_at: null,
    },
  ]);

  const store = new Map([
    ['rt:hash1', JSON.stringify({ sub: 'user-1', username: 'sabila', role: 'writer' })],
    ['rt:hash2', JSON.stringify({ sub: 'user-1', username: 'sabila', role: 'writer' })],
    ['rt:hash3', JSON.stringify({ sub: 'user-2', username: 'bunga', role: 'writer' })],
  ]);

  const fakeRedis = {
    async *scanIterator() {
      for (const k of store.keys()) yield k;
    },
    async get(k) {
      return store.get(k) ?? null;
    },
    async del(k) {
      return store.delete(k) ? 1 : 0;
    },
  };

  const hasil = await resetPassword(pool, { token: resetToken, password: 'PasswordBaru123!' }, { redis: fakeRedis });
  assert.equal(hasil.reset, true);
  assert.equal(store.has('rt:hash1'), false);
  assert.equal(store.has('rt:hash2'), false);
  assert.equal(store.has('rt:hash3'), true);

  await assert.rejects(
    () => resetPassword(pool, { token: resetToken, password: 'PasswordBaru456!' }, { redis: fakeRedis }),
    /sudah dipakai|tidak valid/i,
  );
});

test('email-status: false sebelum verifikasi, true sesudah, 401 tanpa user', async () => {
  const userId = '33333333-3333-4333-8333-333333333333';
  const pool = buatFakePool([], [{ user_id: userId, email: 'x@example.com', username: 'x', email_verified: false }]);
  assert.deepEqual(await statusEmail(pool, userId), { user_id: userId, email_verified: false });
  pool.accounts[0].email_verified = true;
  assert.deepEqual(await statusEmail(pool, userId), { user_id: userId, email_verified: true });
  assert.deepEqual(await statusEmail(pool, 'tidak-ada'), { user_id: 'tidak-ada', email_verified: false });
  await assert.rejects(() => statusEmail(pool, undefined), (err) => err.status === 401);
});
