/**
 * Notifikasi (T2.8): daftar notifikasi milik sendiri, terbaru dulu. Klik
 * menandai dibaca lalu membuka puisinya. Data: notification-service.
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { umumkanNotifikasiBerubah, waktuRelatif } from '../lib/puisiSaya'
import './PuisiSaya.css'

const UKURAN = 20

export default function NotificationsPage() {
  const navigate = useNavigate()
  const [hasil, setHasil] = useState({ items: [], total: 0, unread: 0, page: 0 })
  const [memuat, setMemuat] = useState(true)
  const [galat, setGalat] = useState('')

  const [halaman, setHalaman] = useState(1)

  // State hanya diubah di callback (setelah respons tiba); penanda "memuat" diatur handler klik.
  useEffect(() => {
    let aktif = true
    api
      .get(`/notifications?page=${halaman}&size=${UKURAN}`)
      .then(({ data }) => {
        if (!aktif) return
        setGalat('')
        setHasil((lama) => ({ ...data, items: halaman === 1 ? data.items : [...lama.items, ...data.items] }))
      })
      .catch((err) => {
        if (aktif) setGalat(err?.status === 401 ? 'Masuk dulu untuk melihat notifikasimu.' : 'Notifikasi belum bisa dimuat. Coba lagi sebentar lagi.')
      })
      .finally(() => aktif && setMemuat(false))
    return () => {
      aktif = false
    }
  }, [halaman])

  async function buka(n) {
    if (!n.read) {
      try {
        const { data } = await api.post(`/notifications/${n.id}/read`)
        setHasil((lama) => ({
          ...lama,
          unread: data.unread,
          items: lama.items.map((x) => (x.id === n.id ? { ...x, read: true } : x)),
        }))
        umumkanNotifikasiBerubah()
      } catch {
        // tetap buka tautannya
      }
    }
    if (n.link) navigate(n.link)
  }

  async function bacaSemua() {
    try {
      await api.post('/notifications/read-all')
      setHasil((lama) => ({ ...lama, unread: 0, items: lama.items.map((x) => ({ ...x, read: true })) }))
      umumkanNotifikasiBerubah()
    } catch {
      setGalat('Belum bisa menandai semua notifikasi. Coba lagi.')
    }
  }

  return (
    <section className="page-section">
      <div className="page-heading notif-judul">
        <div>
          <span className="eyebrow">AKUN</span>
          <h1>Notifikasi</h1>
          <p>{hasil.unread ? `${hasil.unread} belum dibaca` : 'Semua notifikasi sudah dibaca.'}</p>
        </div>
        {hasil.unread > 0 && (
          <button type="button" className="button button-outline" onClick={bacaSemua}>Tandai semua dibaca</button>
        )}
      </div>

      {galat && <p className="saya-galat" role="alert">{galat}</p>}
      {!galat && !memuat && hasil.items.length === 0 && (
        <div className="saya-kosong"><p>Belum ada notifikasi. Kabar tentang puisimu akan muncul di sini.</p></div>
      )}

      <ul className="notif-daftar">
        {hasil.items.map((n) => (
          <li key={n.id}>
            <button type="button" className={`notif-item${n.read ? '' : ' belum'}`} onClick={() => buka(n)}>
              <span className="notif-titik" aria-hidden="true" />
              <span className="notif-isi">
                <strong>{n.title}</strong>
                <span>{n.message}</span>
                <small>{waktuRelatif(n.created_at)}{n.read ? '' : ' · belum dibaca'}</small>
              </span>
            </button>
          </li>
        ))}
      </ul>

      {memuat && <p className="saya-memuat">Memuat...</p>}
      {!memuat && hasil.items.length < hasil.total && (
        <button type="button" className="button button-outline saya-lagi" onClick={() => { setMemuat(true); setHalaman((h) => h + 1) }}>
          Muat lebih banyak
        </button>
      )}
    </section>
  )
}
