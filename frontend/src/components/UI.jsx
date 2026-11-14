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

export function EmotionLabel({ emotion = 'Netral' }) {
  return <span className="emotion-label">{emotion}</span>
}

export function OriginalityBadge({ level = 'Belum dinilai' }) {
  const normalized = level.toLowerCase().replaceAll(' ', '-')
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
  emotion = 'Netral',
  originality = 'Belum dinilai',
  score = '-',
  to = '#',
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
        <a href={to} className="text-link">Lihat detail →</a>
      </div>
    </article>
  )
}
