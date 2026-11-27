import { Link } from 'react-router-dom'
import { SimpanBagikan } from './SimpanBagikan'

// Kartu untuk satu item HalamanPuisi (RingkasanPuisi di poem-query.yaml).
// Penulis tidak ada di respons beranda, jadi tidak ditampilkan.
export function RingkasanKartu({ item }) {
  const { poem_id, title, quote_text, themes, score } = item
  const daftarTema = themes ?? []

  return (
    <article className="poem-card">
      <h3>{title}</h3>
      {quote_text ? <p className="poem-quote">{quote_text}</p> : null}
      {daftarTema.length > 0 ? (
        <div className="poem-themes">
          {daftarTema.map((tema) => (
            <span key={tema} className="poem-theme-chip">
              {tema}
            </span>
          ))}
        </div>
      ) : null}
      <SimpanBagikan poemId={poem_id} title={title} />
      <div className="poem-card-footer">
        <span className="poem-score">Skor: {score?.value ?? 0}</span>
        <Link to={`/poems/${poem_id}`} className="text-link">
          Lihat detail →
        </Link>
      </div>
    </article>
  )
}
