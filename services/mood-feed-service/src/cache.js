import { DAFTAR_EMOSI, DAFTAR_MODE } from './skor.js';

export function buatCacheFeed(redisClient, { ttlDetik = 60, log } = {}) {
  let hits = 0;
  let misses = 0;

  function semuaKunci() {
    const keys = [];
    for (const e of DAFTAR_EMOSI) {
      for (const m of DAFTAR_MODE) {
        keys.push(`mood_feed:${e}:${m}`);
      }
    }
    return keys;
  }

  return {
    async ambil(emosi, mode) {
      if (!redisClient) {
        misses += 1;
        return null;
      }
      try {
        const raw = await redisClient.get(`mood_feed:${emosi}:${mode}`);
        if (!raw) {
          misses += 1;
          return null;
        }
        hits += 1;
        return JSON.parse(raw);
      } catch (err) {
        misses += 1;
        log?.warn?.('gagal membaca cache redis', { err: String(err) });
        return null;
      }
    },

    async simpan(emosi, mode, data) {
      if (!redisClient) return;
      try {
        await redisClient.set(`mood_feed:${emosi}:${mode}`, JSON.stringify(data), {
          EX: ttlDetik,
        });
      } catch (err) {
        log?.warn?.('gagal menulis cache redis', { err: String(err) });
      }
    },

    async invalidasiSemua() {
      if (!redisClient) return;
      try {
        await redisClient.del(semuaKunci());
      } catch (err) {
        log?.warn?.('gagal invalidasi cache redis', { err: String(err) });
      }
    },

    statistik() {
      const total = hits + misses;
      return {
        hits,
        misses,
        hit_ratio: total === 0 ? 1 : Number((hits / total).toFixed(4)),
      };
    },
  };
}
