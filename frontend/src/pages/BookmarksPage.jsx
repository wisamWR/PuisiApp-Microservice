import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader } from '../components/UI'
import { SimpanBagikan } from '../components/SimpanBagikan'
import { api } from '../lib/api'

const UKURAN = 20

// T3.4: halaman Simpanan. Puisi yang ditahan, disembunyikan, atau dihapus tidak tampil.
export default function BookmarksPage() {
  const [page, setPage] = useState(1)
  const [hasil, setHasil] = useState(null)
  const [galat, setGalat] = useState('')

  // muatUlang dinaikkan setelah batal simpan agar daftar dimuat ulang.
  const [muatUlang, setMuatUlang] = useState(0)

  useEffect(() => {
    let aktif = true
    api
      .get(`/me/bookmarks?page=${page}&size=${UKURAN}`)
      .then(({ data }) => {
        if (!aktif) return
        setHasil(data)
        setGalat('')
      })
      .catch((err) => {
        if (aktif && err?.status !== 401) setGalat('Gagal memuat simpanan. Coba muat ulang halaman.')
      })
    return () => {
      aktif = false
    }
  }, [page, muatUlang])

  const jumlahHalaman = hasil ? Math.max(1, Math.ceil(hasil.total / UKURAN)) : 1

  return (
    <section className="page-section">
      <div className="page-heading">
        <span className="eyebrow">Jelajah &amp; Baca</span>
        <h1>Simpanan</h1>
        <p>Puisi yang Anda simpan untuk dibaca lagi.</p>
      </div>

      {galat ? <p className="poem-detail-placeholder">{galat}</p> : null}
      {!hasil && !galat ? <Loader label="Memuat simpanan..." /> : null}

      {hasil && hasil.items.length === 0 ? (
        <p className="poem-detail-placeholder">
          Belum ada puisi yang disimpan. Tekan <strong>Simpan</strong> di halaman puisi.
        </p>
      ) : null}

      {hasil && hasil.items.length > 0 ? (
        <div className="poem-grid">
          {hasil.items.map((item) => (
            <article className="poem-card" key={item.poem_id}>
              <h3>{item.title || 'Puisi'}</h3>
              {item.quote_text ? <p className="poem-quote">{item.quote_text}</p> : null}
              {item.status !== 'PUBLISHED' ? <p className="poem-score">Sedang diproses</p> : null}
              <SimpanBagikan
                poemId={item.poem_id}
                title={item.title}
                awalTersimpan
                onBerubah={(simpan) => !simpan && setMuatUlang((n) => n + 1)}
              />
              <div className="poem-card-footer">
                <span className="poem-score">Disimpan {new Date(item.saved_at).toLocaleDateString('id-ID')}</span>
                <Link to={`/poems/${item.poem_id}`} className="text-link">
                  Baca →
                </Link>
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {hasil && jumlahHalaman > 1 ? (
        <div className="page-pagination">
          <button type="button" className="button button-outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Sebelumnya
          </button>
          <span>
            {page} / {jumlahHalaman}
          </span>
          <button
            type="button"
            className="button button-outline"
            disabled={page >= jumlahHalaman}
            onClick={() => setPage(page + 1)}
          >
            Berikutnya
          </button>
        </div>
      ) : null}
    </section>
  )
}
