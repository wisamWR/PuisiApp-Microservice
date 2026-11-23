// Aturan sama dengan profile-service (services/profile-service/src/validasi.js).
// Tag HTML dibuang dulu, baru dihitung panjangnya.
export const MAKS_NAMA_TAMPIL = 50
export const MAKS_BIO = 300

export function bersihkanTeks(teks) {
  return String(teks ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function validasiProfil(form) {
  const errors = {}
  const displayName = bersihkanTeks(form.display_name)
  const bio = bersihkanTeks(form.bio ?? '')

  if (displayName.length < 1 || displayName.length > MAKS_NAMA_TAMPIL) {
    errors.display_name = `Nama tampil 1 sampai ${MAKS_NAMA_TAMPIL} karakter.`
  }
  if (bio.length > MAKS_BIO) {
    errors.bio = `Bio maksimal ${MAKS_BIO} karakter.`
  }

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    data: { display_name: displayName, bio },
  }
}
