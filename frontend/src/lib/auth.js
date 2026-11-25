import { createContext, useContext } from 'react'

// Pengguna yang sedang masuk: { username, role } atau null.
// Tidak disimpan di localStorage: sesi sebenarnya ada di cookie httpOnly.
// Setelah halaman di-reload, AuthProvider memulihkannya lewat GET /api/profiles/me.
export const AuthContext = createContext(null)

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth harus dipakai di dalam AuthProvider.')
  return ctx
}

/** Ubah respons GET /api/profiles/me menjadi data pengguna, atau null bila tidak sah. */
export function penggunaDariProfil(data) {
  if (!data || typeof data.username !== 'string' || !data.username) return null
  return { username: data.username, role: typeof data.role === 'string' ? data.role : 'writer' }
}
