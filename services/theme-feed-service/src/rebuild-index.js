import { MongoClient } from 'mongodb';
import { createClient } from 'redis';
import { buatIndeksTema } from './indeks-tema.js';

export async function bangunUlangDariSumber({ mongoClient, mongoDbName = 'theme-db', redis }) {
  const indeks = buatIndeksTema(redis);
  const db = mongoClient.db(mongoDbName);
  const rows = await db
    .collection('poem_themes')
    .find({})
    .sort({ version: -1 })
    .toArray();

  const terbaruPerPuisi = new Map();
  for (const row of rows) {
    const id = String(row.poem_id || '');
    if (!id || terbaruPerPuisi.has(id)) continue;
    terbaruPerPuisi.set(id, {
      poem_id: id,
      title: row.title || 'Tanpa Judul',
      author_id: row.author_id || '',
      author_name: row.author_name || 'Penyair PuisiApp',
      excerpt: row.excerpt || '',
      status: 'published',
      themes: Array.isArray(row.themes) ? row.themes : [row.primary || 'lainnya'],
      theme_scores: row.scores || {},
      wilson_score: Number(row.wilson_score || 0),
      published_at: row.analyzed_at || new Date().toISOString(),
    });
  }

  return indeks.bangunUlangSemua([...terbaruPerPuisi.values()]);
}

const isMain = process.argv[1]?.endsWith('rebuild-index.js');
if (isMain) {
  const mongoUrl = process.env.MONGO_URL || 'mongodb://localhost:27017';
  const mongoDbName = process.env.MONGO_DB || 'theme-db';
  const redisUrl =
    process.env.REDIS_URL ||
    `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || '6379'}`;

  const mongoClient = new MongoClient(mongoUrl);
  const redis = createClient({ url: redisUrl });
  await mongoClient.connect();
  await redis.connect();
  try {
    const jumlah = await bangunUlangDariSumber({ mongoClient, mongoDbName, redis });
    console.log(JSON.stringify({ rebuilt: jumlah, index_prefix: 'feed:theme:' }));
  } finally {
    await redis.quit();
    await mongoClient.close();
  }
}
