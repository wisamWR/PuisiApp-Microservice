export const EVENT_DIKONSUMSI = [
  'poem.submitted', 'poem.revised', 'poem.published',
  'poem.hidden', 'poem.deleted', 'poem.emotion.analyzed', 'poem.score.updated',
  'user.registered', 'user.profile.updated',
];

const EVENT_PENULIS = new Set(['user.registered', 'user.profile.updated']);

// Nama tampil penulis: display_name dari profil, kalau kosong username.
const SQL_NAMA_PENULIS = `COALESCE(NULLIF(pn.display_name, ''), NULLIF(pn.username, ''))`;

const SQL_BARIS_KARTU = `SELECT poem_id, title, author_id, author_name, excerpt, status, dominant, poem_scores, wilson_score, published_at
         FROM mood_poems`;

/**
 * Simpan nama penulis dari event user.*, lalu perbarui nama di semua puisinya.
 * @returns {Promise<object[]>} baris puisi yang namanya berubah (untuk diindeks ulang)
 */
async function simpanPenulis(event, tx) {
  const p = event.payload || {};
  const userId = String(p.id ?? event.aggregate_id);
  const teks = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 100) : null);

  if (event.event_type === 'user.registered') {
    await tx.query(
      `INSERT INTO mood_penulis (user_id, username, display_name) VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET
         username = COALESCE(EXCLUDED.username, mood_penulis.username),
         display_name = CASE WHEN mood_penulis.profil_at IS NULL
                             THEN COALESCE(EXCLUDED.display_name, mood_penulis.display_name)
                             ELSE mood_penulis.display_name END,
         diubah_at = now()`,
      [userId, teks(p.username), teks(p.display_name)],
    );
  } else {
    // Profil bisa datang tidak berurutan: yang lebih lama tidak menimpa yang baru.
    await tx.query(
      `INSERT INTO mood_penulis (user_id, display_name, profil_at) VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET
         display_name = EXCLUDED.display_name, profil_at = EXCLUDED.profil_at, diubah_at = now()
       WHERE mood_penulis.profil_at IS NULL OR mood_penulis.profil_at <= EXCLUDED.profil_at`,
      [userId, teks(p.display_name), event.occurred_at || new Date().toISOString()],
    );
  }

  const { rows } = await tx.query(
    `UPDATE mood_poems m SET author_name = ${SQL_NAMA_PENULIS}, updated_at = now()
       FROM mood_penulis pn
      WHERE pn.user_id = $1 AND m.author_id = pn.user_id AND ${SQL_NAMA_PENULIS} IS NOT NULL
      RETURNING m.poem_id, m.title, m.author_id, m.author_name, m.excerpt, m.status, m.dominant,
                m.poem_scores, m.wilson_score, m.published_at`,
    [userId],
  );
  return rows;
}

const EVENT_VERSI_KONTEN = new Set(['poem.submitted', 'poem.revised', 'poem.emotion.analyzed']);

const EMOSI_VALID = ['senang', 'sedih', 'cinta', 'marah', 'takut'];

function turunkanDariEmotions(emotions) {
  if (!Array.isArray(emotions) || emotions.length === 0) {
    return { dominant: null, poemScores: {}, lines: [] };
  }
  const totals = Object.fromEntries(EMOSI_VALID.map((e) => [e, 0]));
  const lineMap = new Map();

  for (const item of emotions) {
    const label = String(item?.label || '').toLowerCase().trim();
    const score = Number(item?.score ?? 0);
    const lineNum = Number(item?.line_number ?? 1);
    if (!EMOSI_VALID.includes(label) || !Number.isFinite(score)) continue;
    totals[label] = Number((totals[label] + score).toFixed(4));

    if (!lineMap.has(lineNum)) {
      lineMap.set(lineNum, {
        index: Math.max(0, lineNum - 1),
        line_number: lineNum,
        scores: Object.fromEntries(EMOSI_VALID.map((e) => [e, 0])),
      });
    }
    lineMap.get(lineNum).scores[label] = score;
  }

  const lines = [...lineMap.values()].sort((a, b) => a.line_number - b.line_number);
  const sumAll = Object.values(totals).reduce((acc, v) => acc + v, 0);
  const poemScores = {};
  for (const e of EMOSI_VALID) {
    poemScores[e] = sumAll > 0 ? Number((totals[e] / sumAll).toFixed(4)) : 0;
  }
  const dominant = EMOSI_VALID.reduce((best, cur) => (poemScores[cur] > poemScores[best] ? cur : best), EMOSI_VALID[0]);
  return { dominant, poemScores, lines };
}

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
      if (EVENT_PENULIS.has(event.event_type)) {
        const diubah = await simpanPenulis(event, tx);
        for (const baris of diubah) await indeks?.indeksPuisi?.(baris);
        log?.info?.('nama penulis diperbarui', { event_type: event.event_type, puisi: diubah.length });
        return;
      }

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
        const turunan = Array.isArray(p.emotions) ? turunkanDariEmotions(p.emotions) : null;
        const dominantFinal = p.dominant ? String(p.dominant) : (turunan?.dominant || null);
        const scoresFinal = p.poem_scores && Object.keys(p.poem_scores).length > 0 ? p.poem_scores : (turunan?.poemScores || {});
        const linesFinal = Array.isArray(p.lines) && p.lines.length > 0 ? p.lines : (turunan?.lines || []);
        await tx.query(
          `INSERT INTO mood_poems (poem_id, version, dominant, model, poem_scores, lines, updated_at)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, now())
           ON CONFLICT (poem_id) DO UPDATE SET
             version = EXCLUDED.version, dominant = EXCLUDED.dominant, model = EXCLUDED.model,
             poem_scores = EXCLUDED.poem_scores, lines = EXCLUDED.lines, updated_at = now()
           WHERE mood_poems.version <= EXCLUDED.version`,
          [poemId, versi, dominantFinal, String(p.model || 'lexicon-v1'),
           JSON.stringify(scoresFinal), JSON.stringify(linesFinal)],
        );
      } else if (event.event_type === 'poem.score.updated') {
        const wilson = Number(p.wilson_score ?? p.score ?? 0);
        await tx.query(
          `INSERT INTO mood_poems (poem_id, wilson_score, updated_at) VALUES ($1, $2, now())
           ON CONFLICT (poem_id) DO UPDATE SET wilson_score = EXCLUDED.wilson_score, updated_at = now()`,
          [poemId, Number.isFinite(wilson) ? wilson : 0],
        );
      }

      // Isi nama penulis dari mood_penulis bila sudah diketahui (event poem.* hanya membawa author_id).
      await tx.query(
        `UPDATE mood_poems m SET author_name = ${SQL_NAMA_PENULIS}
           FROM mood_penulis pn
          WHERE m.poem_id = $1 AND pn.user_id = m.author_id AND ${SQL_NAMA_PENULIS} IS NOT NULL
            AND m.author_name IS DISTINCT FROM ${SQL_NAMA_PENULIS}`,
        [poemId],
      );
      const { rows } = await tx.query(`${SQL_BARIS_KARTU} WHERE poem_id = $1`, [poemId]);
      await indeks?.indeksPuisi?.(rows[0] || { poem_id: poemId, status: 'hidden' });
      log?.info?.('indeks mood diperbarui', { event_type: event.event_type, poem_id: poemId });
    },
  };
}
