/**
 * Tautan Notifikasi di header dengan jumlah belum dibaca (T2.8).
 * Diperbarui tiap 60 detik, saat tab kembali aktif, dan saat halaman
 * Notifikasi menandai sesuatu dibaca (event window "notifikasi:berubah").
 */
import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { api } from '../lib/api'
import { EVENT_NOTIFIKASI as EVENT, teksBadge } from '../lib/puisiSaya'

export default function NotifBadge() {
  const [jumlah, setJumlah] = useState(0)

  useEffect(() => {
    let aktif = true
    const segarkan = () =>
      api
        .get('/notifications/unread-count')
        .then(({ data }) => aktif && setJumlah(data?.unread ?? 0))
        .catch(() => {})
    const saatTerlihat = () => document.visibilityState === 'visible' && segarkan()
    segarkan()
    const jeda = setInterval(segarkan, 60_000)
    window.addEventListener(EVENT, segarkan)
    document.addEventListener('visibilitychange', saatTerlihat)
    return () => {
      aktif = false
      clearInterval(jeda)
      window.removeEventListener(EVENT, segarkan)
      document.removeEventListener('visibilitychange', saatTerlihat)
    }
  }, [])

  const teks = teksBadge(jumlah)
  return (
    <NavLink to="/notifications" className="notif-badge" aria-label={teks ? `Notifikasi, ${jumlah} belum dibaca` : 'Notifikasi'}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      {teks && <span className="notif-badge-angka">{teks}</span>}
    </NavLink>
  )
}
