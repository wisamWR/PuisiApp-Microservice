/**
 * Pool baca dengan replika + cadangan primary (reliability, poin kritis Database / D5).
 *
 * Query baca dikirim ke replika (hot standby). Bila replika tidak bisa
 * dijangkau, query diulang sekali ke primary dan replika dilewati selama
 * `jedaMs` (breaker sederhana), supaya setiap request tidak menunggu timeout
 * replika lebih dulu. Galat SQL biasa (salah query, data tidak ada) TIDAK
 * memicu cadangan karena primary akan memberi galat yang sama.
 *
 * Tulis (proyeksi konsumen, migrasi, outbox) tetap memakai pool primary.
 * Replika tertinggal beberapa milidetik dari primary; ini aman untuk read
 * model yang memang eventual consistent.
 */

/**
 * Galat yang berarti replika tidak tersedia, bukan query yang salah.
 * SQLSTATE kelas 08 (koneksi), 57P0x (server mati/sedang start), 53300
 * (koneksi penuh), 40001 (dibatalkan karena konflik dengan pemulihan standby).
 * Galat tanpa SQLSTATE (ECONNREFUSED, ENOTFOUND, timeout koneksi/query) juga termasuk.
 * @param {any} err
 */
export function galatKetersediaan(err) {
  const kode = err?.code;
  if (typeof kode !== 'string' || !/^[0-9A-Z]{5}$/.test(kode)) return true;
  return kode.startsWith('08') || kode.startsWith('57P') || kode === '53300' || kode === '40001';
}

/**
 * @param {object} o
 * @param {{ query: Function }} o.primary
 * @param {{ query: Function } | null | undefined} o.replika   null -> semua baca ke primary
 * @param {{ warn: Function, info: Function }} [o.log]
 * @param {number} [o.jedaMs]   lama replika dilewati setelah gagal, default 30 dtk
 * @param {() => number} [o.sekarang]
 * @returns {{ query: Function, statusReplika: () => 'aktif'|'dilewati'|'tidak_dipakai' }}
 */
export function buatPoolBaca(o) {
  const jedaMs = o.jedaMs ?? 30_000;
  const sekarang = o.sekarang ?? Date.now;
  let lewatiSampai = 0;

  return {
    async query(...args) {
      if (!o.replika || sekarang() < lewatiSampai) return o.primary.query(...args);
      try {
        return await o.replika.query(...args);
      } catch (err) {
        if (!galatKetersediaan(err)) throw err;
        lewatiSampai = sekarang() + jedaMs;
        o.log?.warn('replika tidak tersedia, baca dialihkan ke primary', {
          err: err?.message,
          kode: err?.code,
          jeda_ms: jedaMs,
        });
        return o.primary.query(...args);
      }
    },
    statusReplika() {
      if (!o.replika) return 'tidak_dipakai';
      return sekarang() < lewatiSampai ? 'dilewati' : 'aktif';
    },
  };
}
