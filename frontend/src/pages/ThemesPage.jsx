import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Loader } from '../components/UI'
import { api } from '../lib/api'

const TEMA_LIST = [
  { key: 'rindu', label: 'Rindu', desc: 'Kerinduan, kenangan, dan penantian jumpa.' },
  { key: 'kesepian', label: 'Kesepian', desc: 'Sunyi, hening, dan ruang batin yang lirih.' },
  { key: 'alam', label: 'Alam', desc: 'Hujan, langit, samudra, dan lanskap semesta.' },
  { key: 'perjuangan', label: 'Perjuangan', desc: 'Keteguhan, langkah berani, dan harapan bangkit.' },
  { key: 'keluarga', label: 'Keluarga', desc: 'Rumah, kasih orang tua, dan ikatan darah.' },
  { key: 'religius', label: 'Religius', desc: 'Doa, syukur, iman, dan ketenangan spiritual.' },
  { key: 'lainnya', label: 'Lainnya', desc: 'Nuansa tematik beragam di luar daftar utama.' },
]

export default function ThemesPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const awal = searchParams.get('tema') || 'rindu'

  const [selectedTheme, setSelectedTheme] = useState(
    TEMA_LIST.some((t) => t.key === awal) ? awal : 'rindu',
  )
  const [page, setPage] = useState(1)
  const [counts, setCounts] = useState({})
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const muatRingkasan = useCallback(async () => {
    try {
      const { data } = await api.get('/themes/summary')
      if (!Array.isArray(data?.themes)) return
      const peta = {}
      for (const row of data.themes) {
        peta[row.theme] = Number(row.count) || 0
      }
      setCounts(peta)
    } catch {
      // Abaikan jika endpoint ringkasan belum aktif
    }
  }, [])

  const muatFeed = useCallback(async (temaAktif, halamanAktif) => {
    setLoading(true)
    setError('')
    try {
      const { data } = await api.get(
        `/feed/theme/${encodeURIComponent(temaAktif)}?page=${halamanAktif}&limit=10`,
      )
      const daftar = Array.isArray(data?.items) ? data.items : []
      const jumlah = Number(data?.total ?? daftar.length)
      setItems(daftar)
      setTotal(jumlah)
      setCounts((prev) => ({ ...prev, [temaAktif]: jumlah }))
    } catch (err) {
      setItems([])
      setTotal(0)
      setError(err.message || 'Gagal memuat feed puisi berdasarkan tema.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void muatRingkasan()
  }, [muatRingkasan])

  useEffect(() => {
    void muatFeed(selectedTheme, page)
  }, [selectedTheme, page, muatFeed])

  const infoTema = useMemo(
    () => TEMA_LIST.find((t) => t.key === selectedTheme) || TEMA_LIST[0],
    [selectedTheme],
  )

  const pilihTema = (key) => {
    setSelectedTheme(key)
    setPage(1)
    setSearchParams({ tema: key })
  }

  return (
    <section className="page-section">
      <div className="page-heading">
        <span className="eyebrow">Jelajah Tema</span>
        <h1>Puisi Berdasarkan Tema</h1>
        <p>
          Tema aktif: <strong>{infoTema.label}</strong> · {infoTema.desc}
        </p>
      </div>

      <div className="mood-toolbar">
        <div className="mood-chip-row">
          {TEMA_LIST.map((tema) => {
            const aktif = tema.key === selectedTheme
            const jumlah = counts[tema.key] ?? 0
            return (
              <button
                key={tema.key}
                type="button"
                className={`mood-filter-chip${aktif ? ' active' : ''}`}
                onClick={() => pilihTema(tema.key)}
              >
                <span>{tema.label}</span>
                <span className="status-chip">{jumlah}</span>
              </button>
            )
          })}
        </div>
        <Link to="/write" className="button button-primary">
          Tulis Puisi
        </Link>
      </div>

      {loading ? (
        <div className="placeholder-panel">
          <Loader label="Memuat puisi bertema..." />
        </div>
      ) : error ? (
        <div className="placeholder-panel">
          <h2>Feed tema belum tersedia</h2>
          <p>{error}</p>
        </div>
      ) : items.length === 0 ? (
        <div className="placeholder-panel">
          <h2>Belum ada puisi pada tema {infoTema.label}</h2>
          <p>Pilih tema lain pada daftar di atas atau mulai tulis puisi baru.</p>
        </div>
      ) : (
        <>
          <div className="poem-grid">
            {items.map((poem) => (
              <article key={poem.poem_id} className="poem-card">
                <div className="poem-card-top">
                  <span className="status-chip">{infoTema.label}</span>
                  <span className="poem-score">Skor {Number(poem.feed_score ?? 0).toFixed(2)}</span>
                </div>
                <h3>{poem.title || 'Tanpa Judul'}</h3>
                <p className="poem-author">Karya {poem.author_name || 'Penyair PuisiApp'}</p>
                {poem.excerpt && (
                  <blockquote className="mood-poem-excerpt">“{poem.excerpt}”</blockquote>
                )}
                <div className="poem-card-footer">
                  <span className="poem-score">
                    {(poem.themes || [selectedTheme]).join(', ')}
                  </span>
                  <Link to={`/poems/${poem.poem_id}`} className="text-link">
                    Baca puisi
                  </Link>
                </div>
              </article>
            ))}
          </div>

          {total > 10 && (
            <div className="mood-toolbar">
              <button
                type="button"
                className="button button-outline"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Sebelumnya
              </button>
              <span className="poem-score">Halaman {page}</span>
              <button
                type="button"
                className="button button-outline"
                disabled={page * 10 >= total}
                onClick={() => setPage((p) => p + 1)}
              >
                Berikutnya
              </button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
