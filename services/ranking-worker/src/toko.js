/**
 * ranking-store (Redis) milik ranking-worker, terpisah dari vote-live:
 *   rank:v:{poem_id}  HASH user_id -> "nilai|bobot|seq"  (kontribusi tiap pengguna)
 *   rank:c:{poem_id}  HASH up, down, wup, wdown, seq, pub (wilson terakhir yang diterbitkan)
 *
 * Kontribusi disimpan per pengguna (bukan hanya delta previous_value ->
 * vote_value), sehingga bobot yang berubah (akun melewati 24 jam) tetap
 * dikurangi dengan bobot lamanya, dan suara dengan seq <= seq tersimpan
 * (duplikat atau tiba terlambat) diabaikan.
 */
import { createClient } from 'redis';

export const kunci = {
  suara: (poemId) => `rank:v:${poemId}`,
  hitung: (poemId) => `rank:c:${poemId}`,
};

/**
 * KEYS: suara, hitung. ARGV: user_id, nilai, bobot, seq.
 * Balasan: [diterapkan(1|0), up, down, wup, wdown, seq_puisi]; angka pecahan sebagai string
 * (Redis memotong angka Lua menjadi integer).
 */
export const SKRIP_TERAPKAN = `
local c = redis.call('HMGET', KEYS[2], 'up', 'down', 'wup', 'wdown', 'seq')
local up, down = tonumber(c[1] or '0'), tonumber(c[2] or '0')
local wup, wdown = tonumber(c[3] or '0'), tonumber(c[4] or '0')
local seqPuisi = tonumber(c[5] or '0')
local seq = tonumber(ARGV[4])
local f = function(x) return string.format('%.17g', x) end

local lama = redis.call('HGET', KEYS[1], ARGV[1])
local lv, lw, ls = 0, 0, 0
if lama then
  local a, b, s = string.match(lama, '^(-?%d+)|([^|]+)|(%d+)$')
  lv, lw, ls = tonumber(a), tonumber(b), tonumber(s)
end
if ls >= seq then return {0, up, down, f(wup), f(wdown), seqPuisi} end

if lv == 1 then up = up - 1; wup = wup - lw elseif lv == -1 then down = down - 1; wdown = wdown - lw end
local v, w = tonumber(ARGV[2]), tonumber(ARGV[3])
if v == 1 then up = up + 1; wup = wup + w elseif v == -1 then down = down + 1; wdown = wdown + w end
if seq > seqPuisi then seqPuisi = seq end

redis.call('HSET', KEYS[1], ARGV[1], ARGV[2] .. '|' .. ARGV[3] .. '|' .. ARGV[4])
redis.call('HSET', KEYS[2], 'up', up, 'down', down, 'wup', f(wup), 'wdown', f(wdown), 'seq', seqPuisi)
return {1, up, down, f(wup), f(wdown), seqPuisi}
`;

/**
 * Klaim penerbitan: catat wilson baru bila berbeda lebih dari ambang dari
 * yang terakhir diterbitkan. Pengecualian: selama wilson 0 (belum ada suara
 * positif), setiap perubahan skor tetap diterbitkan agar skor negatif di
 * read model tidak macet. pub disimpan sebagai "wilson|skor".
 * KEYS: hitung. ARGV: wilson, ambang, skor. Balasan: [1|0, pub_sebelumnya ('' = belum pernah)]
 */
export const SKRIP_KLAIM = `
local pub = redis.call('HGET', KEYS[1], 'pub')
local w, skor = tonumber(ARGV[1]), tonumber(ARGV[3])
local baru = ARGV[1] .. '|' .. ARGV[3]
if not pub then
  redis.call('HSET', KEYS[1], 'pub', baru)
  return {1, ''}
end
local pw, ps = string.match(pub, '^([^|]+)|(-?%d+)$')
pw, ps = tonumber(pw), tonumber(ps)
if math.abs(w - pw) > tonumber(ARGV[2]) or (w == 0 and skor ~= ps) then
  redis.call('HSET', KEYS[1], 'pub', baru)
  return {1, pub}
end
return {0, pub}
`;

/** Batalkan klaim bila penerbitan gagal (hanya bila belum ditimpa klaim lain). KEYS: hitung. ARGV: "wilson|skor", sebelumnya. */
export const SKRIP_BATAL_KLAIM = `
if redis.call('HGET', KEYS[1], 'pub') ~= ARGV[1] then return 0 end
if ARGV[2] == '' then redis.call('HDEL', KEYS[1], 'pub') else redis.call('HSET', KEYS[1], 'pub', ARGV[2]) end
return 1
`;

async function jalankan(klien, cache, skrip, keys, args) {
  const opsi = { keys, arguments: args.map(String) };
  const sha = cache.get(skrip);
  if (sha) {
    try {
      return await klien.evalSha(sha, opsi);
    } catch (err) {
      if (!String(err?.message).includes('NOSCRIPT')) throw err;
    }
  }
  cache.set(skrip, await klien.scriptLoad(skrip));
  return klien.eval(skrip, opsi);
}

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
    disableOfflineQueue: true,
  });
  klien.on('error', (err) => o.log.warn('Redis tidak tersedia', { err }));
  await klien.connect();
  return klien;
}

/** Angka kecil negatif akibat pembulatan floating point (mis. -1e-16) dianggap 0. */
const rapikan = (x) => {
  const n = Number(x);
  return Math.abs(n) < 1e-9 ? 0 : n;
};

export function buatToko(klien) {
  const cache = new Map();
  return {
    siap: () => klien.isReady,
    /** @returns {Promise<{diterapkan: boolean, up: number, down: number, wup: number, wdown: number, seq: number}>} */
    async terapkan(poemId, userId, nilai, bobot, seq) {
      const r = await jalankan(klien, cache, SKRIP_TERAPKAN, [kunci.suara(poemId), kunci.hitung(poemId)], [userId, nilai, bobot, seq]);
      return { diterapkan: r[0] === 1, up: r[1], down: r[2], wup: rapikan(r[3]), wdown: rapikan(r[4]), seq: r[5] };
    },
    /** @returns {Promise<{klaim: boolean, sebelumnya: string}>} */
    async klaim(poemId, nilaiWilson, ambang, skor) {
      const r = await jalankan(klien, cache, SKRIP_KLAIM, [kunci.hitung(poemId)], [nilaiWilson, ambang, skor]);
      return { klaim: r[0] === 1, sebelumnya: r[1] ?? '' };
    },
    async batalKlaim(poemId, nilaiWilson, skor, sebelumnya) {
      await jalankan(klien, cache, SKRIP_BATAL_KLAIM, [kunci.hitung(poemId)], [`${nilaiWilson}|${skor}`, sebelumnya]);
    },
  };
}
