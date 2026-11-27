import http from 'node:http';
import { DAFTAR_EMOSI, DAFTAR_MODE } from './indeks-redis.js';
import { buatMetrikHttp } from './metrics.js';

function kirimJson(res, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

export function buatRepoPg(pool) {
  return {
    async ambilSemuaPuisiTerbit() {
      const { rows } = await pool.query(
        `SELECT poem_id, version, title, author_id, author_name, excerpt, status, dominant, model, poem_scores, wilson_score, published_at
         FROM mood_poems WHERE status = 'published' AND dominant IS NOT NULL`,
      );
      return rows;
    },
    async ambilEmosiPuisi(poemId) {
      const { rows } = await pool.query(
        `SELECT poem_id, version, title, status, dominant, model, poem_scores, lines, updated_at
         FROM mood_poems WHERE poem_id = $1`,
        [poemId],
      );
      return rows[0] || null;
    },
  };
}

export function buatAppHttp({ repo, indeks, serviceName = 'mood-feed-service', metrik = buatMetrikHttp(serviceName) }) {
  return http.createServer(async (req, res) => {
    const mulai = performance.now();
    let rute = 'tidak_dikenal';
    res.once('finish', () => metrik.catatRequest(req.method, rute, res.statusCode, mulai));
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      const path = url.pathname;
      if (req.method === 'GET' && path === '/health') {
        rute = '/health';
        return kirimJson(res, 200, { status: 'ok', service: serviceName });
      }
      if (req.method === 'GET' && path === '/metrics') {
        rute = '/metrics';
        return metrik.layaniMetrics(res);
      }
      const matchFeed = path.match(/^\/api\/feed\/mood\/([^/]+)$/);
      if (req.method === 'GET' && matchFeed) {
        rute = '/api/feed/mood/:mood';
        const emosi = decodeURIComponent(matchFeed[1]).toLowerCase().trim();
        const mode = (url.searchParams.get('mode') || 'senada').toLowerCase().trim();
        const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 20));
        const page = Math.max(1, Number(url.searchParams.get('page')) || 1);

        if (!DAFTAR_EMOSI.includes(emosi)) {
          return kirimJson(res, 400, { error: 'emosi_tidak_valid', message: `Pilihan emosi: ${DAFTAR_EMOSI.join(', ')}` });
        }
        if (!DAFTAR_MODE.includes(mode)) {
          return kirimJson(res, 400, { error: 'mode_tidak_valid', message: 'Pilihan mode harus senada atau menghibur' });
        }

        const hasil = await indeks.ambilFeed(emosi, mode, { page, limit });
        return kirimJson(
          res,
          200,
          {
            mood: emosi,
            mode,
            target_emotions: hasil.target_emotions,
            page,
            limit,
            total: hasil.total,
            has_more: page * limit < hasil.total,
            items: hasil.items,
          },
          { 'Cache-Control': 'public, max-age=3' },
        );
      }
      const matchEmosi = path.match(/^\/api\/emotions\/poems\/([^/]+)$/);
      if (req.method === 'GET' && matchEmosi) {
        rute = '/api/emotions/poems/:id';
        const data = await repo.ambilEmosiPuisi(decodeURIComponent(matchEmosi[1]).trim());
        if (!data || data.status === 'deleted' || data.status === 'hidden') {
          return kirimJson(res, 404, { error: 'not_found', message: 'Analisis emosi puisi tidak ditemukan' });
        }
        return kirimJson(res, 200, {
          poem_id: data.poem_id, version: data.version, dominant: data.dominant,
          model: data.model || 'lexicon-v1', poem_scores: data.poem_scores, lines: data.lines || [],
          disclaimer: 'Analisis ini menggambarkan nuansa dan suasana hati karya puisi secara leksikal, bukan penilaian kondisi psikologis pembaca maupun penulis.',
        });
      }
      rute = path;
      return kirimJson(res, 404, { error: 'not_found' });
    } catch (err) {
      return kirimJson(res, 500, { error: 'internal_error', message: err.message });
    }
  });
}
