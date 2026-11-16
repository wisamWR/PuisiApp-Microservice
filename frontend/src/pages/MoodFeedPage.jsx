import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { EmotionLabel, Loader } from '../components/UI'
import { api } from '../lib/api'
import {
  EMOSI_LIST,
  PETA_MENGHIBUR,
  SAMPLE_MOOD_POEMS,
  bacaPreferensiMood,
  simpanPreferensiMood,
} from '../lib/moodData'

export default function MoodFeedPage() {
  const awal = bacaPreferensiMood()
  const [mood, setMood] = useState(awal.mood)
  const [mode, setMode] = useState(awal.mode)
  const [items, setItems] = useState([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [sumber, setSumber] = useState('api')
  const sentinelRef = useRef(null)

  const targetList = mode === 'menghibur' ? (PETA_MENGHIBUR[mood] || [mood]) : [mood]

  const muatHalaman = useCallback(async (targetPage, reset = false) => {
    if (reset) setLoading(true)
    else setLoadingMore(true)

    try {
      const { data } = await api.get(`/feed/mood/${mood}?mode=${mode}&page=${targetPage}&limit=10`)
      const baru = Array.isArray(data?.items) ? data.items : []
      setItems((prev) => (reset ? baru : [...prev, ...baru]))
      setHasMore(Boolean(data?.has_more))
      setPage(targetPage)
      setSumber('api')
    } catch {
      const urutDemo = [...SAMPLE_MOOD_POEMS]
        .map((p) => {
          const skorTerbaik = Math.max(...targetList.map((t) => Number(p.poem_scores?.[t] || 0)))
          const targetTerbaik = targetList.reduce((best, t) => ((p.poem_scores?.[t] || 0) > (p.poem_scores?.[best] || 0) ? t : best), targetList[0])
          const feedScore = Number((0.6 * skorTerbaik + 0.3 * p.wilson_score + 0.1 * 0.95).toFixed(4))
          return { ...p, emotion_score: skorTerbaik, feed_score: feedScore, target_emotion: targetTerbaik }
        })
        .sort((a, b) => b.feed_score - a.feed_score)
      setItems(urutDemo)
      setHasMore(false)
      setSumber('demo')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [mood, mode, targetList])

  useEffect(() => {
    simpanPreferensiMood(mood, mode)
    muatHalaman(1, true)
  }, [mood, mode, muatHalaman])

  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !hasMore || loading || loadingMore) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) muatHalaman(page + 1, false)
      },
      { rootMargin: '160px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasMore, loading, loadingMore, page, muatHalaman])

  return (
    <section className="page-section">
      <div className="page-heading">
        <span className="eyebrow">PUISIAPP / MOOD FEED</span>
        <h1>Kurasi Puisi Berbasis Suasana Hati</h1>
        <p>
          Mode <strong>{mode === 'senada' ? 'Senada' : 'Menghibur'}</strong> · Nuansa target:{' '}
          <strong>{targetList.join(' & ')}</strong>.
        </p>
      </div>

      <div className="mood-toolbar">
        <div className="mood-chip-row">
          {EMOSI_LIST.map((item) => (
            <button key={item.key} type="button" className={`mood-filter-chip${mood === item.key ? ' active' : ''}`} onClick={() => setMood(item.key)}>
              <span>{item.emoji}</span>
              {item.label}
            </button>
          ))}
        </div>
        <div className="mood-mode-switch">
          <button type="button" className={`button ${mode === 'senada' ? 'button-primary' : 'button-outline'}`} onClick={() => setMode('senada')}>Senada</button>
          <button type="button" className={`button ${mode === 'menghibur' ? 'button-primary' : 'button-outline'}`} onClick={() => setMode('menghibur')}>Menghibur</button>
        </div>
      </div>

      {sumber === 'demo' && (
        <div className="mood-demo-banner">
          <span>Mode Pratinjau Lokal (API gateway belum terjangkau — menampilkan sampel lokal)</span>
          <Link to="/mood-entry" className="text-link">Ubah Mood Entry →</Link>
        </div>
      )}

      {loading ? (
        <div className="placeholder-panel"><Loader label="Menyusun puisi sesuai suasana hati..." /></div>
      ) : items.length === 0 ? (
        <div className="placeholder-panel">
          <h2>Belum ada puisi terbit untuk suasana ini</h2>
          <p>Coba ganti pilihan suasana hati atau beralih antara mode Senada dan Menghibur.</p>
        </div>
      ) : (
        <>
          <div className="poem-grid">
            {items.map((poem) => (
              <article key={poem.poem_id} className="poem-card">
                <div className="poem-card-top">
                  <EmotionLabel emotion={`Suasana: ${poem.dominant}`} />
                  <span className="status-chip">Skor: {poem.feed_score}</span>
                </div>
                <h3>{poem.title}</h3>
                <p className="poem-author">Ditulis oleh {poem.author_name || 'Penyair PuisiApp'}</p>
                {poem.excerpt && <p className="mood-poem-excerpt">{poem.excerpt}</p>}
                <div className="poem-card-footer">
                  <span className="poem-score">Relevansi {poem.target_emotion}: {Math.round((poem.emotion_score || 0) * 100)}%</span>
                  <Link to={`/poems/${poem.poem_id}`} className="text-link">Lihat alur emosi →</Link>
                </div>
              </article>
            ))}
          </div>
          <div ref={sentinelRef} className="mood-scroll-sentinel">
            {loadingMore ? 'Memuat puisi berikutnya...' : hasMore ? 'Gulir ke bawah untuk memuat lebih banyak' : 'Semua puisi untuk suasana ini telah ditampilkan'}
          </div>
        </>
      )}
    </section>
  )
}
