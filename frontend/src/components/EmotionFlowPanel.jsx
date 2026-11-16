import { EMOSI_LIST } from '../lib/moodData'

export default function EmotionFlowPanel({ emotionData, textLines = [] }) {
  if (!emotionData) return null
  const poemScores = emotionData.poem_scores || {}
  const lines = Array.isArray(emotionData.lines) ? emotionData.lines : []

  return (
    <div className="emotion-flow-box">
      <div className="emotion-flow-header">
        <div>
          <span className="eyebrow">ALUR EMOSI PER BARIS</span>
          <h3>Nuansa Suasana Karya</h3>
        </div>
        <div className="emotion-flow-badges">
          <span className="emotion-label">Dominan: {emotionData.dominant || '-'}</span>
          <span className="status-chip">Model: {emotionData.model || 'lexicon-v1'}</span>
        </div>
      </div>
      <div className="emotion-summary-bars">
        {EMOSI_LIST.map((item) => {
          const persen = Math.round(Number(poemScores[item.key] || 0) * 100)
          return (
            <div key={item.key} className="emotion-bar-row">
              <span className="emotion-bar-name">{item.label}</span>
              <div className="emotion-bar-track"><div className="emotion-bar-fill" style={{ width: `${persen}%`, background: item.color }} /></div>
              <span className="emotion-bar-pct">{persen}%</span>
            </div>
          )
        })}
      </div>
      {lines.length > 0 && (
        <div className="emotion-lines-list">
          {lines.map((line, idx) => {
            const scores = line.scores || {}
            const dominanBaris = EMOSI_LIST.reduce((best, cur) => ((scores[cur.key] || 0) > (scores[best.key] || 0) ? cur : best), EMOSI_LIST[0])
            const teksBaris = textLines[line.index ?? idx] || `Baris ke-${(line.index ?? idx) + 1}`
            return (
              <div key={line.index ?? idx} className="emotion-line-item">
                <div className="emotion-line-top">
                  <span className="muted-text">Baris {(line.index ?? idx) + 1}</span>
                  <span className="emotion-label">{dominanBaris.label}</span>
                </div>
                <p className="emotion-line-verse">“{teksBaris}”</p>
                <div className="emotion-stacked-bar">
                  {EMOSI_LIST.map((item) => (
                    <span key={item.key} style={{ width: `${Math.max(0, Number(scores[item.key] || 0) * 100)}%`, background: item.color }} title={`${item.label}: ${Math.round(Number(scores[item.key] || 0) * 100)}%`} />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
      <p className="emotion-disclaimer">Catatan: Analisis ini menggambarkan nuansa dan suasana hati karya puisi secara leksikal, bukan penilaian kondisi psikologis penulis maupun pembaca.</p>
    </div>
  )
}
