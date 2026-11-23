import assert from 'node:assert/strict';
import test from 'node:test';
import { buatEvent } from '@puisiapp/events';
import { buatServerHttp } from '../src/http.js';
import { buatIndeksTema } from '../src/indeks-tema.js';
import { mulaiKonsumenThemeFeed } from '../src/konsumen-event.js';

function buatFakeRedis() {
  const zsets = new Map();
  const hashes = new Map();

  const getZ = (k) => {
    if (!zsets.has(k)) zsets.set(k, new Map());
    return zsets.get(k);
  };

  return {
    async zAdd(key, entries) {
      const z = getZ(key);
      for (const { score, value } of entries) z.set(String(value), Number(score));
    },
    async zRem(key, member) {
      getZ(key).delete(String(member));
    },
    async del(key) {
      zsets.delete(key);
      hashes.delete(key);
    },
    async zCard(key) {
      return getZ(key).size;
    },
    async zRangeWithScores(key, _start, _stop, opts = {}) {
      const arr = [...getZ(key).entries()].map(([value, score]) => ({ value, score }));
      arr.sort((a, b) => (opts.REV ? b.score - a.score : a.score - b.score));
      return arr;
    },
    async hSet(key, obj) {
      hashes.set(key, { ...(hashes.get(key) || {}), ...obj });
    },
    async hGetAll(key) {
      return hashes.get(key) || null;
    },
  };
}

test('indeks feed:theme:<tema> dan endpoint GET /api/feed/theme/:tema?page=', async () => {
  const redis = buatFakeRedis();
  const indeks = buatIndeksTema(redis);

  await indeks.indeksPuisi({
    poem_id: 'p-1',
    title: 'Hujan di Hutan Pinus',
    author_name: 'Sabila',
    excerpt: 'Rintik jatuh membasahi daun dan rindu.',
    status: 'published',
    themes: ['alam', 'rindu'],
    theme_scores: { alam: 0.9, rindu: 0.6 },
    wilson_score: 0.8,
    published_at: '2026-11-20T00:00:00.000Z',
  });

  const server = buatServerHttp({ indeksTema: indeks });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/feed/theme/alam?page=1&limit=10`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.theme, 'alam');
    assert.equal(body.total, 1);
    assert.equal(body.items[0].poem_id, 'p-1');
  } finally {
    server.close();
  }
});

test('konsumen event mengindeks tema dan menghapus saat poem.deleted', async () => {
  const redis = buatFakeRedis();
  const indeks = buatIndeksTema(redis);
  let onMessage = null;
  const fakeChannel = {
    async assertExchange() {},
    async assertQueue() {},
    async bindQueue() {},
    async prefetch() {},
    async consume(_q, cb) {
      onMessage = cb;
      return { consumerTag: 'ctag-1' };
    },
    ack() {},
    nack() {},
  };
  const fakeKoneksi = {
    async createConfirmChannel() {
      return fakeChannel;
    },
  };

  await mulaiKonsumenThemeFeed({
    koneksi: fakeKoneksi,
    store: {
      async proses(evt, fn) {
        await fn(evt);
        return 'diproses';
      },
    },
    indeksTema: indeks,
  });

  const poemId = '11111111-1111-4111-8111-111111111119';
  const emit = async (event_type, payload) => {
    const amplop = buatEvent(event_type, poemId, 1, payload);
    const msg = {
      properties: { headers: {} },
      content: Buffer.from(JSON.stringify(amplop)),
    };
    await onMessage(msg);
    await new Promise((r) => setTimeout(r, 25));
  };

  await emit('poem.published', {
    poem_id: poemId,
    title: 'Doa di Subuh',
    author_name: 'Penyair',
    excerpt: 'Bersujud penuh syukur.',
  });
  await emit('poem.themes.extracted', {
    poem_id: poemId,
    themes: ['religius'],
  });

  let feed = await indeks.ambilFeed('religius');
  assert.equal(feed.total, 1);

  await emit('poem.deleted', { poem_id: poemId });
  feed = await indeks.ambilFeed('religius');
  assert.equal(feed.total, 0);
});
