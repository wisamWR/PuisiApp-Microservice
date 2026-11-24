/**
 * Tampilan status pemrosesan dari snapshot SSE (T2.7). Fungsi murni supaya
 * bisa diuji tanpa browser. Bentuk snapshot: contracts/openapi/poem-status-stream.yaml.
 */

const KALIMAT_PUBLIKASI = {
  PUBLISHED: 'Puisimu sudah terbit dan bisa dibaca semua orang.',
  HELD: 'Puisimu ditahan sementara karena mirip karya lain dan sedang ditinjau moderator.',
  HIDDEN: 'Puisimu disembunyikan berdasarkan keputusan moderator.',
  DELETED: 'Puisi ini sudah dihapus.',
}

/** Snapshot final: semua langkah selesai dan keputusan publikasi sudah ada. */
export const sudahFinal = (s) => Boolean(s) && ((s.status === 'COMPLETED' && s.publication != null) || s.publication === 'DELETED')

/**
 * @param {object|null} s  snapshot dari server
 * @returns {{ judul: string, langkah: { name: string, label: string, done: boolean }[], persen: number, keterangan: string } | null}
 */
export function tampilanStatus(s) {
  if (!s) return null
  const persen = s.steps_total ? Math.round((s.steps_done / s.steps_total) * 100) : 0
  let judul
  if (s.publication === 'DELETED') judul = 'Dihapus'
  else if (s.status === 'COMPLETED') judul = 'Pemrosesan selesai'
  else if (s.status === 'REPROCESSING') judul = `Memproses revisi (versi ${s.version})`
  else judul = 'Sedang diproses'

  let keterangan = KALIMAT_PUBLIKASI[s.publication] ?? ''
  if (s.status === 'REPROCESSING' && s.publication === 'PUBLISHED') {
    keterangan = 'Versi sebelumnya tetap tampil sampai revisi selesai diperiksa.'
  } else if (!keterangan) {
    keterangan = 'Puisi tampil untuk pembaca lain setelah pemeriksaan keaslian selesai.'
  }
  return {
    judul,
    langkah: (s.steps ?? []).map((l) => ({ name: l.name, label: l.label, done: Boolean(l.done) })),
    persen,
    keterangan,
  }
}
