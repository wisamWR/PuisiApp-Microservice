import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DAFTAR_EMOSI = ['senang', 'sedih', 'cinta', 'marah', 'takut'];
export const DAFTAR_MODE = ['senada', 'menghibur'];

const folderIni = path.dirname(fileURLToPath(import.meta.url));
const defaultConfigPath = path.join(folderIni, '../config/peta-menghibur.json');

export function muatPetaMode(configPath = process.env.MOOD_MAP_CONFIG || defaultConfigPath) {
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

export function hitungSkorFeed({ skorEmosi, wilsonScore = 0, publishedAt, sekarangMs = Date.now() }) {
  const emosi = Math.max(0, Math.min(1, Number(skorEmosi) || 0));
  const wilson = Math.max(0, Math.min(1, Number(wilsonScore) || 0));
  const terbitMs = publishedAt ? Date.parse(publishedAt) : sekarangMs;
  const umurJam = Number.isFinite(terbitMs) ? Math.max(0, (sekarangMs - terbitMs) / 3_600_000) : 0;
  const peluruhan = Math.pow(0.5, umurJam / 72);
  return Number((0.6 * emosi + 0.3 * wilson + 0.1 * peluruhan).toFixed(6));
}

export function buatIndeksFeed(redis, { petaMode = muatPetaMode() } = {}) {
  const keyZset = (emosi) => `feed:mood:${emosi}`;
  const keyCard = (poemId) => `poem:card:${poemId}`;

  return {
    targetEmosi(emosi, mode = 'senada') {
      if (!DAFTAR_EMOSI.includes(emosi) || !DAFTAR_MODE.includes(mode)) return null;
      return petaMode[mode]?.[emosi] || [emosi];
    },

    async indeksPuisi(puisi, sekarangMs = Date.now()) {
      if (!redis) return;
      if (!puisi || puisi.status !== 'published' || !puisi.dominant) {
        return this.hapusPuisi(puisi?.poem_id);
      }
      const scores = puisi.poem_scores || {};
      for (const emosi of DAFTAR_EMOSI) {
        const skor = hitungSkorFeed({
          skorEmosi: scores[emosi] ?? 0,
          wilsonScore: puisi.wilson_score ?? 0,
          publishedAt: puisi.published_at,
          sekarangMs,
        });
        await redis.zAdd(keyZset(emosi), [{ score: skor, value: String(puisi.poem_id) }]);
      }
      await redis.hSet(keyCard(puisi.poem_id), {
        poem_id: String(puisi.poem_id),
        title: String(puisi.title || 'Tanpa Judul'),
        author_id: String(puisi.author_id || ''),
        author_name: String(puisi.author_name || 'Penyair PuisiApp'),
        excerpt: String(puisi.excerpt || ''),
        dominant: String(puisi.dominant),
        poem_scores: JSON.stringify(scores),
        wilson_score: String(Number(puisi.wilson_score) || 0),
        published_at: puisi.published_at ? new Date(puisi.published_at).toISOString() : '',
      });
    },

    async hapusPuisi(poemId) {
      if (!redis || !poemId) return;
      for (const emosi of DAFTAR_EMOSI) {
        await redis.zRem(keyZset(emosi), String(poemId));
      }
      await redis.del(keyCard(poemId));
    },

    async bangunUlangSemua(daftarPuisi, sekarangMs = Date.now()) {
      if (!redis) return 0;
      for (const emosi of DAFTAR_EMOSI) await redis.del(keyZset(emosi));
      let jumlah = 0;
      for (const p of daftarPuisi) {
        if (p.status === 'published' && p.dominant) {
          await this.indeksPuisi(p, sekarangMs);
          jumlah += 1;
        }
      }
      return jumlah;
    },

    async ambilFeed(emosi, mode = 'senada', { page = 1, limit = 20 } = {}) {
      const targets = this.targetEmosi(emosi, mode);
      if (!targets || !redis) return null;

      const skorPerPuisi = new Map();
      for (const target of targets) {
        const entri = await redis.zRangeWithScores(keyZset(target), 0, -1, { REV: true });
        for (const { value, score } of entri) {
          const lama = skorPerPuisi.get(value);
          if (!lama || score > lama.feed_score) {
            skorPerPuisi.set(value, { feed_score: Number(score.toFixed(4)), target_emotion: target });
          }
        }
      }

      const terurut = [...skorPerPuisi.entries()].sort((a, b) => b[1].feed_score - a[1].feed_score);
      const offset = (Math.max(1, page) - 1) * limit;
      const items = [];

      for (const [poemId, info] of terurut.slice(offset, offset + limit)) {
        const card = await redis.hGetAll(keyCard(poemId));
        if (!card || !card.poem_id) continue;
        const scores = JSON.parse(card.poem_scores || '{}');
        items.push({
          poem_id: card.poem_id,
          title: card.title,
          author_id: card.author_id || null,
          author_name: card.author_name,
          excerpt: card.excerpt,
          dominant: card.dominant,
          target_emotion: info.target_emotion,
          emotion_score: Number(scores[info.target_emotion] || 0),
          wilson_score: Number(card.wilson_score || 0),
          feed_score: info.feed_score,
          published_at: card.published_at || null,
        });
      }
      return { total: terurut.length, target_emotions: targets, items };
    },
  };
}
