/**
 * token-service (T1.2).
 *   GET  /internal/auth/verify  dipanggil gateway lewat auth_request. 200 + X-User-Id/X-User-Role, atau 401.
 *   POST /internal/tokens       dipanggil login-service untuk menerbitkan access token.
 * Kedua rute /internal/* TIDAK diteruskan gateway (tidak ada di routes/), jadi hanya bisa dijangkau dari jaringan app.
 */
import http from 'node:http';
import { buatLogger } from '@puisiapp/events';
import { buatPenerbitToken, MASA_BERLAKU_BAWAAN } from './token.js';

const log = buatLogger();
const PORT = Number(process.env.PORT) || 8080;
const MAKS_BODY = 4 * 1024;

const ambilPem = (nama) => {
  const v = process.env[nama];
  if (!v) throw new Error(`${nama} belum diisi`);
  // Di .env, PEM ditulis satu baris dengan \n literal.
  return v.replace(/\\n/g, '\n');
};

const penerbit = await buatPenerbitToken({
  privateKeyPem: ambilPem('JWT_PRIVATE_KEY_PEM'),
  publicKeyPem: ambilPem('JWT_PUBLIC_KEY_PEM'),
  issuer: process.env.JWT_ISSUER || 'puisiapp-auth',
  audience: process.env.JWT_AUDIENCE || 'puisiapp-web',
  masaBerlaku: process.env.ACCESS_TOKEN_TTL || MASA_BERLAKU_BAWAAN,
});

function ambilCookie(header, nama) {
  if (!header) return null;
  for (const bagian of header.split(';')) {
    const [k, ...v] = bagian.trim().split('=');
    if (k === nama) return decodeURIComponent(v.join('='));
  }
  return null;
}

function kirimJson(res, status, body, header = {}) {
  const teks = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(teks),
    ...header,
  });
  res.end(teks);
}

function bacaBody(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const bagian = [];
    req.on('data', (c) => {
      total += c.length;
      if (total > MAKS_BODY) {
        reject(new Error('body terlalu besar'));
        req.destroy();
        return;
      }
      bagian.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(bagian).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');

  if (req.method === 'GET' && url.pathname === '/health') {
    return kirimJson(res, 200, { status: 'ok' });
  }

  // Verifikasi untuk gateway. Token hanya dibaca dari cookie access_token.
  if (req.method === 'GET' && url.pathname === '/internal/auth/verify') {
    const token = ambilCookie(req.headers.cookie, 'access_token');
    const klaim = token ? await penerbit.verify(token) : null;
    if (!klaim) return kirimJson(res, 401, { error: 'unauthorized' });
    return kirimJson(res, 200, undefined, {
      'X-User-Id': klaim.sub,
      'X-User-Role': klaim.role,
    });
  }

  // Penerbitan token untuk login-service. Tidak diteruskan gateway.
  if (req.method === 'POST' && url.pathname === '/internal/tokens') {
    let body;
    try {
      body = JSON.parse((await bacaBody(req)) || '{}');
    } catch {
      return kirimJson(res, 400, { error: 'JSON tidak valid' });
    }
    if (!body.sub || !body.username || !body.role) {
      return kirimJson(res, 400, { error: 'sub, username, dan role wajib diisi' });
    }
    try {
      const accessToken = await penerbit.sign({ sub: body.sub, username: body.username, role: body.role });
      return kirimJson(res, 200, { access_token: accessToken, token_type: 'Bearer' });
    } catch (err) {
      return kirimJson(res, 400, { error: err.message });
    }
  }

  return kirimJson(res, 404, { error: 'tidak ditemukan' });
});

server.listen(PORT, () => log.info('token-service siap', { port: PORT }));

function berhenti() {
  server.close(() => process.exit(0));
}
process.on('SIGTERM', berhenti);
process.on('SIGINT', berhenti);
