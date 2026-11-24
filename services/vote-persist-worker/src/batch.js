/**
 * Pengumpul batch write-behind.
 *
 * Pesan vote.cast ditampung sampai `maks` pesan atau `jedaMs` sejak pesan
 * pertama, lalu disimpan dalam SATU transaksi. Ack baru dikirim setelah
 * commit; bila simpan gagal, semua pesan batch dikembalikan ke queue (nack
 * requeue) setelah jeda mundur, sehingga tidak ada suara yang hilang walau
 * worker atau basis data mati. Quorum queue memindahkan pesan ke DLQ setelah
 * x-delivery-limit (5) kali gagal.
 *
 * Duplikat dan urutan acak aman: baris disimpan menurut `sequence` (lihat
 * repo.js), bukan dijumlahkan.
 */
import { validasiEvent } from '@puisiapp/events';

/**
 * Gabungkan event per pasangan (poem_id, user_id): hanya suara dengan
 * sequence terbesar yang perlu ditulis.
 * @param {any[]} events amplop vote.cast tervalidasi
 */
export function gabungkan(events) {
  const terakhir = new Map();
  for (const e of events) {
    const p = e.payload;
    const k = `${p.poem_id}\u0000${p.user_id}`;
    const ada = terakhir.get(k);
    if (!ada || p.sequence > ada.sequence) {
      terakhir.set(k, {
        poem_id: p.poem_id,
        user_id: p.user_id,
        value: p.vote_value,
        weight: p.weight,
        sequence: p.sequence,
        updated_at: p.cast_at,
      });
    }
  }
  return [...terakhir.values()];
}

/** Parse + validasi satu pesan. @returns {any|null} null = poison message */
export function bacaPesan(pesan) {
  try {
    const e = validasiEvent(JSON.parse(pesan.content.toString('utf8')));
    if (e.event_type !== 'vote.cast') return null;
    const p = e.payload ?? {};
    const sah =
      typeof p.poem_id === 'string' &&
      typeof p.user_id === 'string' &&
      [1, -1, 0].includes(p.vote_value) &&
      Number.isInteger(p.sequence) &&
      p.sequence >= 1 &&
      typeof p.weight === 'number' &&
      typeof p.cast_at === 'string';
    return sah ? e : null;
  } catch {
    return null;
  }
}

/**
 * @param {object} o
 * @param {number} o.maks                     ukuran batch maksimal (200)
 * @param {number} o.jedaMs                   jeda maksimal sejak pesan pertama (1000)
 * @param {(baris: ReturnType<typeof gabungkan>) => Promise<void>} o.simpan  satu transaksi
 * @param {(pesan: any) => void} o.ack
 * @param {(pesan: any) => void} o.kembalikan nack + requeue
 * @param {(pesan: any) => void} o.keDlq      nack tanpa requeue
 * @param {{ info: Function, warn: Function, error: Function }} o.log
 * @param {(n: number) => number} [o.jedaGagalMs] jeda sebelum requeue setelah gagal ke-n
 * @param {{ setTimeout: Function, clearTimeout: Function }} [o.jam]
 */
export function buatPengumpul(o) {
  const jam = o.jam ?? globalThis;
  const jedaGagalMs = o.jedaGagalMs ?? ((n) => Math.min(1000 * 2 ** (n - 1), 30_000));
  let antre = [];
  let timer = null;
  let rantai = Promise.resolve();
  let gagalBeruntun = 0;
  const statistik = { batch: 0, pesan: 0, baris: 0, gagal: 0, dlq: 0 };

  async function tulis(batch) {
    const baris = gabungkan(batch.map((b) => b.event));
    try {
      await o.simpan(baris);
    } catch (err) {
      gagalBeruntun++;
      statistik.gagal++;
      const jeda = jedaGagalMs(gagalBeruntun);
      o.log.error('batch gagal disimpan, dikembalikan ke queue', { err, pesan: batch.length, jeda_ms: jeda });
      if (jeda > 0) await new Promise((r) => jam.setTimeout(r, jeda));
      for (const b of batch) o.kembalikan(b.pesan);
      return;
    }
    gagalBeruntun = 0;
    for (const b of batch) o.ack(b.pesan);
    statistik.batch++;
    statistik.pesan += batch.length;
    statistik.baris += baris.length;
  }

  function flush() {
    if (timer) {
      jam.clearTimeout(timer);
      timer = null;
    }
    if (antre.length === 0) return rantai;
    const batch = antre;
    antre = [];
    // Batch ditulis berurutan: batch berikutnya menunggu batch sebelumnya selesai.
    rantai = rantai.then(() => tulis(batch));
    return rantai;
  }

  return {
    statistik,
    /** Terima satu pesan dari channel. */
    tambah(pesan) {
      const event = bacaPesan(pesan);
      if (!event) {
        statistik.dlq++;
        o.log.error('pesan vote.cast tidak valid, dipindah ke DLQ');
        o.keDlq(pesan);
        return;
      }
      antre.push({ pesan, event });
      if (antre.length >= o.maks) flush();
      else if (!timer) timer = jam.setTimeout(flush, o.jedaMs);
    },
    flush,
    /** Tunggu semua batch selesai (graceful shutdown). */
    async selesai() {
      await flush();
    },
  };
}
