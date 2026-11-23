// Pesan galat yang jelas untuk 400, 401, 409, dan 429 (T1.3 kriteria selesai).

export function pesanGalat(err) {
  if (!(err && err.status)) return 'Tidak bisa terhubung ke server. Periksa koneksi lalu coba lagi.'

  switch (err.status) {
    case 400:
      return 'Ada isian yang belum benar. Periksa kembali formulir.'
    case 401:
      return 'Username atau kata sandi salah.'
    case 409:
      return 'Username atau email sudah dipakai. Coba username atau email lain.'
    case 429: {
      const menit = err.retryAfter ? Math.ceil(err.retryAfter / 60) : null
      return menit
        ? `Terlalu banyak percobaan. Coba lagi dalam ${menit} menit.`
        : 'Terlalu banyak percobaan. Coba lagi beberapa saat lagi.'
    }
    default:
      return 'Terjadi gangguan di server. Coba lagi sebentar lagi.'
  }
}

// Tujuan setelah masuk: hanya jalur internal (mencegah pengalihan ke situs luar).
export function tujuanSetelahMasuk(next) {
  if (typeof next === 'string' && next.startsWith('/') && !next.startsWith('//')) return next
  return '/mood-entry'
}
