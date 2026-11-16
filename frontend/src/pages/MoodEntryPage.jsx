import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/UI'
import { EMOSI_LIST, bacaPreferensiMood, simpanPreferensiMood } from '../lib/moodData'

export default function MoodEntryPage() {
  const tersimpan = bacaPreferensiMood()
  const [mood, setMood] = useState(tersimpan.mood)
  const [mode, setMode] = useState(tersimpan.mode)
  const navigate = useNavigate()

  function handleLanjut(e) {
    e.preventDefault()
    simpanPreferensiMood(mood, mode)
    navigate('/mood-feed')
  }

  return (
    <section className="page-section">
      <div className="page-heading">
        <span className="eyebrow">PUISIAPP / MOOD ENTRY</span>
        <h1>Bagaimana suasana hatimu hari ini?</h1>
        <p>Pilih satu nuansa perasaan untuk menyusun rekomendasi bacaan puisi yang tepat menemani harimu.</p>
      </div>
      <form className="mood-entry-panel" onSubmit={handleLanjut}>
        <div className="mood-choice-grid" role="radiogroup" aria-label="Pilih suasana hati">
          {EMOSI_LIST.map((item) => {
            const aktif = mood === item.key
            return (
              <button key={item.key} type="button" role="radio" aria-checked={aktif}
                className={`mood-choice-card${aktif ? ' active' : ''}`} onClick={() => setMood(item.key)}>
                <div className="mood-choice-top">
                  <span className="mood-emoji" aria-hidden="true">{item.emoji}</span>
                  <span className="mood-dot" style={{ background: item.color }} />
                </div>
                <strong>{item.label}</strong>
                <span>{item.desc}</span>
              </button>
            )
          })}
        </div>
        <div className="mood-mode-box">
          <span className="eyebrow">MODE PENDAMPINGAN BACA</span>
          <div className="mood-mode-toggle">
            <button type="button" className={`mode-pill${mode === 'senada' ? ' active' : ''}`} onClick={() => setMode('senada')}>
              <strong>Mode Senada</strong>
              <span>Puisi yang selaras dengan suasana hatimu saat ini</span>
            </button>
            <button type="button" className={`mode-pill${mode === 'menghibur' ? ' active' : ''}`} onClick={() => setMode('menghibur')}>
              <strong>Mode Menghibur</strong>
              <span>Puisi hangat &amp; cerah untuk menenangkan perasaan</span>
            </button>
          </div>
        </div>
        <div className="mood-entry-footer">
          <p className="muted-text">Pilihan suasana hati disimpan di perangkatmu (localStorage) dan dapat diganti kapan saja lewat header.</p>
          <Button type="submit" variant="primary">Buka Mood Feed →</Button>
        </div>
      </form>
    </section>
  )
}
