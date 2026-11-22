/**
 * Keadaan pemrosesan di Redis.
 *
 *   proses:{poem_id}       hash  author_id, versi (terbaru), publikasi, publikasi_at, diubah_at
 *   proses:{poem_id}:v{n}  hash  mulai_at, l:<langkah> = waktu selesai, selesai_at
 *   status:{poem_id}       kanal pub/sub: snapshot JSON setiap ada perubahan
 *
 * Semua kunci punya TTL (bawaan 7 hari), karena status ini hanya berguna
 * selama pemrosesan. Perubahan ditulis lewat skrip Lua supaya atomik walau
 * processing-tracker berjalan lebih dari satu replika.
 */
import { createClient } from 'redis';
import { buatSnapshot } from './langkah.js';

export const kunciPuisi = (poemId) => `proses:${poemId}`;
export const kunciVersi = (poemId, versi) => `proses:${poemId}:v${versi}`;
export const kanal = (poemId) => `status:${poemId}`;

// KEYS[1]=puisi KEYS[2]=versi; ARGV: versi, author_id ('' = tidak diubah), sekarang, ttl, field langkah ('' = tidak ada)
// Mengembalikan 1 bila field langkah baru ditandai (pertama kali).
const LUA_CATAT = `
if ARGV[2] ~= '' then redis.call('HSET', KEYS[1], 'author_id', ARGV[2]) end
local lama = tonumber(redis.call('HGET', KEYS[1], 'versi') or '0')
if tonumber(ARGV[1]) > lama then redis.call('HSET', KEYS[1], 'versi', ARGV[1]) end
redis.call('HSET', KEYS[1], 'diubah_at', ARGV[3])
redis.call('HSETNX', KEYS[2], 'mulai_at', ARGV[3])
local baru = 0
if ARGV[5] ~= '' then baru = redis.call('HSETNX', KEYS[2], ARGV[5], ARGV[3]) end
redis.call('EXPIRE', KEYS[1], ARGV[4])
redis.call('EXPIRE', KEYS[2], ARGV[4])
return baru`;

// KEYS[1]=puisi; ARGV: status, waktu event, sekarang, ttl. DELETED final; event lebih lama diabaikan.
const LUA_PUBLIKASI = `
local kini = redis.call('HGET', KEYS[1], 'publikasi')
local pada = redis.call('HGET', KEYS[1], 'publikasi_at')
if kini == 'DELETED' then return 0 end
if ARGV[1] ~= 'DELETED' and pada and pada > ARGV[2] then return 0 end
redis.call('HSET', KEYS[1], 'publikasi', ARGV[1], 'publikasi_at', ARGV[2], 'diubah_at', ARGV[3])
redis.call('EXPIRE', KEYS[1], ARGV[4])
return 1`;

/** Klien Redis dari env REDIS_HOST / REDIS_PORT / REDIS_PASSWORD, atau url. */
export function buatKlienRedis(url) {
  return createClient({
    url,
    socket: {
      host: process.env.REDIS_HOST ?? 'localhost',
      port: Number(process.env.REDIS_PORT ?? 6379),
      connectTimeout: 2000,
      reconnectStrategy: (n) => Math.min(250 * 2 ** n, 5000),
    },
    password: url ? undefined : process.env.REDIS_PASSWORD || undefined,
  });
}

/**
 * @param {ReturnType<typeof createClient>} redis
 * @param {{ langkah: string[], ttlDetik?: number }} o
 */
export function buatKeadaan(redis, o) {
  const ttl = String(o.ttlDetik ?? (Number(process.env.STATUS_TTL_DETIK) || 7 * 24 * 3600));

  const catat = (poemId, versi, { authorId = '', langkah = '', sekarang }) =>
    redis.eval(LUA_CATAT, {
      keys: [kunciPuisi(poemId), kunciVersi(poemId, versi)],
      arguments: [String(versi), authorId ?? '', sekarang, ttl, langkah ? `l:${langkah}` : ''],
    });

  return {
    /** poem.submitted / poem.revised */
    mulai: (poemId, versi, authorId, sekarang) => catat(poemId, versi, { authorId, sekarang }),

    /** @returns {Promise<boolean>} true bila langkah baru pertama kali ditandai */
    async langkahSelesai(poemId, versi, langkah, sekarang) {
      return (await catat(poemId, versi, { langkah, sekarang })) === 1;
    },

    /** Tandai versi selesai; mengembalikan selesai_at (yang pertama tercatat). */
    async tandaiSelesai(poemId, versi, sekarang) {
      await redis.hSetNX(kunciVersi(poemId, versi), 'selesai_at', sekarang);
      return redis.hGet(kunciVersi(poemId, versi), 'selesai_at');
    },

    async publikasi(poemId, status, waktuEvent, sekarang) {
      return (await redis.eval(LUA_PUBLIKASI, {
        keys: [kunciPuisi(poemId)],
        arguments: [status, waktuEvent, sekarang, ttl],
      })) === 1;
    },

    /** Langkah selesai untuk satu versi. */
    async langkahVersi(poemId, versi) {
      const h = await redis.hGetAll(kunciVersi(poemId, versi));
      return o.langkah.filter((l) => h[`l:${l}`]);
    },

    /** @returns {Promise<object|null>} snapshot versi terbaru, null bila puisi tidak dikenal */
    async snapshot(poemId) {
      const puisi = await redis.hGetAll(kunciPuisi(poemId));
      if (!puisi || Object.keys(puisi).length === 0) return null;
      const versi = await redis.hGetAll(kunciVersi(poemId, Number(puisi.versi) || 1));
      return { author_id: puisi.author_id || null, snapshot: buatSnapshot({ poemId, puisi, versi, langkah: o.langkah }) };
    },

    /** Kirim snapshot ke semua replika status-stream-service. */
    umumkan: (poemId, snapshot) => redis.publish(kanal(poemId), JSON.stringify(snapshot)),
  };
}
