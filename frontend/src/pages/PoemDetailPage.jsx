import { useLocation, useParams } from 'react-router-dom'
import PuisiDiproses from '../components/PuisiDiproses'

export default function PoemDetailPage() {
  const { id } = useParams()
  // T2.6 (kelompok 2): setelah Tulis Puisi menerima 202, data puisi dikirim lewat
  // state router dan ditampilkan sebagai "sedang diproses" (read-your-writes).
  const puisiDiproses = useLocation().state?.puisiDiproses
  const baruDikirim = puisiDiproses?.poem_id === id ? puisiDiproses : null

  return (
    <section className="page-section">
      <div className="page-heading">
        <span className="eyebrow">PUISIAPP / JELAJAH DAN BACA</span>
        <h1>Detail Puisi</h1>
        <p>Membaca karya dan berbagi tanggapan bersama komunitas.</p>
      </div>

      <PuisiDiproses puisi={baruDikirim} />

      <article className="poem-detail-card">
        <span className="emotion-label">Puisi</span>
        <h2>Detail karya puisi</h2>
        <p className="poem-detail-placeholder">
          Informasi dan isi puisi akan ditampilkan setelah Poem Service
          terintegrasi.
        </p>
        <span className="muted-text">ID Puisi: {id}</span>
      </article>
    </section>
  )
}
