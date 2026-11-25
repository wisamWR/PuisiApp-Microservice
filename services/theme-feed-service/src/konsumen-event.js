import { buatKonsumen } from '@puisiapp/events';

export const EVENT_DIKONSUMSI = [
  'poem.submitted',
  'poem.revised',
  'poem.published',
  'poem.hidden',
  'poem.deleted',
  'poem.themes.extracted',
  'poem.score.updated',
];

const STATUS_NONAKTIF = new Set(['hidden', 'deleted']);

function buatCuplikan(payload, lamaExcerpt) {
  if (typeof payload.excerpt === 'string' && payload.excerpt.trim() !== '') {
    return payload.excerpt;
  }
  const sumberTeks = payload.body ?? payload.content;
  if (typeof sumberTeks === 'string' && sumberTeks.trim() !== '') {
    return sumberTeks.trim().slice(0, 180);
  }
  return lamaExcerpt || '';
}

export async function mulaiKonsumenThemeFeed({
  koneksi,
  store,
  indeksTema,
  log,
  prefetch = 10,
}) {
  return buatKonsumen({
    koneksi,
    antrean: 'q.theme-feed',
    ikatan: EVENT_DIKONSUMSI,
    store,
    prefetch,
    log,
    async handler(event) {
      const tipe = event.event_type;
      const payload = event.payload || {};
      const poemId = String(payload.poem_id || event.aggregate_id || '');
      if (!poemId) return;

      if (tipe === 'poem.deleted') {
        await indeksTema.tandaiNonaktif(poemId, 'deleted');
        return;
      }
      if (tipe === 'poem.hidden') {
        await indeksTema.tandaiNonaktif(poemId, 'hidden');
        return;
      }

      const lama = (await indeksTema.ambilKartuPuisi(poemId)) || {
        poem_id: poemId,
        status: 'draft',
        themes: [],
        theme_scores: {},
      };
      const terkunciNonaktif = STATUS_NONAKTIF.has(lama.status);

      if (tipe === 'poem.submitted' || tipe === 'poem.revised' || tipe === 'poem.published') {
        let statusBaru = lama.status || 'draft';
        if (tipe === 'poem.published') {
          statusBaru = 'published';
        } else if (!terkunciNonaktif && payload.status) {
          statusBaru = String(payload.status).toLowerCase();
        }

        const diperbarui = {
          ...lama,
          poem_id: poemId,
          title: payload.title ?? lama.title,
          author_id: payload.author_id ?? lama.author_id,
          author_name: payload.author_name ?? lama.author_name,
          excerpt: buatCuplikan(payload, lama.excerpt),
          status: statusBaru,
          published_at:
            tipe === 'poem.published'
              ? (payload.published_at ?? event.occurred_at ?? lama.published_at)
              : (payload.published_at ?? lama.published_at),
        };
        await indeksTema.simpanKartu(diperbarui);
        if (diperbarui.status === 'published' && diperbarui.themes.length > 0) {
          await indeksTema.indeksPuisi(diperbarui);
        }
      } else if (tipe === 'poem.themes.extracted') {
        const themes =
          Array.isArray(payload.themes) && payload.themes.length > 0
            ? payload.themes.map((t) => String(t).toLowerCase())
            : lama.themes;
        const themeScores = payload.scores || payload.theme_scores || lama.theme_scores || {};
        const diperbarui = {
          ...lama,
          poem_id: poemId,
          themes,
          theme_scores: themeScores,
          status: lama.status || 'draft',
        };
        if (diperbarui.status === 'published') {
          await indeksTema.indeksPuisi(diperbarui);
        } else {
          await indeksTema.simpanKartu(diperbarui);
        }
      } else if (tipe === 'poem.score.updated') {
        const wilson = payload.wilson_score ?? payload.score ?? lama.wilson_score ?? 0;
        const diperbarui = {
          ...lama,
          poem_id: poemId,
          wilson_score: Number(wilson) || 0,
          status: lama.status || 'draft',
        };
        if (diperbarui.status === 'published' && diperbarui.themes.length > 0) {
          await indeksTema.indeksPuisi(diperbarui);
        } else {
          await indeksTema.simpanKartu(diperbarui);
        }
      }
    },
  });
}
