/**
 * Bantu halaman Puisi Saya dan Notifikasi (T2.8). Fungsi murni.
 */

export const STATUS_PUISI = Object.freeze({
  PROCESSING: { label: 'Diproses', nada: 'proses', keterangan: 'Analisis dan pemeriksaan keaslian sedang berjalan.' },
  REPROCESSING: { label: 'Revisi diproses', nada: 'proses', keterangan: 'Versi sebelumnya tetap tampil sampai revisi selesai diperiksa.' },
  PUBLISHED: { label: 'Terbit', nada: 'terbit', keterangan: '' },
  HELD: { label: 'Ditahan', nada: 'tahan', keterangan: 'Sedang ditinjau moderator.' },
  HIDDEN: { label: 'Disembunyikan', nada: 'sembunyi', keterangan: 'Disembunyikan moderator. Kamu bisa mengajukan banding dalam 7 hari.' },
})

/** Urutan tombol filter. */
export const FILTER_STATUS = ['PROCESSING', 'REPROCESSING', 'PUBLISHED', 'HELD', 'HIDDEN']

export const LABEL_LEVEL = Object.freeze({
  original: 'Orisinal',
  inspired: 'Terinspirasi',
  similar: 'Mirip',
  suspected_plagiarism: 'Dugaan jiplakan',
})

/** Puisi yang ditahan atau disembunyikan diputuskan moderator, jadi tidak bisa direvisi penulis. */
export const bisaDiedit = (status) => status !== 'HELD' && status !== 'HIDDEN'

/** Angka desimal gaya Indonesia di dalam alasan ("0.91" -> "0,91"). */
export const rapikanAlasan = (alasan) => (alasan ? String(alasan).replace(/(\d)\.(\d)/g, '$1,$2') : '')

export function jumlahSemua(counts) {
  return FILTER_STATUS.reduce((n, s) => n + (counts?.[s] ?? 0), 0)
}

/**
 * Waktu relatif singkat berbahasa Indonesia.
 * @param {string} iso
 * @param {Date} [sekarang]
 */
export function waktuRelatif(iso, sekarang = new Date()) {
  if (!iso) return ''
  const detik = Math.max(0, Math.round((sekarang - new Date(iso)) / 1000))
  if (detik < 60) return 'baru saja'
  const menit = Math.floor(detik / 60)
  if (menit < 60) return `${menit} menit lalu`
  const jam = Math.floor(menit / 60)
  if (jam < 24) return `${jam} jam lalu`
  const hari = Math.floor(jam / 24)
  if (hari < 7) return `${hari} hari lalu`
  return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Teks badge notifikasi: kosong bila 0, "99+" bila lebih dari 99. */
export const teksBadge = (n) => (!n ? '' : n > 99 ? '99+' : String(n))

/** Event window saat notifikasi ditandai dibaca, supaya badge header diperbarui. */
export const EVENT_NOTIFIKASI = 'notifikasi:berubah'
export const umumkanNotifikasiBerubah = () => window.dispatchEvent(new Event(EVENT_NOTIFIKASI))
