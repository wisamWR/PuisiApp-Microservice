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
  // T2.6 (kelompok 2): setelah Tulis Puisi menerima 202, data puisi dikirim lewat
  // state router dan ditampilkan sebagai "sedang diproses" (read-your-writes).
  const puisiDiproses = useLocation().state?.puisiDiproses
  const baruDikirim = puisiDiproses?.poem_id === id ? puisiDiproses : null
  const [emotionData, setEmotionData] = useState(null)
  const [loading, setLoading] = useState(true)

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
      </article>
    </section>
  )
}
