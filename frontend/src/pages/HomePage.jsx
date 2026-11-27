import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { RingkasanKartu } from '../components/RingkasanKartu'
import { Loader } from '../components/UI'

const UKURAN = 12

export default function HomePage() {
  const [halaman, setHalaman] = useState(1)
  const [data, setData] = useState(null)
  const [galat, setGalat] = useState('')

  useEffect(() => {
    let aktif = true
    setGalat('')
    api
      .get(`/poems?page=${halaman}&size=${UKURAN}`)
      .then(({ data }) => {
        if (aktif) setData(data)
      })
      .catch((err) => {
        if (aktif) {
          setData(null)
          setGalat(
            err?.status === 401
              ? 'Masuk terlebih dahulu untuk melihat puisi.'
              : 'Gagal memuat puisi. Coba muat ulang halaman.',
          )
        }
      })
    return () => {
      aktif = false
    }
  }, [halaman])

  const totalHalaman = data ? Math.max(1, Math.ceil(data.total / UKURAN)) : 1

  return (
    <section className="page-section">
      <div className="page-heading">
        <span className="eyebrow">Beranda</span>
        <h1>Puisi terbaru</h1>
        <p>Karya yang baru diterbitkan di PuisiApp.</p>
      </div>

      {galat ? (
        <p className="poem-detail-placeholder">{galat}</p>
      ) : !data ? (
        <Loader label="Memuat puisi..." />
      ) : data.items.length === 0 ? (
        <p className="poem-detail-placeholder">Belum ada puisi yang diterbitkan.</p>
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
