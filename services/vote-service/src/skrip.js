/**
 * Skrip Lua vote-service. Setiap skrip dijalankan atomik oleh Redis, jadi
 * "satu pengguna satu suara per puisi" dan hitungan naik/turun tidak pernah
 * balapan walau ratusan permintaan datang bersamaan.
 *
 * Kunci (semua per puisi, ditulis lewat fungsi di bawah agar konsisten
 * dengan skrip rekonsiliasi vote-persist-worker):
 *   vote:v:{poem_id}     HASH  user_id -> 1 | -1          (suara aktif)
 *   vote:c:{poem_id}     HASH  up, down, seq              (hitungan + nomor urut)
 *   vote:meta:{poem_id}  HASH  owner, status, status_ms   (salinan dari event puisi)
 *   vote:baru:{user_id}  STRING, TTL sampai akun berumur 24 jam
 *   vote:rl:{user_id}:{menit} STRING counter rate limit
 */

export const kunci = {
  suara: (poemId) => `vote:v:${poemId}`,
  hitung: (poemId) => `vote:c:${poemId}`,
  meta: (poemId) => `vote:meta:${poemId}`,
  akunBaru: (userId) => `vote:baru:${userId}`,
  rateLimit: (userId, menit) => `vote:rl:${userId}:${menit}`,
};

/**
 * Beri/ubah/tarik suara.
 * KEYS: suara, hitung, meta. ARGV: user_id, nilai_baru (1 | -1 | 0).
 * Balasan: { kode, lama, baru, up, down, seq, status }
 *   kode = ok | sama | tidak_ada | pemilik | belum_terbit
 */
export const SKRIP_SUARA = `
local meta = redis.call('HMGET', KEYS[3], 'owner', 'status')
local owner, status = meta[1], meta[2]
if not status or not owner then return {'tidak_ada', 0, 0, 0, 0, 0, status or ''} end
if owner == ARGV[1] then return {'pemilik', 0, 0, 0, 0, 0, status} end
if status ~= 'PUBLISHED' then return {'belum_terbit', 0, 0, 0, 0, 0, status} end

local baru = tonumber(ARGV[2])
local lama = tonumber(redis.call('HGET', KEYS[1], ARGV[1]) or '0')
local c = redis.call('HMGET', KEYS[2], 'up', 'down', 'seq')
local up, down, seq = tonumber(c[1] or '0'), tonumber(c[2] or '0'), tonumber(c[3] or '0')
if lama == baru then return {'sama', lama, baru, up, down, seq, status} end

if baru == 0 then
  redis.call('HDEL', KEYS[1], ARGV[1])
else
  redis.call('HSET', KEYS[1], ARGV[1], baru)
end
if lama == 1 then up = up - 1 elseif lama == -1 then down = down - 1 end
if baru == 1 then up = up + 1 elseif baru == -1 then down = down + 1 end
seq = seq + 1
redis.call('HSET', KEYS[2], 'up', up, 'down', down, 'seq', seq)
return {'ok', lama, baru, up, down, seq, status}
`;

/**
 * Kompensasi bila vote.cast gagal diterbitkan: kembalikan suara hanya bila
 * belum ada suara lain sesudahnya (seq masih sama). Bila sudah ada, suara
 * dibiarkan dan selisihnya dibereskan skrip rekonsiliasi (T9.2).
 * KEYS: suara, hitung. ARGV: user_id, lama, baru, seq. Balasan: 1 dibatalkan, 0 tidak.
 */
export const SKRIP_BATAL = `
local seq = tonumber(redis.call('HGET', KEYS[2], 'seq') or '0')
if seq ~= tonumber(ARGV[4]) then return 0 end
local lama, baru = tonumber(ARGV[2]), tonumber(ARGV[3])
if lama == 0 then
  redis.call('HDEL', KEYS[1], ARGV[1])
else
  redis.call('HSET', KEYS[1], ARGV[1], lama)
end
local c = redis.call('HMGET', KEYS[2], 'up', 'down')
local up, down = tonumber(c[1] or '0'), tonumber(c[2] or '0')
if baru == 1 then up = up - 1 elseif baru == -1 then down = down - 1 end
if lama == 1 then up = up + 1 elseif lama == -1 then down = down + 1 end
redis.call('HSET', KEYS[2], 'up', up, 'down', down, 'seq', seq - 1)
return 1
`;

/**
 * Baca skor tampil dan suara pengguna.
 * KEYS: suara, hitung, meta. ARGV: user_id. Balasan: [owner, status, up, down, nilai_saya]
 */
export const SKRIP_LIHAT = `
local meta = redis.call('HMGET', KEYS[3], 'owner', 'status')
local c = redis.call('HMGET', KEYS[2], 'up', 'down')
local saya = redis.call('HGET', KEYS[1], ARGV[1]) or '0'
return {meta[1] or '', meta[2] or '', tonumber(c[1] or '0'), tonumber(c[2] or '0'), tonumber(saya)}
`;

/**
 * Perbarui salinan pemilik/status puisi. Status hanya ditimpa event yang
 * terjadi lebih baru (event dari exchange berbeda bisa tiba tidak berurutan),
 * dan DELETED bersifat final.
 * KEYS: meta. ARGV: status, waktu_ms, owner ('' = tidak diubah). Balasan: 1 berubah, 0 tidak.
 */
export const SKRIP_META = `
if ARGV[3] ~= '' then redis.call('HSET', KEYS[1], 'owner', ARGV[3]) end
local st = redis.call('HGET', KEYS[1], 'status')
if st == 'DELETED' then return 0 end
local ts = tonumber(redis.call('HGET', KEYS[1], 'status_ms') or '-1')
if ARGV[1] == 'DELETED' or tonumber(ARGV[2]) >= ts then
  redis.call('HSET', KEYS[1], 'status', ARGV[1], 'status_ms', ARGV[2])
  return 1
end
return 0
`;

/**
 * Rate limit per pengguna per menit (jendela tetap).
 * KEYS: rateLimit. ARGV: ttl_detik. Balasan: jumlah permintaan di menit ini.
 */
export const SKRIP_RATE = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1])) end
return n
`;

/**
 * Jalankan skrip dengan EVALSHA (skrip di-cache Redis), jatuh ke EVAL bila
 * cache skrip kosong (Redis restart / SCRIPT FLUSH).
 * @param {import('redis').RedisClientType} klien
 * @param {Map<string,string>} cacheSha
 * @param {string} skrip
 * @param {string[]} keys
 * @param {(string|number)[]} args
 */
export async function jalankanSkrip(klien, cacheSha, skrip, keys, args) {
  const opsi = { keys, arguments: args.map(String) };
  const sha = cacheSha.get(skrip);
  if (sha) {
    try {
      return await klien.evalSha(sha, opsi);
    } catch (err) {
      if (!String(err?.message).includes('NOSCRIPT')) throw err;
    }
  }
  cacheSha.set(skrip, await klien.scriptLoad(skrip));
  return klien.eval(skrip, opsi);
}
