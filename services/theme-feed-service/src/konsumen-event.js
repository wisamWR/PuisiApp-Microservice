import { buatKonsumen } from '@puisiapp/events';

export const EVENT_DIKONSUMSI = [
  'poem.submitted',
  'poem.revised',
  'poem.published',
  'poem.hidden',
  'poem.deleted',
  'poem.themes.extracted',
  'vote.cast',
  'poem.score.updated',
];

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

      if (tipe === 'poem.deleted' || tipe === 'poem.hidden') {
        await indeksTema.hapusPuisi(poemId);
        return;
      }

      const lama = (await indeksTema.ambilKartuPuisi(poemId)) || {
        poem_id: poemId,
        themes: [],
        theme_scores: {},
      };

      if (tipe === 'poem.submitted' || tipe === 'poem.revised' || tipe === 'poem.published') {
        const diperbarui = {
          ...lama,
          poem_id: poemId,
          title: payload.title ?? lama.title,
          author_id: payload.author_id ?? lama.author_id,
          author_name: payload.author_name ?? lama.author_name,
          excerpt: payload.excerpt ?? payload.content?.slice(0, 180) ?? lama.excerpt,
          status:
            tipe === 'poem.published'
              ? 'published'
              : payload.status || lama.status || 'published',
          published_at: payload.published_at ?? lama.published_at ?? event.occurred_at,
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
          status: lama.status || 'published',
        };
        if (diperbarui.status === 'published') {
          await indeksTema.indeksPuisi(diperbarui);
        } else {
          await indeksTema.simpanKartu(diperbarui);
        }
      } else if (tipe === 'vote.cast' || tipe === 'poem.score.updated') {
        const wilson = payload.wilson_score ?? payload.score ?? lama.wilson_score ?? 0;
        const diperbarui = {
          ...lama,
          poem_id: poemId,
          wilson_score: Number(wilson) || 0,
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
