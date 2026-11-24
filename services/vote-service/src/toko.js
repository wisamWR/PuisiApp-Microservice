/**
 * Toko suara di Redis (vote-live). Antarmuka yang sama diimplementasikan
 * tiruan di test/bantu.js supaya app dan proyeksi bisa diuji tanpa Redis.
 */
import { createClient } from 'redis';
import {
  jalankanSkrip,
  kunci,
  SKRIP_BATAL,
  SKRIP_LIHAT,
  SKRIP_META,
  SKRIP_RATE,
  SKRIP_SUARA,
} from './skrip.js';

const SEHARI_MS = 24 * 60 * 60 * 1000;

/**
 * @param {{ url?: string, log: { info: Function, warn: Function } }} o
 */
export async function buatKlienRedis(o) {
  const klien = createClient({
    url: o.url,
    socket: {
      host: process.env.REDIS_HOST ?? 'localhost',
      port: Number(process.env.REDIS_PORT ?? 6379),
      connectTimeout: 2000,
      reconnectStrategy: (n) => Math.min(250 * 2 ** n, 5000),
    },
    password: o.url ? undefined : process.env.REDIS_PASSWORD || undefined,
    // Suara tidak boleh menunggu tanpa batas saat Redis putus: langsung gagal (503).
    disableOfflineQueue: true,
  });
  let lapor = true;
  klien.on('error', (err) => {
    if (lapor) o.log.warn('Redis tidak tersedia', { err });
    lapor = false;
  });
  klien.on('ready', () => {
    lapor = true;
    o.log.info('Redis siap');
  });
  await klien.connect();
  return klien;
}

/**
 * @param {import('redis').RedisClientType} klien
 */
export function buatToko(klien) {
  const sha = new Map();
  const skrip = (s, keys, args) => jalankanSkrip(klien, sha, s, keys, args);

  return {
    siap: () => klien.isReady,

    /** @returns {Promise<{kode: string, lama: number, baru: number, up: number, down: number, seq: number, status: string}>} */
    async beriSuara(poemId, userId, nilai) {
      const r = await skrip(SKRIP_SUARA, [kunci.suara(poemId), kunci.hitung(poemId), kunci.meta(poemId)], [userId, nilai]);
      return { kode: r[0], lama: r[1], baru: r[2], up: r[3], down: r[4], seq: r[5], status: r[6] };
    },

    /** @returns {Promise<boolean>} true bila suara berhasil dikembalikan */
    async batalkan(poemId, userId, lama, baru, seq) {
      const r = await skrip(SKRIP_BATAL, [kunci.suara(poemId), kunci.hitung(poemId)], [userId, lama, baru, seq]);
      return r === 1;
    },

    /** @returns {Promise<{owner: string|null, status: string|null, up: number, down: number, nilai: number}>} */
    async lihat(poemId, userId) {
      const r = await skrip(SKRIP_LIHAT, [kunci.suara(poemId), kunci.hitung(poemId), kunci.meta(poemId)], [userId]);
      return { owner: r[0] || null, status: r[1] || null, up: r[2], down: r[3], nilai: r[4] };
    },

    /** @returns {Promise<boolean>} true bila status berubah */
    async perbaruiMeta(poemId, { status, waktuMs, owner = '' }) {
      return (await skrip(SKRIP_META, [kunci.meta(poemId)], [status, waktuMs, owner])) === 1;
    },

    /** Tandai akun baru sampai berumur 24 jam (kunci kedaluwarsa sendiri). */
    async catatAkun(userId, dibuatMs, sekarangMs = Date.now()) {
      const sisa = dibuatMs + SEHARI_MS - sekarangMs;
      if (sisa <= 0) return false;
      await klien.set(kunci.akunBaru(userId), '1', { PX: Math.ceil(sisa) });
      return true;
    },

    async akunBaru(userId) {
      return (await klien.exists(kunci.akunBaru(userId))) === 1;
    },

    /** @returns {Promise<{jumlah: number, sisaDetik: number}>} */
    async hitungRate(userId, sekarangMs = Date.now()) {
      const menit = Math.floor(sekarangMs / 60_000);
      const jumlah = await skrip(SKRIP_RATE, [kunci.rateLimit(userId, menit)], [70]);
      return { jumlah, sisaDetik: Math.max(1, 60 - Math.floor((sekarangMs % 60_000) / 1000)) };
    },
  };
}
