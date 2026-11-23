import pg from 'pg';
import { createClient } from 'redis';
import { buatRepoPg } from './http.js';
import { buatIndeksFeed } from './indeks-redis.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const redisUrl =
  process.env.REDIS_URL ||
  `redis://:${encodeURIComponent(process.env.REDIS_PASSWORD || '')}@${process.env.REDIS_HOST || '127.0.0.1'}:${process.env.REDIS_PORT || 6379}`;
const redis = createClient({ url: redisUrl });
await redis.connect();

const repo = buatRepoPg(pool);
const indeks = buatIndeksFeed(redis);
const jumlah = await indeks.bangunUlangSemua(await repo.ambilSemuaPuisiTerbit());
console.log(JSON.stringify({ status: 'ok', indexed_poems: jumlah }));

await redis.quit();
await pool.end();
