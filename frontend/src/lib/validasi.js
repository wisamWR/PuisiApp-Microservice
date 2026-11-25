// Aturan validasi sama dengan register-service (services/register-service/src/validasi.js).
// Dijalankan di klien supaya pengguna dapat pesan sebelum request dikirim.

const RE_USERNAME = /^[A-Za-z0-9_]{3,30}$/
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validasiRegistrasi(form) {
  const errors = {}
  const username = (form.username ?? '').trim()
  const email = (form.email ?? '').trim().toLowerCase()
  const displayName = (form.display_name ?? '').trim()
  const password = form.password ?? ''
  const confirm = form.confirm ?? ''

  if (!RE_USERNAME.test(username)) {
    errors.username = 'Username 3 sampai 30 karakter: huruf, angka, atau garis bawah.'
  }
  if (!RE_EMAIL.test(email) || email.length > 254) {
    errors.email = 'Format email belum benar.'
  }
  if (displayName.length < 1 || displayName.length > 50) {
    errors.display_name = 'Nama tampil 1 sampai 50 karakter.'
  }
  if (password.length < 8) {
    errors.password = 'Kata sandi minimal 8 karakter.'
  }
  if (confirm !== password) {
    errors.confirm = 'Konfirmasi kata sandi tidak sama.'
  }

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    data: { username, email, display_name: displayName, password },
  }
}

export function validasiMasuk(form) {
  const errors = {}
  const username = (form.username ?? '').trim()
  const password = form.password ?? ''

  if (!username) errors.username = 'Username wajib diisi.'
  if (!password) errors.password = 'Kata sandi wajib diisi.'

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    data: { username, password },
  }
}
