import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import MoodIcon from '../components/MoodIcon'
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
        <span className="eyebrow">Ruang Suasana Hati</span>
        <h1>Bagaimana perasaanmu hari ini?</h1>
        <p>Pilih satu nuansa hati agar kami dapat merangkai bacaan puisi yang paling tepat menemanimu.</p>
      </div>
      <form className="mood-entry-panel" onSubmit={handleLanjut}>
        <div className="mood-choice-grid" role="radiogroup" aria-label="Pilih suasana hati">
          {EMOSI_LIST.map((item) => {
            const aktif = mood === item.key
            return (
              <button
                key={item.key}
                type="button"
                role="radio"
                aria-checked={aktif}
                className={`mood-choice-card${aktif ? ' active' : ''}`}
                style={aktif ? { borderColor: item.color } : undefined}
                onClick={() => setMood(item.key)}
              >
                <div className="mood-choice-top">
                  <span className="mood-icon-badge" style={{ background: item.tint, color: item.color }}>
                    <MoodIcon mood={item.key} size={18} color={item.color} />
                  </span>
                  <span className="mood-dot" style={{ background: item.color, opacity: aktif ? 1 : 0.35 }} />
                </div>
                <strong>{item.label}</strong>
                <span>{item.desc}</span>
              </button>
            )
          })}
        </div>
        <div className="mood-mode-box">
          <span className="eyebrow">Pendampingan Bacaan</span>
          <div className="mood-mode-toggle">
            <button type="button" className={`mode-pill${mode === 'senada' ? ' active' : ''}`} onClick={() => setMode('senada')}>
              <strong>Mode Senada</strong>
              <span>Puisi yang selaras dengan suasana hatimu saat ini</span>
            </button>
            <button type="button" className={`mode-pill${mode === 'menghibur' ? ' active' : ''}`} onClick={() => setMode('menghibur')}>
              <strong>Mode Menghibur</strong>
              <span>Puisi hangat dan cerah untuk menenangkan perasaan</span>
            </button>
          </div>
        </div>
        <div className="mood-entry-footer">
          <p className="muted-text">Preferensi ini tersimpan otomatis dan dapat kamu ubah kapan saja melalui bilah atas.</p>
          <Button type="submit" variant="primary">Mulai Membaca</Button>
        </div>
      </form>
    </section>
  )
}
