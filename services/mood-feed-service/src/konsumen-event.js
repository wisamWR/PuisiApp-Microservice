export const EVENT_DIKONSUMSI = [
  'poem.submitted', 'poem.revised', 'poem.published',
  'poem.hidden', 'poem.deleted', 'poem.emotion.analyzed', 'poem.score.updated',
];

const EVENT_VERSI_KONTEN = new Set(['poem.submitted', 'poem.revised', 'poem.emotion.analyzed']);

function buatRingkasan(teks) {
  const bersih = String(teks || '').replace(/\s+/g, ' ').trim();
  return bersih.length > 160 ? `${bersih.slice(0, 157)}...` : bersih;
}

export function buatHandlerEvent({ indeks, log } = {}) {
  return {
    versiTersimpan: async (event, { tx }) => {
      if (!EVENT_VERSI_KONTEN.has(event.event_type)) return null;
      const poemId = String(event.payload?.poem_id || event.aggregate_id);
      const { rows } = await tx.query('SELECT version FROM mood_poems WHERE poem_id = $1 FOR UPDATE', [poemId]);
      return rows[0]?.version ?? null;
    },
    handler: async (event, { tx }) => {
      const p = event.payload || {};
      const poemId = String(p.poem_id || event.aggregate_id);
      const versi = Number(p.version ?? event.aggregate_version ?? 1);

      if (event.event_type === 'poem.submitted' || event.event_type === 'poem.revised') {
        const statusAwal = p.status === 'published' ? 'published' : 'draft';
        const pubAt = statusAwal === 'published' ? p.published_at || event.occurred_at : null;
        await tx.query(
          `INSERT INTO mood_poems (poem_id, version, title, author_id, author_name, excerpt, status, published_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
           ON CONFLICT (poem_id) DO UPDATE SET
             version = EXCLUDED.version, title = EXCLUDED.title,
             author_id = COALESCE(EXCLUDED.author_id, mood_poems.author_id),
             author_name = COALESCE(NULLIF(EXCLUDED.author_name, ''), mood_poems.author_name),
             excerpt = CASE WHEN EXCLUDED.excerpt <> '' THEN EXCLUDED.excerpt ELSE mood_poems.excerpt END,
             status = CASE WHEN mood_poems.status IN ('hidden', 'deleted') THEN mood_poems.status
                           WHEN EXCLUDED.status = 'published' THEN 'published' ELSE mood_poems.status END,
             published_at = COALESCE(mood_poems.published_at, EXCLUDED.published_at), updated_at = now()
           WHERE mood_poems.version <= EXCLUDED.version`,
          [poemId, versi, String(p.title || p.judul || 'Tanpa Judul'), p.author_id ? String(p.author_id) : null,
           String(p.author_name || p.penulis || 'Penyair PuisiApp'), buatRingkasan(p.content || p.body || p.text || p.isi || ''), statusAwal, pubAt],
        );
      } else if (event.event_type === 'poem.published') {
        const pubAt = p.published_at || event.occurred_at || new Date().toISOString();
        await tx.query(
          `INSERT INTO mood_poems (poem_id, version, title, author_id, author_name, excerpt, status, published_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'published', $7, now())
           ON CONFLICT (poem_id) DO UPDATE SET
             status = 'published',
             title = COALESCE(NULLIF(EXCLUDED.title, 'Tanpa Judul'), mood_poems.title),
             author_id = COALESCE(EXCLUDED.author_id, mood_poems.author_id),
             author_name = COALESCE(NULLIF(EXCLUDED.author_name, 'Penyair PuisiApp'), mood_poems.author_name),
             excerpt = CASE WHEN EXCLUDED.excerpt <> '' THEN EXCLUDED.excerpt ELSE mood_poems.excerpt END,
             published_at = COALESCE(mood_poems.published_at, EXCLUDED.published_at), updated_at = now()`,
          [poemId, versi, String(p.title || p.judul || 'Tanpa Judul'), p.author_id ? String(p.author_id) : null,
           String(p.author_name || p.penulis || 'Penyair PuisiApp'), buatRingkasan(p.content || p.body || p.excerpt || ''), pubAt],
        );
      } else if (event.event_type === 'poem.hidden' || event.event_type === 'poem.deleted') {
        const statusBaru = event.event_type === 'poem.deleted' ? 'deleted' : 'hidden';
        await tx.query(
          `INSERT INTO mood_poems (poem_id, version, status, updated_at) VALUES ($1, $2, $3, now())
           ON CONFLICT (poem_id) DO UPDATE SET status = EXCLUDED.status, updated_at = now()`,
          [poemId, versi, statusBaru],
        );
      } else if (event.event_type === 'poem.emotion.analyzed') {
        await tx.query(
          `INSERT INTO mood_poems (poem_id, version, dominant, model, poem_scores, lines, updated_at)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, now())
           ON CONFLICT (poem_id) DO UPDATE SET
             version = EXCLUDED.version, dominant = EXCLUDED.dominant, model = EXCLUDED.model,
             poem_scores = EXCLUDED.poem_scores, lines = EXCLUDED.lines, updated_at = now()
           WHERE mood_poems.version <= EXCLUDED.version`,
          [poemId, versi, p.dominant ? String(p.dominant) : null, String(p.model || 'lexicon-v1'),
           JSON.stringify(p.poem_scores || {}), JSON.stringify(Array.isArray(p.lines) ? p.lines : [])],
        );
      } else if (event.event_type === 'poem.score.updated') {
        const wilson = Number(p.wilson_score ?? p.score ?? 0);
        await tx.query(
          `INSERT INTO mood_poems (poem_id, wilson_score, updated_at) VALUES ($1, $2, now())
           ON CONFLICT (poem_id) DO UPDATE SET wilson_score = EXCLUDED.wilson_score, updated_at = now()`,
          [poemId, Number.isFinite(wilson) ? wilson : 0],
        );
      }

      const { rows } = await tx.query(
        `SELECT poem_id, title, author_id, author_name, excerpt, status, dominant, poem_scores, wilson_score, published_at
         FROM mood_poems WHERE poem_id = $1`,
        [poemId],
      );
      await indeks?.indeksPuisi?.(rows[0] || { poem_id: poemId, status: 'hidden' });
      log?.info?.('indeks mood diperbarui', { event_type: event.event_type, poem_id: poemId });
    },
  };
}
