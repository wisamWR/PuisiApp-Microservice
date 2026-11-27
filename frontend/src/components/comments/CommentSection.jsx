import { useEffect, useState } from 'react'
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

function getAuthorLabel(comment) {
  const nama = comment?.author_name || comment?.display_name || comment?.username
  if (typeof nama === 'string' && nama.trim()) {
    return nama.trim()
  }
  return comment?.user_id || 'Pengguna'
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
  const [reportingId, setReportingId] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [hasNextPage, setHasNextPage] = useState(false)

  function fetchComments(targetPoemId, targetPage, onDone) {
    if (!targetPoemId) {
      setComments([])
      setHasNextPage(false)
      setError('')
      setLoading(false)
      onDone?.()
      return
    }

    setError('')

    api
      .get(`/poems/${encodeURIComponent(targetPoemId)}/comments?page=${targetPage}`)
      .then(({ data }) => {
        const items = Array.isArray(data?.comments) ? data.comments : []
        setComments(items)
        setHasNextPage(items.length === PAGE_SIZE)
      })
      .catch((err) => {
        setComments([])
        setHasNextPage(false)
        if (err?.status === 404) {
          setError('Puisi tidak tersedia atau belum dipublikasikan.')
        } else if (err?.status === 429) {
          setError('Terlalu banyak permintaan. Silakan coba lagi sebentar.')
        } else {
          setError(err?.message || 'Gagal memuat komentar.')
        }
      })
      .finally(() => {
        setLoading(false)
        onDone?.()
      })
  }

  useEffect(() => {
    let aktif = true
    if (!poemId) {
      Promise.resolve().then(() => {
        if (!aktif) return
        setComments([])
        setHasNextPage(false)
        setError('')
        setLoading(false)
      })
      return () => {
        aktif = false
      }
    }

    api
      .get(`/poems/${encodeURIComponent(poemId)}/comments?page=${page}`)
      .then(({ data }) => {
        if (!aktif) return
        const items = Array.isArray(data?.comments) ? data.comments : []
        setComments(items)
        setHasNextPage(items.length === PAGE_SIZE)
        setError('')
      })
      .catch((err) => {
        if (!aktif) return
        setComments([])
        setHasNextPage(false)
        if (err?.status === 404) {
          setError('Puisi tidak tersedia atau belum dipublikasikan.')
        } else if (err?.status === 429) {
          setError('Terlalu banyak permintaan. Silakan coba lagi sebentar.')
        } else {
          setError(err?.message || 'Gagal memuat komentar.')
        }
      })
      .finally(() => {
        if (aktif) setLoading(false)
      })

    return () => {
      aktif = false
    }
  }, [poemId, page])

  function handleRetry() {
    setLoading(true)
    fetchComments(poemId, page)
  }

  function handleChangePage(nextPage) {
    setLoading(true)
    setPage(nextPage)
  }

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
        setLoading(true)
        setPage(1)
      } else {
        setLoading(true)
        fetchComments(poemId, 1)
      }
    } catch (err) {
      if (err?.status === 400) {
        setNotice(err.message)
      } else if (err?.status === 404) {
        setError('Puisi tidak tersedia untuk dikomentari.')
      } else if (err?.status === 429) {
        setNotice('Batas permintaan tercapai. Coba lagi dalam satu menit.')
      } else if (err?.status !== 401) {
        setNotice(err?.message || 'Komentar gagal dikirim.')
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
      setLoading(true)
      fetchComments(poemId, page)
    } catch (err) {
      if (err?.status === 403) {
        setNotice('Kamu tidak memiliki izin menghapus komentar ini.')
      } else if (err?.status === 404) {
        setNotice('Komentar sudah tidak tersedia.')
        setLoading(true)
        fetchComments(poemId, page)
      } else if (err?.status === 429) {
        setNotice('Batas permintaan tercapai. Coba lagi nanti.')
      } else if (err?.status !== 401) {
        setNotice(err?.message || 'Gagal menghapus komentar.')
      }
    } finally {
      setDeletingId(null)
    }
  }

  async function handleReport(commentId) {
    const reason = window.prompt('Alasan melaporkan komentar (opsional, maks. 500 karakter):')
    if (reason === null) return

    setReportingId(commentId)
    setNotice('')

    try {
      await api.post(`/comments/${encodeURIComponent(commentId)}/report`, {
        reason: reason.trim(),
      })
      setNotice('Laporan komentar berhasil dikirim untuk ditinjau.')
    } catch (err) {
      if (err?.status === 400) {
        setNotice(err.message || 'Alasan laporan terlalu panjang.')
      } else if (err?.status === 404) {
        setNotice('Komentar sudah tidak tersedia.')
      } else if (err?.status !== 401) {
        setNotice(err?.message || 'Gagal mengirim laporan komentar.')
      }
    } finally {
      setReportingId(null)
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
          <Button variant="outline" onClick={handleRetry}>
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
              const authorLabel = getAuthorLabel(comment)
              const canDelete =
                currentUserId &&
                (comment.user_id === currentUserId ||
                  userRole === 'moderator' ||
                  userRole === 'admin')

              return (
                <article className="comment-item" key={comment.id}>
                  <div className="comment-avatar" aria-hidden="true">
                    {String(authorLabel || '?').slice(0, 1).toUpperCase()}
                  </div>

                  <div className="comment-body">
                    <div className="comment-meta">
                      <strong>{authorLabel}</strong>

                      <time dateTime={comment.created_at}>
                        {formatDate(comment.created_at)}
                      </time>
                    </div>

                    <p className="comment-content">
                      {comment.content}
                    </p>

                    <div className="comment-actions">
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

                      {currentUserId && (
                        <button
                          type="button"
                          className="comment-report"
                          onClick={() => handleReport(comment.id)}
                          disabled={reportingId === comment.id}
                        >
                          {reportingId === comment.id
                            ? 'Melaporkan...'
                            : 'Laporkan'}
                        </button>
                      )}
                    </div>
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
                onClick={() => handleChangePage(page - 1)}
              >
                Sebelumnya
              </Button>

              <span>Halaman {page}</span>

              <Button
                variant="outline"
                disabled={!hasNextPage || loading}
                onClick={() => handleChangePage(page + 1)}
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
