/**
 * Daftar cabut access token (T1.4). Kunci: cabut:<jti>, nilai "1".
 * TTL = sisa masa berlaku token, jadi entri hilang sendiri setelah token kedaluwarsa
 * dan daftar tidak tumbuh tanpa batas.
 */
export function buatDaftarCabut(redis) {
  return {
    /** @param {string} jti @param {number} exp waktu kedaluwarsa (detik epoch) */
    async tambah(jti, exp) {
      const sisa = exp - Math.floor(Date.now() / 1000);
      if (!jti || sisa <= 0) return; // sudah kedaluwarsa, tidak perlu dicatat
      await redis.set(`cabut:${jti}`, '1', { EX: sisa });
    },

    /** @returns {Promise<boolean>} true jika token sudah dicabut */
    async sudahDicabut(jti) {
      if (!jti) return false;
      return (await redis.exists(`cabut:${jti}`)) === 1;
    },
  };
}
