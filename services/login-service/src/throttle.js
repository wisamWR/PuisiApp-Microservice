/**
 * Penundaan login (T1.2 butir 7): 5 kali gagal dalam 15 menit untuk username yang sama
 * memicu penundaan sampai jendela berakhir. Fungsi murni, tanpa basis data.
 */
export const MAKS_GAGAL = 5;

/** Jendela 15 menit. Bisa diubah lewat LOGIN_JENDELA_DETIK hanya untuk pengujian. */
export function jendelaMs() {
  const detik = Number(process.env.LOGIN_JENDELA_DETIK);
  return (Number.isFinite(detik) && detik > 0 ? detik : 900) * 1000;
}

/**
 * @param {{ gagal: number, jendela_mulai: Date } | null} baris
 * @param {Date} sekarang
 * @returns {{ tertunda: boolean, tungguDetik: number }}
 */
export function statusPenundaan(baris, sekarang = new Date()) {
  if (!baris) return { tertunda: false, tungguDetik: 0 };
  const akhir = new Date(baris.jendela_mulai).getTime() + jendelaMs();
  const sisaMs = akhir - sekarang.getTime();
  if (sisaMs <= 0) return { tertunda: false, tungguDetik: 0 }; // jendela sudah habis
  if (baris.gagal >= MAKS_GAGAL) return { tertunda: true, tungguDetik: Math.ceil(sisaMs / 1000) };
  return { tertunda: false, tungguDetik: 0 };
}

/**
 * Nilai baru setelah satu kegagalan. Jendela baru dimulai bila yang lama sudah habis.
 * @returns {{ gagal: number, jendela_mulai: Date }}
 */
export function setelahGagal(baris, sekarang = new Date()) {
  if (!baris) return { gagal: 1, jendela_mulai: sekarang };
  const akhir = new Date(baris.jendela_mulai).getTime() + jendelaMs();
  if (sekarang.getTime() >= akhir) return { gagal: 1, jendela_mulai: sekarang };
  return { gagal: baris.gagal + 1, jendela_mulai: new Date(baris.jendela_mulai) };
}
