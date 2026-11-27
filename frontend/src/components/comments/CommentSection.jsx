
import { useCallback, useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { Button, Loader } from '../UI'

const PAGE_SIZE = 10
const MAX_LENGTH = 1000

function formatDate(value) {
  if (!value) return '-'

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) return '-'

  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

export default function CommentSection({
  poemId,
  currentUserId = null,
  userRole = null,
}) {
  const [comments, setComments] = useState([])
  const [content, setContent] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [hasNextPage, setHasNextPage] = useState(false)

  const loadComments = useCallback(async () => {
    if (!poemId) {
      setComments([])
      setLoading(false)
      return
    }

    setLoading(true)
    setError('')

    try {
      const response = await api.get(
        `/poems/${encodeURIComponent(poemId)}/comments?page=${page}`,
      )

      const result = response.data
      const items = Array.isArray(result?.comments)
        ? result.comments
        : []

      setComments(items)
      setHasNextPage(items.length === PAGE_SIZE)
    } catch (err) {
      setComments([])
      setHasNextPage(false)

      if (err.status === 404) {
        setError('Puisi tidak tersedia atau belum dipublikasikan.')
      } else if (err.status === 429) {
        setError('Terlalu banyak permintaan. Silakan coba lagi sebentar.')
      } else {
        setError(err.message || 'Gagal memuat komentar.')
      }
    } finally {
      setLoading(false)
    }
  }, [poemId, page])

  useEffect(() => {
    loadComments()
  }, [loadComments])

  async function handleSubmit(event) {
    event.preventDefault()

    const trimmedContent = content.trim()

    if (!trimmedContent) {
      setNotice('Komentar tidak boleh kosong.')
      return
    }

    if (trimmedContent.length > MAX_LENGTH) {
      setNotice('Komentar maksimal 1.000 karakter.')
      return
    }

    setSubmitting(true)
    setNotice('')
    setError('')

    try {
      await api.post(
        `/poems/${encodeURIComponent(poemId)}/comments`,
        { content: trimmedContent },
      )

      setContent('')
      setNotice('Komentar berhasil dikirim.')

      if (page !== 1) {
        setPage(1)
      } else {
        await loadComments()
      }
    } catch (err) {
      if (err.status === 400) {
        setNotice(err.message)
      } else if (err.status === 404) {
        setError('Puisi tidak tersedia untuk dikomentari.')
      } else if (err.status === 429) {
        setNotice('Batas permintaan tercapai. Coba lagi dalam satu menit.')
      } else if (err.status !== 401) {
        setNotice(err.message || 'Komentar gagal dikirim.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(commentId) {
    const confirmed = window.confirm(
      'Apakah kamu yakin ingin menghapus komentar ini?',
    )

    if (!confirmed) return

    setDeletingId(commentId)
    setNotice('')
    setError('')

    try {
      await api.delete(`/comments/${encodeURIComponent(commentId)}`)
      setNotice('Komentar berhasil dihapus.')
      await loadComments()
    } catch (err) {
      if (err.status === 403) {
        setNotice('Kamu tidak memiliki izin menghapus komentar ini.')
      } else if (err.status === 404) {
        setNotice('Komentar sudah tidak tersedia.')
        await loadComments()
      } else if (err.status === 429) {
        setNotice('Batas permintaan tercapai. Coba lagi nanti.')
      } else if (err.status !== 401) {
        setNotice(err.message || 'Gagal menghapus komentar.')
      }
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <section className="comment-section">
      <div className="comment-heading">
        <div>
          <span className="eyebrow">RUANG DISKUSI</span>
          <h2>Komentar Pembaca</h2>
        </div>

        <span className="comment-count">
          {comments.length} komentar
        </span>
      </div>

      <form className="comment-form" onSubmit={handleSubmit}>
        <label htmlFor="comment-content">
          Bagikan pendapatmu tentang puisi ini
        </label>

        <textarea
          id="comment-content"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder="Tuliskan komentarmu dengan sopan..."
          maxLength={MAX_LENGTH}
          rows={4}
          disabled={submitting}
        />

        <div className="comment-form-footer">
          <span className={content.length >= MAX_LENGTH ? 'character-limit' : ''}>
            {content.length}/{MAX_LENGTH} karakter
          </span>

          <Button
            type="submit"
            disabled={submitting || !content.trim()}
          >
            {submitting ? 'Mengirim...' : 'Kirim komentar'}
          </Button>
        </div>
      </form>

      {notice && (
        <p className="comment-notice" role="status">
          {notice}
        </p>
      )}

      {error && (
        <div className="comment-error" role="alert">
          <p>{error}</p>
          <Button variant="outline" onClick={loadComments}>
            Coba lagi
          </Button>
        </div>
      )}

      {loading ? (
        <Loader label="Memuat komentar..." />
      ) : (
        <>
          {!error && comments.length === 0 && (
            <div className="comment-empty">
              <p>Belum ada komentar.</p>
              <span>
                Jadilah orang pertama yang memberikan tanggapan.
              </span>
            </div>
          )}

          <div className="comment-list">
            {comments.map((comment) => {
              const canDelete =
                currentUserId &&
                (comment.user_id === currentUserId ||
                  userRole === 'moderator')

              return (
                <article className="comment-item" key={comment.id}>
                  <div className="comment-avatar" aria-hidden="true">
                    {String(comment.user_id || '?').slice(0, 1).toUpperCase()}
                  </div>

                  <div className="comment-body">
                    <div className="comment-meta">
                      <strong>
                        Pengguna {comment.user_id}
                      </strong>

                      <time dateTime={comment.created_at}>
                        {formatDate(comment.created_at)}
                      </time>
                    </div>

                    <p className="comment-content">
                      {comment.content}
                    </p>

                    {canDelete && (
                      <button
                        type="button"
                        className="comment-delete"
                        onClick={() => handleDelete(comment.id)}
                        disabled={deletingId === comment.id}
                      >
                        {deletingId === comment.id
                          ? 'Menghapus...'
                          : 'Hapus komentar'}
                      </button>
                    )}
                  </div>
                </article>
              )
            })}
          </div>

          {!error && (page > 1 || hasNextPage) && (
            <div className="comment-pagination">
              <Button
                variant="outline"
                disabled={page <= 1 || loading}
                onClick={() => setPage((current) => current - 1)}
              >
                Sebelumnya
              </Button>

              <span>Halaman {page}</span>

              <Button
                variant="outline"
                disabled={!hasNextPage || loading}
                onClick={() => setPage((current) => current + 1)}
              >
                Berikutnya
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
