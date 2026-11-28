export const DAFTAR_TEMA = [
  'rindu',
  'kesepian',
  'alam',
  'perjuangan',
  'keluarga',
  'religius',
  'lainnya',
];

export function hitungSkorTema({ skorTema = 0.5, wilsonScore = 0, publishedAt, sekarangMs = Date.now() }) {
  const tema = Math.max(0, Math.min(1, Number(skorTema) || 0));
  const wilson = Math.max(0, Math.min(1, Number(wilsonScore) || 0));
  const terbitMs = publishedAt ? Date.parse(publishedAt) : sekarangMs;
  const umurJam = Number.isFinite(terbitMs) ? Math.max(0, (sekarangMs - terbitMs) / 3_600_000) : 0;
  const peluruhan = Math.pow(0.5, umurJam / 72);
  return Number((0.75 * wilson + 0.15 * tema + 0.1 * peluruhan).toFixed(6));
}

export function buatIndeksTema(redis) {
  const keyZset = (tema) => `feed:theme:${tema}`;
  const keyCard = (poemId) => `poem:theme-card:${poemId}`;

  return {
    async simpanKartu(puisi) {
      if (!redis || !puisi?.poem_id) return;
      const themes = Array.isArray(puisi.themes) && puisi.themes.length > 0
        ? puisi.themes.map((t) => String(t).toLowerCase())
        : [];
      const scores = puisi.theme_scores || {};

      await redis.hSet(keyCard(puisi.poem_id), {
        poem_id: String(puisi.poem_id),
        title: String(puisi.title || 'Tanpa Judul'),
        author_id: String(puisi.author_id || ''),
        author_name: String(puisi.author_name || 'Penyair PuisiApp'),
        excerpt: String(puisi.excerpt || ''),
        status: String(puisi.status || 'draft'),
        themes: JSON.stringify(themes),
        theme_scores: JSON.stringify(scores),
        wilson_score: String(Number(puisi.wilson_score) || 0),
        published_at: puisi.published_at ? new Date(puisi.published_at).toISOString() : '',
      });
    },

    async ambilKartuPuisi(poemId) {
      if (!redis || !poemId) return null;
      const card = await redis.hGetAll(keyCard(poemId));
      if (!card || !card.poem_id) return null;
      return {
        poem_id: card.poem_id,
        title: card.title,
        author_id: card.author_id || null,
        author_name: card.author_name || 'Penyair PuisiApp',
        excerpt: card.excerpt || '',
        status: card.status || 'draft',
        themes: JSON.parse(card.themes || '[]'),
        theme_scores: JSON.parse(card.theme_scores || '{}'),
        wilson_score: Number(card.wilson_score || 0),
        published_at: card.published_at || null,
      };
    },

    async indeksPuisi(puisi, sekarangMs = Date.now()) {
      if (!redis || !puisi?.poem_id) return;
      const poemId = String(puisi.poem_id);
      const themes = Array.isArray(puisi.themes)
        ? puisi.themes.map((t) => String(t).toLowerCase())
        : [];

      await this.simpanKartu(puisi);

      for (const tema of DAFTAR_TEMA) {
        if (puisi.status === 'published' && themes.includes(tema)) {
          const skor = hitungSkorTema({
            skorTema: puisi.theme_scores?.[tema] ?? 0.75,
            wilsonScore: puisi.wilson_score ?? 0,
            publishedAt: puisi.published_at,
            sekarangMs,
          });
          await redis.zAdd(keyZset(tema), [{ score: skor, value: poemId }]);
        } else {
          await redis.zRem(keyZset(tema), poemId);
        }
      }
    },

    async tandaiNonaktif(poemId, status = 'hidden') {
      if (!redis || !poemId) return;
      const id = String(poemId);
      for (const tema of DAFTAR_TEMA) {
        await redis.zRem(keyZset(tema), id);
      }
      const lama = (await this.ambilKartuPuisi(id)) || {
        poem_id: id,
        themes: [],
        theme_scores: {},
      };
      await this.simpanKartu({
        ...lama,
        poem_id: id,
        status,
      });
    },

    async hapusPuisi(poemId) {
      await this.tandaiNonaktif(poemId, 'deleted');
    },

    async bangunUlangSemua(daftarPuisi, sekarangMs = Date.now()) {
      if (!redis) return 0;
      for (const tema of DAFTAR_TEMA) {
        await redis.del(keyZset(tema));
      }
      let jumlah = 0;
      for (const puisi of daftarPuisi) {
        if (puisi.status === 'published' && Array.isArray(puisi.themes) && puisi.themes.length > 0) {
          await this.indeksPuisi(puisi, sekarangMs);
          jumlah += 1;
        }
      }
      return jumlah;
    },

    async ringkasanTema() {
      const hasil = [];
      let totalPuisi = 0;
      for (const tema of DAFTAR_TEMA) {
        const count = redis ? Number(await redis.zCard(keyZset(tema))) || 0 : 0;
        totalPuisi += count;
        hasil.push({ theme: tema, count });
      }
      return { total_poems: totalPuisi, themes: hasil };
    },

    async ambilFeed(tema, { page = 1, limit = 10 } = {}) {
      const normalTema = String(tema || '').toLowerCase();
      if (!DAFTAR_TEMA.includes(normalTema) || !redis) return null;

      const key = keyZset(normalTema);
      const total = Number(await redis.zCard(key)) || 0;
      const offset = (Math.max(1, page) - 1) * limit;
      const entri = await redis.zRangeWithScores(key, offset, offset + limit - 1, { REV: true });
      const items = [];

      for (const { value, score } of entri) {
        const card = await this.ambilKartuPuisi(value);
        if (!card || card.status !== 'published') continue;
        items.push({
          poem_id: card.poem_id,
          title: card.title,
          author_id: card.author_id,
          author_name: card.author_name,
          excerpt: card.excerpt,
          themes: card.themes,
          theme: normalTema,
          theme_score: Number(card.theme_scores[normalTema] ?? 0.75),
          wilson_score: card.wilson_score,
          feed_score: Number(score.toFixed(4)),
          published_at: card.published_at,
        });
      }

      return { total, items };
    },
  };
}
