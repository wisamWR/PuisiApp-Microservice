/**
 * Penerbitan dan verifikasi access token JWT RS256 (T1.2).
 * Fungsi murni terhadap kunci yang diberikan: tidak membaca lingkungan sendiri,
 * sehingga mudah diuji.
 *
 * Klaim: sub (id akun), username, role. Masa berlaku 15 menit (bawaan).
 */
import { SignJWT, jwtVerify, importPKCS8, importSPKI } from 'jose';

export const ALGORITMA = 'RS256';
export const MASA_BERLAKU_BAWAAN = '15m';
export const ROLE_VALID = ['writer', 'moderator', 'admin'];

/** @returns {Promise<{ sign: Function, verify: Function }>} */
export async function buatPenerbitToken({ privateKeyPem, publicKeyPem, issuer, audience, masaBerlaku = MASA_BERLAKU_BAWAAN }) {
  const kunciPrivat = await importPKCS8(privateKeyPem, ALGORITMA);
  const kunciPublik = await importSPKI(publicKeyPem, ALGORITMA);

  return {
    /** @param {{ sub: string, username: string, role: string }} klaim */
    async sign({ sub, username, role }) {
      if (!ROLE_VALID.includes(role)) throw new Error(`role tidak dikenal: ${role}`);
      return new SignJWT({ username, role })
        .setProtectedHeader({ alg: ALGORITMA, typ: 'JWT' })
        .setSubject(sub)
        .setIssuer(issuer)
        .setAudience(audience)
        .setIssuedAt()
        .setExpirationTime(masaBerlaku)
        .sign(kunciPrivat);
    },

    /** @returns {Promise<{ sub: string, username: string, role: string } | null>} null jika tidak valid */
    async verify(token) {
      try {
        const { payload } = await jwtVerify(token, kunciPublik, {
          algorithms: [ALGORITMA],
          issuer,
          audience,
        });
        if (!ROLE_VALID.includes(payload.role)) return null;
        return { sub: payload.sub, username: payload.username, role: payload.role };
      } catch {
        return null;
      }
    },
  };
}
