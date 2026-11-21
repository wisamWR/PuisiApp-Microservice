/**
 * Cache-aside Redis untuk detail puisi.
 *
 *   baca  : GET kunci -> ada: pakai (HIT); tidak ada: baca DB, SET dengan TTL (MISS)
 *   tulis : setelah transaksi proyeksi commit, DEL kunci puisi yang berubah
 *
 * Yang disimpan adalah bundel mentah (sama untuk semua pembaca); aturan
 * visibilitas diterapkan setiap permintaan, jadi cache tidak pernah
 * membocorkan puisi milik orang lain.
 *
 * Fail-open: bila Redis tidak tersedia, layanan tetap membaca dari basis
 * data. TTL pendek membatasi umur data basi bila DEL gagal atau kalah balapan
 * dengan pembaca yang menulis ulang cache tepat sebelum commit.
 */
import { createClient } from 'redis';

const AWALAN = 'poem-query:detail:';
export const kunciDetail = (poemId) => `${AWALAN}${poemId}`;

/**
 * @param {object} o
 * @param {string} [o.url]        default dari REDIS_HOST / REDIS_PORT / REDIS_PASSWORD
 * @param {number} [o.ttlDetik]   default env CACHE_TTL_DETIK atau 30
 * @param {{ warn: Function, info: Function }} o.log
 */
export async function buatCache(o) {
  const ttlDetik = o.ttlDetik ?? (Number(process.env.CACHE_TTL_DETIK) || 30);
  const klien = createClient({
    url: o.url,
    socket: {
      host: process.env.REDIS_HOST ?? 'localhost',
      port: Number(process.env.REDIS_PORT ?? 6379),
      connectTimeout: 2000,
      // Coba lagi terus dengan jeda maksimal 5 dtk; selama putus, cache dilewati.
      reconnectStrategy: (n) => Math.min(250 * 2 ** n, 5000),
    },
    password: o.url ? undefined : process.env.REDIS_PASSWORD || undefined,
    disableOfflineQueue: true, // perintah langsung gagal saat putus, bukan menunggu
  });
  let lapor = true;
  klien.on('error', (err) => {
    if (lapor) o.log.warn('Redis tidak tersedia, cache dilewati', { err });
    lapor = false;
  });
  klien.on('ready', () => {
    lapor = true;
    o.log.info('Redis siap', { ttl_detik: ttlDetik });
  });
  klien.connect().catch(() => {}); // tidak memblokir start; reconnectStrategy yang mencoba ulang

  const siap = () => klien.isReady;

  return {
    ttlDetik,
    siap,
    /** @returns {Promise<object|null|undefined>} undefined = cache tidak tersedia / tidak ada */
    async ambil(poemId) {
      if (!siap()) return undefined;
      try {
        const isi = await klien.get(kunciDetail(poemId));
        return isi == null ? undefined : JSON.parse(isi);
      } catch (err) {
        o.log.warn('gagal membaca cache', { err, poem_id: poemId });
        return undefined;
      }
    },
    async simpan(poemId, bundel) {
      if (!siap()) return;
      try {
        await klien.set(kunciDetail(poemId), JSON.stringify(bundel), { EX: ttlDetik });
      } catch (err) {
        o.log.warn('gagal menulis cache', { err, poem_id: poemId });
      }
    },
    async hapus(poemIds) {
      if (!siap() || poemIds.length === 0) return;
      await klien.del(poemIds.map(kunciDetail));
    },
    /** Statistik server (untuk uji hit ratio): keyspace_hits, keyspace_misses. */
    async statistik() {
      const info = await klien.info('stats');
      const ambilAngka = (nama) => Number(new RegExp(`${nama}:(\\d+)`).exec(info)?.[1] ?? 0);
      return { hits: ambilAngka('keyspace_hits'), misses: ambilAngka('keyspace_misses') };
    },
    async tutup() {
      await klien.close().catch(() => {});
    },
  };
}

/**
 * Bungkus store konsumen: setelah event diproses dan transaksinya commit,
 * hapus cache puisi yang berubah. user.* menghapus cache semua puisi penulis
 * itu (nama penulis ikut di bundel).
 *
 * @param {{ proses: Function }} store
 * @param {object} d
 * @param {ReturnType<typeof buatCache>} d.cache
 * @param {(event: any) => string[] | Promise<string[]>} d.targetDari  poem_id yang harus dihapus
 * @param {{ warn: Function }} d.log
 */
export function denganInvalidasi(store, d) {
  return {
    async proses(event, fn) {
      const hasil = await store.proses(event, fn);
      if (hasil === 'diproses') {
        try {
          await d.cache.hapus(await d.targetDari(event));
        } catch (err) {
          d.log.warn('gagal menghapus cache, data basi sampai TTL habis', { err, event_id: event.event_id });
        }
      }
      return hasil;
    },
  };
}
