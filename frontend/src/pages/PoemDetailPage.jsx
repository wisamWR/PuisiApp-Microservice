import { useParams } from 'react-router-dom'

export default function PoemDetailPage() {
  const { id } = useParams()

  return (
    <section className="page-section">
      <div className="page-heading">
        <span className="eyebrow">PUISIAPP / JELAJAH DAN BACA</span>
        <h1>Detail Puisi</h1>
        <p>Membaca karya dan berbagi tanggapan bersama komunitas.</p>
      </div>

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
