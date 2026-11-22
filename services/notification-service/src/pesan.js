/**
 * Kalimat notifikasi berbahasa Indonesia (fungsi murni, mudah diuji dan diubah).
 * Setiap fungsi mengembalikan { jenis, judul, pesan }.
 */

const kutip = (judul) => (judul ? `"${judul}"` : 'Puisimu');

/** Angka desimal gaya Indonesia di dalam alasan dari publication-service ("0.91" -> "0,91"). */
const rapikanAlasan = (alasan) => String(alasan ?? '').replace(/(\d)\.(\d)/g, '$1,$2');

export function terbit({ judul, versi, statusSebelum }) {
  if (statusSebelum === 'HIDDEN') {
    return { jenis: 'poem_published', judul: 'Puisimu tampil kembali', pesan: `${kutip(judul)} kembali bisa dibaca semua orang setelah ditinjau moderator.` };
  }
  if (statusSebelum === 'HELD') {
    return { jenis: 'poem_published', judul: 'Puisimu lolos tinjauan', pesan: `${kutip(judul)} dinyatakan aman oleh moderator dan sekarang sudah terbit.` };
  }
  if (versi > 1) {
    return { jenis: 'poem_published', judul: 'Revisi puisimu sudah terbit', pesan: `Versi ${versi} dari ${kutip(judul)} sekarang tampil untuk semua pembaca.` };
  }
  return { jenis: 'poem_published', judul: 'Puisimu sudah terbit', pesan: `${kutip(judul)} sekarang bisa dibaca semua orang.` };
}

export function ditahan({ judul, alasan }) {
  return {
    jenis: 'poem_held',
    judul: 'Puisimu ditahan sementara',
    pesan: `${kutip(judul)} mirip dengan karya lain (${rapikanAlasan(alasan) || 'dugaan jiplakan'}) dan sedang ditinjau moderator. Kamu akan diberi tahu hasilnya.`,
  };
}

export function disembunyikan({ judul, alasan }) {
  return {
    jenis: 'poem_hidden',
    judul: 'Puisimu disembunyikan',
    pesan: `${kutip(judul)} disembunyikan berdasarkan keputusan moderator. Alasan: ${rapikanAlasan(alasan)}. Kamu bisa mengajukan banding dalam 7 hari.`,
  };
}

export function prosesSelesai({ judul }) {
  return {
    jenis: 'processing_completed',
    judul: 'Analisis puisimu selesai',
    pesan: `Emosi, tema, kata kunci, gambar kutipan, dan pemeriksaan keaslian ${kutip(judul)} sudah selesai.`,
  };
}

export function dilaporkan({ judul, alasan }) {
  return {
    jenis: 'poem_reported',
    judul: 'Puisimu dilaporkan',
    pesan: `${kutip(judul)} dilaporkan pembaca dengan alasan: ${alasan}. Moderator akan meninjau laporan ini, dan kamu bisa menyampaikan sanggahan.`,
  };
}

export function laporanDiterima({ judul }) {
  return {
    jenis: 'report_received',
    judul: 'Laporanmu diterima',
    pesan: `Terima kasih. Laporanmu atas ${judul ? `"${judul}"` : 'sebuah puisi'} sedang ditinjau moderator.`,
  };
}

const HASIL_PELAPOR = {
  APPROVE: 'laporan tidak dikabulkan, puisi tetap tampil',
  REJECT: 'laporan tidak dikabulkan, puisi tetap tampil',
  HIDE: 'laporan dikabulkan, puisi disembunyikan',
  DELETE: 'laporan dikabulkan, puisi disembunyikan',
  RESTORE: 'puisi ditampilkan kembali setelah banding',
};

export function keputusanUntukPelapor({ judul, keputusan, alasan }) {
  return {
    jenis: 'case_decided_reporter',
    judul: 'Laporanmu sudah diputuskan',
    pesan: `Moderator memutuskan laporanmu atas ${judul ? `"${judul}"` : 'sebuah puisi'}: ${HASIL_PELAPOR[keputusan] ?? keputusan}. Alasan: ${alasan}.`,
  };
}

/** Keputusan yang tidak mengubah status puisi (laporan ditolak); perubahan status dikabarkan lewat poem.published / hidden. */
export function laporanDitolakUntukPenulis({ judul, alasan }) {
  return {
    jenis: 'case_decided_author',
    judul: 'Laporan atas puisimu tidak dikabulkan',
    pesan: `Moderator meninjau laporan atas ${kutip(judul)} dan memutuskan puisimu tetap tampil. Alasan: ${alasan}.`,
  };
}

export function bandingDiterima({ judul }) {
  return {
    jenis: 'appeal_filed',
    judul: 'Bandingmu sudah diterima',
    pesan: `Banding atas keputusan untuk ${judul ? `"${judul}"` : 'puisimu'} akan ditinjau moderator lain. Kamu akan diberi tahu hasilnya.`,
  };
}
