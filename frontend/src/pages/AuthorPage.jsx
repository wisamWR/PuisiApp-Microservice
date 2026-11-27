import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { RingkasanKartu } from '../components/RingkasanKartu'
import { Loader } from '../components/UI'

const UKURAN = 12

export default function AuthorPage() {
  const { id } = useParams()
  const [halaman, setHalaman] = useState(1)
  const [data, setData] = useState(null)
  const [galat, setGalat] = useState('')
  const [profil, setProfil] = useState(null)

  // Profil publik tidak butuh login. Kalau gagal, halaman tetap menampilkan karya dengan label cadangan.
  useEffect(() => {
    let aktif = true
    setProfil(null)
    api
      .get(`/profiles/${encodeURIComponent(id)}`)
      .then(({ data }) => {
        if (aktif) setProfil(data)
      })
      .catch(() => {
        if (aktif) setProfil(null)
      })
    return () => {
      aktif = false
    }
  }, [id])

  useEffect(() => {
    let aktif = true
    setGalat('')
    api
      .get(`/poems?author=${encodeURIComponent(id)}&page=${halaman}&size=${UKURAN}`)
      .then(({ data }) => {
        if (aktif) setData(data)
      })
      .catch((err) => {
        if (aktif) {
          setData(null)
          setGalat(
            err?.status === 401
              ? 'Masuk terlebih dahulu untuk melihat karya penulis.'
              : 'Gagal memuat karya penulis. Coba muat ulang halaman.',
          )
        }
      })
    return () => {
      aktif = false
    }
  }, [id, halaman])

  const totalHalaman = data ? Math.max(1, Math.ceil(data.total / UKURAN)) : 1
  const namaTampil = profil?.display_name || profil?.username || 'Penulis'

  return (
    <section className="page-section">
      <div className="page-heading">
        <span className="eyebrow">Profil Penulis</span>
        <h1>{namaTampil}</h1>
        {profil?.username && <p>@{profil.username}</p>}
        {profil?.bio && <p>{profil.bio}</p>}
      </div>

      {galat ? (
        <p className="poem-detail-placeholder">{galat}</p>
      ) : !data ? (
        <Loader label="Memuat karya penulis..." />
      ) : data.items.length === 0 ? (
        <p className="poem-detail-placeholder">Penulis ini belum punya karya yang diterbitkan.</p>
      ) : (
        <>
          <div className="poem-grid">
            {data.items.map((item) => (
              <RingkasanKartu key={item.poem_id} item={item} />
            ))}
          </div>
          <div className="page-pagination">
            <button
              type="button"
              disabled={halaman <= 1}
              onClick={() => setHalaman((h) => h - 1)}
            >
              Sebelumnya
            </button>
            <span>
              Halaman {halaman} dari {totalHalaman}
            </span>
            <button
              type="button"
              disabled={halaman >= totalHalaman}
              onClick={() => setHalaman((h) => h + 1)}
            >
              Berikutnya
            </button>
          </div>
        </>
      )}
    </section>
  )
}
