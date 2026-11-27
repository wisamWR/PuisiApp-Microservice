import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../lib/api'
import { Loader } from '../components/UI'

const UKURAN = 12

export default function SearchPage() {
  const [params, setParams] = useSearchParams()
  const q = (params.get('q') || '').trim()
  const type = params.get('type') === 'author' ? 'author' : 'poem'
  const halaman = Math.max(1, Number(params.get('page')) || 1)

  const [kataInput, setKataInput] = useState(q)
  const [data, setData] = useState(null)
  const [galat, setGalat] = useState('')

  useEffect(() => {
    if (!q) {
      setData(null)
      setGalat('')
      return
    }
    let aktif = true
    setData(null)
    setGalat('')
    api
      .get(`/search?q=${encodeURIComponent(q)}&type=${type}&page=${halaman}&size=${UKURAN}`)
      .then(({ data }) => {
        if (aktif) setData(data)
      })
      .catch((err) => {
        if (aktif) {
          setGalat(
            err?.status === 401
              ? 'Masuk terlebih dahulu untuk mencari.'
              : 'Pencarian gagal. Coba lagi sebentar.',
          )
        }
      })
    return () => {
      aktif = false
    }
  }, [q, type, halaman])

  function cari(e) {
    e.preventDefault()
    const kata = kataInput.trim()
    if (!kata) return
    setParams({ q: kata, type, page: '1' })
  }

  function gantiJenis(jenis) {
    if (q) setParams({ q, type: jenis, page: '1' })
  }

  function pindahHalaman(h) {
    setParams({ q, type, page: String(h) })
  }

  const totalHalaman = data ? Math.max(1, Math.ceil(data.total / UKURAN)) : 1

  return (
    <section className="page-section">
      <div className="page-heading">
        <span className="eyebrow">Jelajah &amp; Baca</span>
        <h1>Pencarian</h1>
        <p>Cari puisi berdasarkan judul atau isi, atau cari penulis berdasarkan nama.</p>
      </div>

      <form onSubmit={cari} className="search-form">
        <input
          type="search"
          value={kataInput}
          onChange={(e) => setKataInput(e.target.value)}
          placeholder="Tulis kata yang dicari..."
          maxLength={100}
          aria-label="Kata pencarian"
        />
        <button type="submit">Cari</button>
      </form>

      <div className="search-jenis">
        <button type="button" aria-pressed={type === 'poem'} onClick={() => gantiJenis('poem')}>
          Puisi
        </button>
        <button type="button" aria-pressed={type === 'author'} onClick={() => gantiJenis('author')}>
          Penulis
        </button>
      </div>

      {!q ? (
        <p className="poem-detail-placeholder">Masukkan kata untuk mulai mencari.</p>
      ) : galat ? (
        <p className="poem-detail-placeholder">{galat}</p>
      ) : !data ? (
        <Loader label="Mencari..." />
      ) : data.items.length === 0 ? (
        <p className="poem-detail-placeholder">Tidak ada hasil untuk "{q}".</p>
      ) : (
        <>
          <div className="poem-grid">
            {data.type === 'author'
              ? data.items.map((p) => (
                  <article key={p.user_id} className="poem-card">
                    <h3>{p.display_name || 'Penulis'}</h3>
                    <p className="poem-author">{p.jumlah_puisi} puisi terbit</p>
                    <div className="poem-card-footer">
                      <Link to={`/authors/${p.user_id}`} className="text-link">Lihat profil →</Link>
                    </div>
                  </article>
                ))
              : data.items.map((p) => (
                  <article key={p.poem_id} className="poem-card">
                    <h3>{p.title}</h3>
                    {p.quote_text ? <p className="poem-quote">{p.quote_text}</p> : null}
                    <div className="poem-card-footer">
                      <Link to={`/poems/${p.poem_id}`} className="text-link">Lihat detail →</Link>
                    </div>
                  </article>
                ))}
          </div>
          <div className="page-pagination">
            <button type="button" disabled={halaman <= 1} onClick={() => pindahHalaman(halaman - 1)}>
              Sebelumnya
            </button>
            <span>Halaman {halaman} dari {totalHalaman}</span>
            <button type="button" disabled={halaman >= totalHalaman} onClick={() => pindahHalaman(halaman + 1)}>
              Berikutnya
            </button>
          </div>
        </>
      )}
    </section>
  )
}
