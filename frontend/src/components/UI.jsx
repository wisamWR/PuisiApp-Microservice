import { Link } from 'react-router-dom'

export function Toast({ message, type = 'info' }) {
  return (
    <div className={`toast toast-${type}`} role="status">
      <span className="toast-indicator" />
      {message}
    </div>
  )
}

export function Button({
  children,
  variant = 'primary',
  type = 'button',
  onClick,
  disabled = false,
}) {
  return (
    <button
      className={`button button-${variant}`}
      type={type}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  )
}

export function Input({ label, ...props }) {
  return (
    <label className="input-group">
      {label && <span>{label}</span>}
      <input className="input" {...props} />
    </label>
  )
}

export function EmotionLabel({ emotion = 'Belum dianalisis' }) {
  return <span className="emotion-label">{emotion}</span>
}

// Empat level originalitas (All Specifications): Orisinal, Terinspirasi, Mirip, Dugaan jiplakan.
export function OriginalityBadge({ level = 'Belum dinilai' }) {
  const normalized = String(level).toLowerCase().replaceAll(' ', '-')
  return (
    <span className={`originality-badge originality-${normalized}`}>
      Orisinalitas: {level}
    </span>
  )
}

export function Loader({ label = 'Memuat...' }) {
  return (
    <div className="loader-container" role="status">
      <span className="loader" />
      <span>{label}</span>
    </div>
  )
}

export function PoemCard({
  title = 'Judul puisi',
  author = 'Nama penulis',
  emotion = 'Belum dianalisis',
  originality = 'Belum dinilai',
  score = '-',
  to = '/',
}) {
  return (
    <article className="poem-card">
      <div className="poem-card-top">
        <EmotionLabel emotion={emotion} />
        <OriginalityBadge level={originality} />
      </div>
      <h3>{title}</h3>
      <p className="poem-author">Ditulis oleh {author}</p>
      <div className="poem-card-footer">
        <span className="poem-score">Skor: {score}</span>
        <Link to={to} className="text-link">Lihat detail →</Link>
      </div>
    </article>
  )
}
