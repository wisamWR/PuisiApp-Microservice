import { createContext, useContext } from 'react'

// Pengguna yang sedang masuk: { username, role } atau null.
// Tidak disimpan di localStorage: sesi sebenarnya ada di cookie httpOnly.
export const AuthContext = createContext(null)

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth harus dipakai di dalam AuthProvider.')
  return ctx
}
