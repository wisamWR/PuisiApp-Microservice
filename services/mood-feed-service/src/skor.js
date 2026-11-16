export const DAFTAR_EMOSI = Object.freeze(['senang', 'sedih', 'cinta', 'marah', 'takut']);
export const DAFTAR_MODE = Object.freeze(['senada', 'menghibur']);

const PETA_MENGHIBUR = Object.freeze({
  sedih: 'senang',
  marah: 'senang',
  takut: 'cinta',
  senang: 'senang',
  cinta: 'cinta',
});

export function emosiTarget(emosi, mode = 'senada') {
  const e = String(emosi || '').toLowerCase().trim();
  const m = String(mode || 'senada').toLowerCase().trim();
  if (!DAFTAR_EMOSI.includes(e)) return null;
  if (!DAFTAR_MODE.includes(m)) return null;
  return m === 'menghibur' ? PETA_MENGHIBUR[e] : e;
}

export function hitungPeluruhanWaktu(publishedAt, sekarangMs = Date.now(), waktuParuhJam = 72) {
  if (!publishedAt) return 0.5;
  const pubMs = publishedAt instanceof Date ? publishedAt.getTime() : Date.parse(publishedAt);
  if (!Number.isFinite(pubMs)) return 0.5;
  const selisihJam = Math.max(0, (sekarangMs - pubMs) / (1000 * 60 * 60));
  const lambda = Math.LN2 / waktuParuhJam;
  return Math.exp(-lambda * selisihJam);
}

export function hitungSkorFeed({ skorEmosi = 0.2, wilsonScore = 0, publishedAt, sekarangMs = Date.now() }) {
  const e = Math.min(1, Math.max(0, Number(skorEmosi) || 0));
  const w = Math.min(1, Math.max(0, Number(wilsonScore) || 0));
  const t = hitungPeluruhanWaktu(publishedAt, sekarangMs);
  return Number((0.6 * e + 0.3 * w + 0.1 * t).toFixed(6));
}

export function urutkanFeed(daftarPuisi, emosi, mode = 'senada', sekarangMs = Date.now()) {
  const target = emosiTarget(emosi, mode);
  if (!target) return [];

  return daftarPuisi
    .filter((p) => p.status === 'published' && p.dominant)
    .map((p) => {
      const scores = p.poem_scores || {};
      const skorEmosi = Number(scores[target] ?? 0);
      const feedScore = hitungSkorFeed({
        skorEmosi,
        wilsonScore: p.wilson_score,
        publishedAt: p.published_at,
        sekarangMs,
      });
      return {
        poem_id: p.poem_id,
        title: p.title,
        author_id: p.author_id,
        author_name: p.author_name,
        excerpt: p.excerpt,
        dominant: p.dominant,
        target_emotion: target,
        emotion_score: Number(skorEmosi.toFixed(4)),
        wilson_score: Number((Number(p.wilson_score) || 0).toFixed(4)),
        feed_score: feedScore,
        poem_scores: scores,
        model: p.model,
        published_at: p.published_at,
      };
    })
    .sort((a, b) => b.feed_score - a.feed_score);
}
