/**
 * Langganan Redis pub/sub per puisi dengan hitungan referensi: satu koneksi
 * subscriber per replika status-stream-service, satu SUBSCRIBE per poem_id
 * walau banyak tab browser membuka puisi yang sama. Kanal dilepas saat
 * penonton terakhir pergi.
 */
import { kanal } from './keadaan.js';

/**
 * @param {{ subscribe: Function, unsubscribe: Function }} subscriber  klien Redis mode subscriber
 */
export function buatPelanggan(subscriber) {
  /** @type {Map<string, Set<(pesan: object) => void>>} */
  const penonton = new Map();

  return {
    /**
     * @param {string} poemId
     * @param {(snapshot: object) => void} kirim
     * @returns {Promise<() => Promise<void>>} fungsi berhenti
     */
    async ikuti(poemId, kirim) {
      let daftar = penonton.get(poemId);
      if (!daftar) {
        daftar = new Set();
        penonton.set(poemId, daftar);
        await subscriber.subscribe(kanal(poemId), (pesan) => {
          let data;
          try {
            data = JSON.parse(pesan);
          } catch {
            return;
          }
          for (const f of penonton.get(poemId) ?? []) f(data);
        });
      }
      daftar.add(kirim);
      return async () => {
        daftar.delete(kirim);
        if (daftar.size === 0 && penonton.get(poemId) === daftar) {
          penonton.delete(poemId);
          await subscriber.unsubscribe(kanal(poemId)).catch(() => {});
        }
      };
    },
    jumlahKanal: () => penonton.size,
    jumlahPenonton: () => [...penonton.values()].reduce((n, s) => n + s.size, 0),
  };
}
