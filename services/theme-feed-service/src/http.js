import http from 'node:http';
import { URL } from 'node:url';
import { DAFTAR_TEMA } from './indeks-tema.js';

function kirimJson(res, status, data) {
  const payload = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

export function buatServerHttp({ indeksTema, versi = '1.0.0' }) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      return kirimJson(res, 200, { status: 'ok', service: 'theme-feed', version: versi });
    }

    if (req.method === 'GET' && url.pathname === '/api/themes/summary') {
      const summary = await indeksTema.ringkasanTema();
      return kirimJson(res, 200, summary);
    }

    const matchFeed = url.pathname.match(/^\/api\/feed\/theme\/([^/]+)$/);
    if (req.method === 'GET' && matchFeed) {
      const tema = decodeURIComponent(matchFeed[1]).toLowerCase();
      const page = Math.max(1, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1);
      const limit = Math.min(
        50,
        Math.max(1, Number.parseInt(url.searchParams.get('limit') || '10', 10) || 10),
      );

      if (!DAFTAR_TEMA.includes(tema)) {
        return kirimJson(res, 400, { error: 'invalid_theme', allowed: DAFTAR_TEMA });
      }

      const hasil = await indeksTema.ambilFeed(tema, { page, limit });
      return kirimJson(res, 200, {
        theme: tema,
        page,
        limit,
        total: hasil?.total ?? 0,
        items: hasil?.items ?? [],
      });
    }

    kirimJson(res, 404, { error: 'not_found' });
  });
}
