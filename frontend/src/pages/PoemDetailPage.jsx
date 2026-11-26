import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import EmotionFlowPanel from '../components/EmotionFlowPanel'
import PuisiDiproses from '../components/PuisiDiproses'
import VoteButtons from '../components/VoteButtons'
import { EmotionLabel, Loader } from '../components/UI'
import { api } from '../lib/api'
import { SAMPLE_MOOD_POEMS } from '../lib/moodData'

export default function PoemDetailPage() {
  const { id } = useParams()
  const puisiDiproses = useLocation().state?.puisiDiproses
  const baruDikirim = puisiDiproses?.poem_id === id ? puisiDiproses : null
  const [emotionData, setEmotionData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [authorship, setAuthorship] = useState(null)
  const [authorshipError, setAuthorshipError] = useState('')
  const [downloadingCert, setDownloadingCert] = useState(false)

  const demoPoem = SAMPLE_MOOD_POEMS.find((p) => p.poem_id === id) || null

  useEffect(() => {
    let aktif = true
    const timer = setTimeout(() => {
      if (aktif) setLoading(true)
    }, 0)

    api
      .get(`/emotions/poems/${encodeURIComponent(id)}`)
      .then(({ data }) => {
        if (aktif) setEmotionData(data)
      })
      .catch(() => {
        if (aktif && demoPoem) {
          setEmotionData({
            poem_id: demoPoem.poem_id,
            dominant: demoPoem.dominant,
            model: demoPoem.model,
            poem_scores: demoPoem.poem_scores,
            lines: demoPoem.lines,
          })
        }
      })
      .finally(() => {
        if (aktif) setLoading(false)
      })

    return () => {
      aktif = false
      clearTimeout(timer)
    }
  }, [id, demoPoem])

  useEffect(() => {
    let aktif = true
    let retryTimer = null
    let attempts = 0
    const maxAttempts = 8

    setAuthorship(null)
    setAuthorshipError('')

    const fetchAuthorship = () => {
      api
        .get(`/poems/${encodeURIComponent(id)}/authorship`)
        .then(({ data }) => {
          if (!aktif) return
          setAuthorship(data)
          setAuthorshipError('')
        })
        .catch((err) => {
          if (!aktif) return
          const status = err?.response?.status
          if (status === 401) {
            setAuthorshipError('Masuk terlebih dahulu untuk melihat riwayat authorship dan mengunduh sertifikat.')
            return
          }
          if ((status === 404 || (status >= 500 && status < 600)) && attempts < maxAttempts) {
            attempts += 1
            setAuthorshipError('Menyiapkan catatan authorship dan sertifikat...')
            retryTimer = setTimeout(fetchAuthorship, 2000)
            return
          }
          if (status === 404) {
            setAuthorshipError('Riwayat authorship belum tersedia untuk puisi ini.')
          } else {
            setAuthorshipError('Gagal memuat riwayat authorship.')
          }
        })
    }

    fetchAuthorship()

    return () => {
      aktif = false
      if (retryTimer) clearTimeout(retryTimer)
    }
  }, [id])

  async function handleDownloadCertificate() {
    setDownloadingCert(true)
    try {
      const resp = await api.get(`/poems/${encodeURIComponent(id)}/certificate`, {
        responseType: 'blob',
      })
      const url = window.URL.createObjectURL(new Blob([resp.data], { type: 'application/pdf' }))
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', `authorship-${id}.pdf`)
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    } finally {
      setDownloadingCert(false)
    }
  }

  const dominanLabel = emotionData?.dominant
    ? `Dominan: ${emotionData.dominant.charAt(0).toUpperCase() + emotionData.dominant.slice(1)}`
    : 'Karya Puisi'

  return (
    <section className="page-section">
      <div className="page-heading">
        <span className="eyebrow">Jelajah &amp; Baca</span>
        <h1>{demoPoem ? demoPoem.title : 'Detail Puisi'}</h1>
        <p>
          {demoPoem
            ? `Karya ${demoPoem.author_name} · Membaca bait dan menelusuri alur suasana karya.`
            : 'Membaca karya dan menelusuri alur suasana puisi.'}
        </p>
      </div>

      <PuisiDiproses puisi={baruDikirim} />

      <article className="poem-detail-card">
        <div className="poem-detail-topbar">
          <EmotionLabel emotion={dominanLabel} />
          <Link to="/mood-feed" className="back-link-inline">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M19 12H5" />
              <path d="m12 19-7-7 7-7" />
            </svg>
            <span>Kembali ke Mood Feed</span>
          </Link>
        </div>

        {/* T9.3: upvote/downvote. Tampil bila puisi dikenal vote-service (sudah diajukan). */}
        <div className="poem-detail-vote">
          <VoteButtons poemId={id} />
        </div>

        {demoPoem ? (
          <div className="poem-verse-body">
            {demoPoem.text_lines.map((baris, idx) => (
              <p key={idx}>{baris}</p>
            ))}
          </div>
        ) : (
          <p className="poem-detail-placeholder">
            Naskah lengkap puisi ini sedang disiapkan dan akan segera tampil penuh di halaman ini.
          </p>
        )}

        {loading ? (
          <Loader label="Memuat analisis alur emosi..." />
        ) : (
          <EmotionFlowPanel
            emotionData={emotionData}
            textLines={demoPoem ? demoPoem.text_lines : []}
          />
        )}

        <section className="authorship-panel" aria-label="Bukti waktu dan riwayat authorship">
          <div className="authorship-header">
            <h2>Riwayat &amp; Bukti Waktu Authorship</h2>
            {authorship && (
              <button
                type="button"
                onClick={handleDownloadCertificate}
                disabled={downloadingCert}
              >
                {downloadingCert ? 'Mengunduh PDF...' : 'Unduh Sertifikat PDF'}
              </button>
            )}
          </div>

          {authorshipError && <p>{authorshipError}</p>}

          {authorship && (
            <ul>
              {authorship.records.map((rec) => (
                <li key={rec.version}>
                  <strong>Versi {rec.version}</strong> — Dicatat pada:{' '}
                  <time dateTime={rec.recorded_at}>
                    {new Date(rec.recorded_at).toISOString()}
                  </time>
                  <div>Content Hash: <code>{rec.content_hash}</code></div>
                  <div>Previous Hash: <code>{rec.previous_hash}</code></div>
                  <div>Chain Hash ({rec.algorithm}): <code>{rec.chain_hash}</code></div>
                </li>
              ))}
            </ul>
          )}

          <p className="authorship-disclaimer">
            <strong>Catatan Bukti Waktu:</strong> Catatan ini merekam waktu pencatatan dan integritas
            rantai hash data di dalam sistem. Sertifikat ini bukan bukti hukum kepemilikan atau
            penetapan hak cipta secara resmi.
          </p>
        </section>
      </article>
    </section>
  )
}
