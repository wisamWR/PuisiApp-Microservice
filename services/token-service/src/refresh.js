/**
 * Refresh token di Redis (T1.2 butir 3 dan 5).
 * - Disimpan sebagai hash SHA-256, token asli tidak pernah ada di Redis.
 * - Masa berlaku 7 hari.
 * - Rotasi: putar() mengambil dan menghapus token dalam satu operasi (GETDEL).
 *   Token yang sudah dipakai tidak ada lagi di Redis, jadi pemakaian ulang ditolak.
 */
import { createHash, randomBytes } from 'node:crypto';

export const MASA_REFRESH_DETIK = 7 * 24 * 60 * 60;

const hashToken = (token) => createHash('sha256').update(token).digest('hex');

/** @param {import('redis').RedisClientType} redis */
export function buatPenyimpanRefresh(redis) {
  return {
    /** @returns {Promise<string>} refresh token mentah untuk dikirim sebagai cookie */
    async terbitkan({ sub, username, role }) {
      const token = randomBytes(32).toString('base64url');
      await redis.set(`rt:${hashToken(token)}`, JSON.stringify({ sub, username, role }), { EX: MASA_REFRESH_DETIK });
      return token;
    },

    /** @returns {Promise<{ sub: string, username: string, role: string } | null>} null jika tidak ada atau sudah dipakai */
    async putar(token) {
      if (!token) return null;
      const raw = await redis.getDel(`rt:${hashToken(token)}`);
      return raw ? JSON.parse(raw) : null;
    },
  };
}
