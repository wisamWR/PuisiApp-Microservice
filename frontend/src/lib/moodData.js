export const EMOSI_LIST = [
  { key: 'senang', label: 'Senang', desc: 'Cerah, penuh syukur, dan semangat pagi', color: '#4f7955', tint: 'rgba(79, 121, 85, 0.12)' },
  { key: 'sedih', label: 'Sedih', desc: 'Sendu, rindu yang dalam, atau hujan kenangan', color: '#4d6d87', tint: 'rgba(77, 109, 135, 0.12)' },
  { key: 'cinta', label: 'Cinta', desc: 'Hangat, kasih sayang, dan ketulusan hati', color: '#a35b63', tint: 'rgba(163, 91, 99, 0.12)' },
  { key: 'marah', label: 'Marah', desc: 'Gejolak jiwa, perlawanan, dan bara ketegasan', color: '#a8553f', tint: 'rgba(168, 85, 63, 0.12)' },
  { key: 'takut', label: 'Takut', desc: 'Cemas, gulita malam, dan langkah yang bimbang', color: '#6e5d82', tint: 'rgba(110, 93, 130, 0.12)' },
]

export const PETA_MENGHIBUR = {
  sedih: ['senang', 'cinta'],
  takut: ['senang', 'cinta'],
  marah: ['senang', 'cinta'],
  senang: ['senang'],
  cinta: ['cinta'],
}

const STORAGE_KEY = 'puisiapp_mood_pref'

export function sudahPilihMood() {
  try {
    return Boolean(localStorage.getItem(STORAGE_KEY))
  } catch {
    return false
  }
}

export function simpanPreferensiMood(mood, mode = 'senada') {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ mood, mode, savedAt: new Date().toISOString() }))
    window.dispatchEvent(new Event('puisiapp:mood-changed'))
  } catch {}
}

export function bacaPreferensiMood() {
  try {
    const p = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    return {
      mood: EMOSI_LIST.some((e) => e.key === p.mood) ? p.mood : 'senang',
      mode: p.mode === 'menghibur' ? 'menghibur' : 'senada',
    }
  } catch {
    return { mood: 'senang', mode: 'senada' }
  }
}

export const SAMPLE_MOOD_POEMS = [
  {
    poem_id: 'demo-mentari-pagi', title: 'Mentari di Ujung Embun', author_name: 'Sabila Alya',
    excerpt: 'Mentari pagi bersinar cerah menyapa bunga mekar di halaman penuh tawa bahagia...',
    dominant: 'senang', model: 'lexicon-v1', wilson_score: 0.84,
    poem_scores: { senang: 0.78, sedih: 0.02, cinta: 0.14, marah: 0.01, takut: 0.05 },
    text_lines: ['Mentari pagi bersinar cerah di balik jendela', 'Bunga mekar indah menari bersama angin sejuk', 'Hati bersyukur penuh tawa bahagia dan harapan'],
    lines: [
      { index: 0, scores: { senang: 0.85, sedih: 0.0, cinta: 0.1, marah: 0.0, takut: 0.05 } },
      { index: 1, scores: { senang: 0.72, sedih: 0.03, cinta: 0.2, marah: 0.0, takut: 0.05 } },
      { index: 2, scores: { senang: 0.78, sedih: 0.02, cinta: 0.14, marah: 0.02, takut: 0.04 } },
    ],
  },
]
