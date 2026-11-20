// Peran sesuai contracts/events/user.role.changed (enum). Spesifikasi lama menulis reader_writer;
// kontrak yang dipakai layanan lain adalah sumber kebenarannya.
export const PERAN_VALID = ['reader', 'writer', 'moderator', 'admin'];

export function validasiPeran(body) {
  const role = body && typeof body === 'object' && !Array.isArray(body) ? body.role : undefined;
  if (!PERAN_VALID.includes(role)) {
    return { ok: false, errors: { role: `peran harus salah satu dari ${PERAN_VALID.join(', ')}` } };
  }
  return { ok: true, role };
}
