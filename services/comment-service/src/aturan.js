// Aturan komentar yang tidak bergantung pada database, Redis, atau RabbitMQ,
// supaya bisa diuji langsung (test/aturan.test.js).

export const PANJANG_MAKS_KOMENTAR = 1000;
export const PANJANG_MAKS_ALASAN = 500;

// Peran yang boleh menghapus komentar orang lain.
export const PERAN_PENGHAPUS = ['moderator', 'admin'];

export function bersihkanHtml(teks) {
  return teks
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, '')
    .trim();
}

/**
 * Bersihkan isi komentar dan cek panjangnya.
 * @returns {{ ok: true, content: string } | { ok: false }}
 */
export function validasiKomentar(nilai) {
  const content = bersihkanHtml(typeof nilai === 'string' ? nilai : '');
  if (!content || content.length > PANJANG_MAKS_KOMENTAR) return { ok: false };
  return { ok: true, content };
}

const POLA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ID puisi dan komentar berupa UUID; selain itu dianggap tidak ditemukan. */
export function apakahUuid(nilai) {
  return typeof nilai === 'string' && POLA_UUID.test(nilai);
}

/** Penulis komentar, moderator, atau admin boleh menghapus. */
export function bolehHapus(penulisId, userId, peran) {
  return Boolean(userId) && (penulisId === userId || PERAN_PENGHAPUS.includes(peran));
}
