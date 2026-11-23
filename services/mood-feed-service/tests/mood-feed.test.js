import test from 'node:test';
import assert from 'node:assert/strict';
import { buatAppHttp } from '../src/http.js';
import { buatIndeksFeed, hitungSkorFeed } from '../src/indeks-redis.js';
import { buatHandlerEvent } from '../src/konsumen-event.js';

function buatFakeRedis() {
  const zsets = new Map();
  const hashes = new Map();
  return {
    async zAdd(key, entries) {
      if (!zsets.has(key)) zsets.set(key, new Map());
      for (const { score, value } of entries) zsets.get(key).set(value, score);
    },
    async zRem(key, value) { zsets.get(key)?.delete(value); },
    async zRangeWithScores(key, start, stop, { REV } = {}) {
      const arr = [...(zsets.get(key)?.entries() || [])].map(([value, score]) => ({ value, score }));
      arr.sort((a, b) => (REV ? b.score - a.score : a.score - b.score));
      return stop === -1 ? arr.slice(start) : arr.slice(start, stop + 1);
    },
    async hSet(key, obj) { hashes.set(key, { ...(hashes.get(key) || {}), ...obj }); },
    async hGetAll(key) { return hashes.get(key) || {}; },
    async del(key) { zsets.delete(key); hashes.delete(key); },
  };
}

test('peta menghibur dari konfigurasi memetakan sedih/takut/marah ke senang & cinta', () => {
  const indeks = buatIndeksFeed(buatFakeRedis());
  assert.deepEqual(indeks.targetEmosi('sedih', 'senada'), ['sedih']);
  assert.deepEqual(indeks.targetEmosi('sedih', 'menghibur'), ['senang', 'cinta']);
  assert.deepEqual(indeks.targetEmosi('takut', 'menghibur'), ['senang', 'cinta']);
  assert.deepEqual(indeks.targetEmosi('marah', 'menghibur'), ['senang', 'cinta']);
  assert.deepEqual(indeks.targetEmosi('senang', 'menghibur'), ['senang']);
  assert.deepEqual(indeks.targetEmosi('cinta', 'menghibur'), ['cinta']);
});

test('indeks Redis sorted set, header Cache-Control, dan penghapusan instan poem.hidden', async () => {
  const now = Date.parse('2026-11-15T12:00:00Z');
  assert.equal(hitungSkorFeed({ skorEmosi: 0.9, wilsonScore: 0.8, publishedAt: '2026-11-15T12:00:00Z', sekarangMs: now }), 0.88);

  const db = [{
    poem_id: 'p1', title: 'Pelukan Senja', author_name: 'Alya', excerpt: 'Kasih lembut...',
    status: 'published', dominant: 'cinta', model: 'lexicon-v1',
    poem_scores: { senang: 0.1, sedih: 0.05, cinta: 0.85, marah: 0.0, takut: 0.0 },
    lines: [], wilson_score: 0.8, published_at: '2026-11-15T12:00:00Z',
  }];
  const repo = { ambilSemuaPuisiTerbit: async () => db, ambilEmosiPuisi: async (id) => db.find((x) => x.poem_id === id) || null };
  const indeks = buatIndeksFeed(buatFakeRedis());
  await indeks.bangunUlangSemua(db, now);

  const server = buatAppHttp({ repo, indeks });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const res = await fetch(`${baseUrl}/api/feed/mood/sedih?mode=menghibur&page=1`);
    assert.equal(res.headers.get('cache-control'), 'public, max-age=3');
    const body = await res.json();
    assert.equal(body.items.length, 1);
    assert.equal(body.items[0].target_emotion, 'cinta');

    const { handler } = buatHandlerEvent({ indeks });
    await handler({ event_type: 'poem.hidden', aggregate_id: 'p1', payload: { poem_id: 'p1' } }, {
      tx: { query: async (sql) => { if (sql.startsWith('INSERT')) db[0].status = 'hidden'; return { rows: db }; } },
    });

    const bodyAfter = await (await fetch(`${baseUrl}/api/feed/mood/sedih?mode=menghibur&page=1`)).json();
    assert.equal(bodyAfter.items.length, 0);
  } finally {
    server.close();
  }
});
