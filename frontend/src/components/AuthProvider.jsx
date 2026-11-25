import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import { AuthContext, penggunaDariProfil } from '../lib/auth'

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)

  // Pulihkan sesi saat aplikasi dibuka atau di-reload: cookie httpOnly masih sah,
  // tetapi state React kosong. Gagal (belum masuk, 401) cukup diabaikan, tanpa
  // dialihkan ke /login karena halaman publik juga memakai provider ini.
  useEffect(() => {
    let aktif = true
    api
      .get('/profiles/me', { tanpaAlihLogin: true })
      .then(({ data }) => {
        const pengguna = penggunaDariProfil(data)
        // Jangan menimpa pengguna yang sudah di-set oleh login selama request berjalan.
        if (aktif && pengguna) setUser((sebelumnya) => sebelumnya ?? pengguna)
      })
      .catch(() => {})
    return () => {
      aktif = false
    }
  }, [])

  const value = useMemo(() => ({ user, setUser }), [user])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
