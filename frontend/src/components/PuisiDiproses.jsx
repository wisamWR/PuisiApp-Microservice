/**
 * Tampilan optimistik puisi yang baru dikirim (T2.6, laporan 9.3
 * "read-your-writes"): data diambil dari respons 202, bukan dari poem-query,
 * karena read model belum tentu sudah diperbarui. Status langkah pemrosesan
 * secara langsung (SSE) ditambahkan di T2.7.
 */
import { Link } from 'react-router-dom'
import '../pages/WritePoemPage.css'

export default function PuisiDiproses({ puisi }) {
  if (!puisi) return null
  const revisi = puisi.version > 1
  return (
    <article className="puisi-diproses" aria-live="polite">
      <div className="puisi-diproses-atas">
        <span className="status-chip">Sedang diproses</span>
        {revisi && <span className="status-chip">Versi {puisi.version}</span>}
      </div>
      <h2>{puisi.title}</h2>
      <p className="puisi-diproses-isi">{puisi.body}</p>
      <p className="puisi-diproses-info">
        {revisi ? 'Revisimu sudah diterima.' : 'Puisimu sudah diterima.'} Analisis emosi, tema, kata kunci, gambar
        kutipan, dan pemeriksaan keaslian berjalan di latar belakang. Puisi tampil untuk pembaca lain setelah pemeriksaan
        keaslian selesai{revisi ? '; sampai saat itu versi sebelumnya tetap tampil' : ''}.
      </p>
      <p className="tulis-petunjuk" style={{ marginTop: 12 }}>
        <Link className="text-link" to="/write">Tulis puisi lain</Link>
      </p>
    </article>
  )
}
