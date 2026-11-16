import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import EmotionFlowPanel from '../components/EmotionFlowPanel'
import { EmotionLabel, Loader } from '../components/UI'
import { api } from '../lib/api'
import { SAMPLE_MOOD_POEMS } from '../lib/moodData'

export default function PoemDetailPage() {
  const { id } = useParams()
  const [emotionData, setEmotionData] = useState(null)
  const [loading, setLoading] = useState(true)

  const demoPoem = SAMPLE_MOOD_POEMS.find((p) => p.poem_id === id) || null

  useEffect(() => {
    let aktif = true
    setLoading(true)

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
    }
  }, [id, demoPoem])

  return (
    <section className="page-section">
      <div className="page-heading">
        <span className="eyebrow">PUISIAPP / JELAJAH DAN BACA</span>
        <h1>{demoPoem ? demoPoem.title : 'Detail Puisi'}</h1>
        <p>
          {demoPoem
            ? `Karya ${demoPoem.author_name} · Membaca bait dan menelusuri alur suasana karya.`
            : 'Membaca karya dan menelusuri alur suasana puisi.'}
        </p>
      </div>

      <article className="poem-detail-card">
        <div className="poem-card-top">
          <EmotionLabel emotion={emotionData?.dominant ? `Dominan: ${emotionData.dominant}` : 'Puisi'} />
          <Link to="/mood-feed" className="text-link">← Kembali ke Mood Feed</Link>
        </div>

        {demoPoem ? (
          <div className="poem-verse-body">
            {demoPoem.text_lines.map((baris, idx) => (
              <p key={idx}>{baris}</p>
            ))}
          </div>
        ) : (
          <p className="poem-detail-placeholder">
            Isi lengkap puisi akan ditampilkan setelah Poem Query Service terintegrasi (ID: {id}).
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
