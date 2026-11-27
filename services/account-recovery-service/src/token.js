import { createHash, randomBytes } from 'node:crypto';

export const TOKEN_TTL_MENIT = 30;

export function buatTokenMentah() {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

export function hitungKedaluwarsa(menit = TOKEN_TTL_MENIT) {
  return new Date(Date.now() + menit * 60 * 1000);
}
