// Logika tombol upvote/downvote (T9.3, kelompok 9), terpisah dari React
// supaya bisa diuji tanpa browser: node --test src/lib

/** Menekan tombol yang sama dengan suara saat ini berarti menarik suara (0). */
export function nilaiBerikutnya(nilaiSaatIni, tombol) {
  return nilaiSaatIni === tombol ? 0 : tombol
}

/**
 * Tampilan optimistik: skor dan jumlah suara langsung disesuaikan sebelum
 * server menjawab. Server tetap sumber kebenaran; jawabannya menimpa hasil ini.
 * @param {{ nilai: number, skor: number, jumlah_suara: number }} s
 * @param {number} baru
 */
export function terapkanOptimistik(s, baru) {
  const lama = s.nilai ?? 0
  return {
    ...s,
    nilai: baru,
    skor: s.skor - lama + baru,
    jumlah_suara: s.jumlah_suara - (lama !== 0 ? 1 : 0) + (baru !== 0 ? 1 : 0),
  }
}

/** Pesan untuk pengguna saat server menolak suara. */
export function pesanPenolakan(galat) {
  const status = galat?.status
  const kode = galat?.data?.error
  if (status === 403 || kode === 'pemilik_puisi') return 'Kamu tidak dapat memberi suara pada puisimu sendiri.'
  if (status === 409 || kode === 'belum_terbit') return 'Puisi ini belum terbit, suara belum dapat diberikan.'
  if (status === 429) {
    const detik = galat?.retryAfter
    return detik ? `Terlalu banyak suara. Coba lagi dalam ${detik} detik.` : 'Terlalu banyak suara. Coba lagi sebentar lagi.'
  }
  if (status === 404) return 'Puisi tidak ditemukan.'
  return galat?.message || 'Suara gagal dikirim. Coba lagi.'
}

/** Format skor tampil: +12, 0, -3. */
export function formatSkor(skor) {
  return skor > 0 ? `+${skor}` : String(skor)
}
