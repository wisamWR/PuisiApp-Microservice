/**
 * Puisi Saya (T2.8): semua puisi milik sendiri beserta statusnya, filter per
 * status, alasan untuk puisi yang ditahan / disembunyikan, tombol edit dan hapus.
 * Data: GET /api/me/poems (poem-query-service).
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { FILTER_STATUS, LABEL_LEVEL, STATUS_PUISI, bisaDiedit, jumlahSemua, rapikanAlasan, waktuRelatif } from '../lib/puisiSaya'
import { useToast } from '../components/toast'
import './PuisiSaya.css'

const UKURAN = 20

export default function MyPoemsPage() {
  const { showToast } = useToast()
  const [status, setStatus] = useState(null)
  const [hasil, setHasil] = useState({ items: [], total: 0, counts: null, page: 0 })
  const [memuat, setMemuat] = useState(true)
  const [galat, setGalat] = useState('')
  const [menghapus, setMenghapus] = useState(null)
  const [halaman, setHalaman] = useState(1)

  // Muat ulang saat filter atau halaman berubah. State hanya diubah di callback
  // (setelah respons tiba); penanda "memuat" diatur oleh handler klik.
  useEffect(() => {
    let aktif = true
    const q = new URLSearchParams({ page: String(halaman), size: String(UKURAN) })
    if (status) q.set('status', status)
    api
      .get(`/me/poems?${q}`)
      .then(({ data }) => {
        if (!aktif) return
        setGalat('')
        setHasil((lama) => ({ ...data, items: halaman === 1 ? data.items : [...lama.items, ...data.items] }))
      })
      .catch((err) => {
        if (aktif) setGalat(err?.status === 401 ? 'Masuk dulu untuk melihat puisimu.' : 'Daftar puisi belum bisa dimuat. Coba lagi sebentar lagi.')
      })
      .finally(() => aktif && setMemuat(false))
    return () => {
      aktif = false
    }
  }, [status, halaman])

  function pilihStatus(s) {
    if (s === status) return
    setMemuat(true)
    setHalaman(1)
    setStatus(s)
  }

  async function hapus(puisi) {
    if (!window.confirm(`Hapus "${puisi.title}"? Puisi akan hilang dari semua halaman.`)) return
    setMenghapus(puisi.poem_id)
    try {
      await api.delete(`/poems/${puisi.poem_id}`)
      showToast('Puisi dihapus.', 'success')
      setHasil((lama) => ({
        ...lama,
        items: lama.items.filter((p) => p.poem_id !== puisi.poem_id),
        total: lama.total - 1,
        counts: lama.counts && { ...lama.counts, [puisi.status]: Math.max(0, (lama.counts[puisi.status] ?? 1) - 1) },
      }))
    } catch {
      showToast('Puisi belum bisa dihapus. Coba lagi.', 'error')
    } finally {
      setMenghapus(null)
    }
  }

  const counts = hasil.counts
  const masihAda = hasil.items.length < hasil.total

  return (
    <section className="page-section">
      <div className="page-heading">
        <span className="eyebrow">PUISI</span>
        <h1>Puisi Saya</h1>
        <p>Semua puisimu beserta statusnya, termasuk yang masih diproses atau sedang ditinjau.</p>
      </div>

      <div className="saya-filter" role="group" aria-label="Filter status">
        <button type="button" className={status === null ? 'aktif' : ''} aria-pressed={status === null} onClick={() => pilihStatus(null)}>
          Semua{counts ? ` (${jumlahSemua(counts)})` : ''}
        </button>
        {FILTER_STATUS.map((s) => (
          <button key={s} type="button" className={status === s ? 'aktif' : ''} aria-pressed={status === s} onClick={() => pilihStatus(s)}>
            {STATUS_PUISI[s].label}{counts ? ` (${counts[s] ?? 0})` : ''}
          </button>
        ))}
      </div>

      {galat && <p className="saya-galat" role="alert">{galat}</p>}

      {!galat && !memuat && hasil.items.length === 0 && (
        <div className="saya-kosong">
          <p>{status ? `Tidak ada puisi berstatus ${STATUS_PUISI[status].label.toLowerCase()}.` : 'Kamu belum menulis puisi.'}</p>
          {!status && <Link className="button" to="/write">Tulis puisi pertamamu</Link>}
        </div>
      )}

      <ul className="saya-daftar">
        {hasil.items.map((p) => {
          const info = STATUS_PUISI[p.status] ?? { label: p.status, nada: 'proses', keterangan: '' }
          return (
            <li key={p.poem_id} className="saya-item">
              <div className="saya-item-atas">
                <span className={`saya-status nada-${info.nada}`}>{info.label}</span>
                {p.originality_level && <span className="saya-level">{LABEL_LEVEL[p.originality_level] ?? p.originality_level}</span>}
                {p.latest_version > 1 && <span className="saya-versi">Versi {p.version}</span>}
                <span className="saya-waktu">{waktuRelatif(p.submitted_at)}</span>
              </div>
              <h2><Link to={`/poems/${p.poem_id}`}>{p.title}</Link></h2>
              <p className="saya-kutipan">{p.quote_text}</p>
              {(p.status_reason || info.keterangan) && (
                <p className={`saya-alasan nada-${info.nada}`}>
                  {p.status_reason ? `Alasan: ${rapikanAlasan(p.status_reason)}. ` : ''}{info.keterangan}
                </p>
              )}
              <div className="saya-aksi">
                {bisaDiedit(p.status) && <Link className="text-link" to={`/poems/${p.poem_id}/edit`}>Edit</Link>}
                <button type="button" className="saya-hapus" disabled={menghapus === p.poem_id} onClick={() => hapus(p)}>
                  {menghapus === p.poem_id ? 'Menghapus...' : 'Hapus'}
                </button>
              </div>
            </li>
          )
        })}
      </ul>

      {memuat && <p className="saya-memuat">Memuat...</p>}
      {!memuat && masihAda && (
        <button type="button" className="button button-outline saya-lagi" onClick={() => { setMemuat(true); setHalaman((h) => h + 1) }}>
          Muat lebih banyak
        </button>
      )}
    </section>
  )
}
