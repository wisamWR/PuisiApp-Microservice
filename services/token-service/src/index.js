/**
 * token-service (T1.2).
 *   GET  /internal/auth/verify  dipanggil gateway lewat auth_request. 200 + X-User-Id/X-User-Role, atau 401.
 *   POST /internal/tokens       dipanggil login-service untuk menerbitkan access token.
 * Kedua rute /internal/* TIDAK diteruskan gateway (tidak ada di routes/), jadi hanya bisa dijangkau dari jaringan app.
 */
import http from 'node:http';
import { buatLogger } from '@puisiapp/events';
import { createClient } from 'redis';
import { buatPenerbitToken, MASA_BERLAKU_BAWAAN } from './token.js';
import { buatPenyimpanRefresh, MASA_REFRESH_DETIK } from './refresh.js';
import { buatDaftarCabut } from './cabut.js';
import { buatMetrikHttp } from './metrics.js';

const log = buatLogger();

if (!process.env.REDIS_URL) throw new Error('REDIS_URL belum diisi');
const redis = createClient({ url: process.env.REDIS_URL });
redis.on('error', (err) => log.error('redis galat', { pesan: err.message }));
await redis.connect();
const penyimpan = buatPenyimpanRefresh(redis);
const daftarCabut = buatDaftarCabut(redis);

function cookieRefresh(token) {
  return `refresh_token=${encodeURIComponent(token)}; Path=/api/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=${MASA_REFRESH_DETIK}`;
}
function cookieAkses(token) {
  return `access_token=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=900`;
}
function cookieHapus() {
  return [
    'access_token=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
    'refresh_token=; Path=/api/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
  ];
}
const PORT = Number(process.env.PORT) || 8080;
const metrik = buatMetrikHttp('token-service');
const MAKS_BODY = 4 * 1024;

// Kunci tetap dari .env. Kalau belum diisi (masih placeholder atau kosong), pakai kunci sementara
// dan beri peringatan, supaya layanan tidak crash. Kunci sementara HANYA untuk pengembangan:
// tiap replika punya kunci sendiri, jadi jalankan `bash infra/jwt-keys.sh` untuk kunci tetap.
const PLACEHOLDER = (v) => !v || v.startsWith('isi-');

let kunciPrivat = process.env.JWT_PRIVATE_KEY_PEM;
let kunciPublik = process.env.JWT_PUBLIC_KEY_PEM;

if (PLACEHOLDER(kunciPrivat) || PLACEHOLDER(kunciPublik)) {
  const { generateKeyPair, exportPKCS8, exportSPKI } = await import('jose');
  const pasangan = await generateKeyPair('RS256', { extractable: true });
  kunciPrivat = await exportPKCS8(pasangan.privateKey);
  kunciPublik = await exportSPKI(pasangan.publicKey);
  log.warn('kunci JWT belum diisi: memakai kunci sementara (dev). Jalankan: bash infra/jwt-keys.sh');
}

const ambilPem = (nilai) => nilai.replace(/\\n/g, '\n');

const penerbit = await buatPenerbitToken({
  privateKeyPem: ambilPem(kunciPrivat),
  publicKeyPem: ambilPem(kunciPublik),
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
  const mulai = performance.now();
  let rute = 'tidak_dikenal';
  res.once('finish', () => metrik.catatRequest(req.method, rute, res.statusCode, mulai));
  const url = new URL(req.url, 'http://local');


  if (req.method === 'GET' && url.pathname === '/health') {
    rute = '/health';
    return kirimJson(res, 200, { status: 'ok' });
  }

  if (req.method === 'GET' && url.pathname === '/metrics') {
    rute = '/metrics';
    return metrik.layaniMetrics(res);
  }

  // Verifikasi untuk gateway. Token hanya dibaca dari cookie access_token.
  if (req.method === 'GET' && url.pathname === '/internal/auth/verify') {
    rute = '/internal/auth/verify';
    const token = ambilCookie(req.headers.cookie, 'access_token');
    const klaim = token ? await penerbit.verify(token) : null;
    if (!klaim || (await daftarCabut.sudahDicabut(klaim.jti))) {
      return kirimJson(res, 401, { error: 'unauthorized' });
    }
    return kirimJson(res, 200, undefined, {
      'X-User-Id': klaim.sub,
      'X-User-Role': klaim.role,
    });
  }

  // Cek peran admin untuk gateway (T1.7). 200 jika admin, 403 jika bukan, 401 jika tidak valid.
  if (req.method === 'GET' && url.pathname === '/internal/auth/admin') {
    rute = '/internal/auth/admin';
    const token = ambilCookie(req.headers.cookie, 'access_token');
    const klaim = token ? await penerbit.verify(token) : null;
    if (!klaim || (await daftarCabut.sudahDicabut(klaim.jti))) {
      return kirimJson(res, 401, { error: 'unauthorized' });
    }
    if (klaim.role !== 'admin') return kirimJson(res, 403, { error: 'forbidden' });
    return kirimJson(res, 200, undefined, { 'X-User-Id': klaim.sub, 'X-User-Role': klaim.role });
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
      const refreshToken = await penyimpan.terbitkan({ sub: body.sub, username: body.username, role: body.role });
      return kirimJson(res, 200, { access_token: accessToken, refresh_token: refreshToken, token_type: 'Bearer' });
    } catch (err) {
      return kirimJson(res, 400, { error: err.message });
    }
  }

  // Logout (T1.4): cabut access token (daftar cabut), hapus refresh token, hapus cookie. Selalu 204.
  // Publik di gateway, jadi token yang sudah kedaluwarsa tetap bisa keluar.
  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    const access = ambilCookie(req.headers.cookie, 'access_token');
    const refresh = ambilCookie(req.headers.cookie, 'refresh_token');
    const klaim = access ? await penerbit.verify(access) : null;
    if (klaim) await daftarCabut.tambah(klaim.jti, klaim.exp);
    if (refresh) await penyimpan.putar(refresh);
    res.writeHead(204, { 'Set-Cookie': cookieHapus() });
    return res.end();
  }

  // Refresh (T1.2 butir 5): token lama dirotasi, token yang sudah dipakai ditolak.
  if (req.method === 'POST' && url.pathname === '/api/auth/refresh') {
    const refresh = ambilCookie(req.headers.cookie, 'refresh_token');
    const klaim = await penyimpan.putar(refresh);
    if (!klaim) return kirimJson(res, 401, { error: 'refresh token tidak valid' }, { 'Set-Cookie': cookieHapus() });
    const accessToken = await penerbit.sign(klaim);
    const refreshBaru = await penyimpan.terbitkan(klaim);
    return kirimJson(res, 200, { username: klaim.username, role: klaim.role }, {
      'Set-Cookie': [cookieAkses(accessToken), cookieRefresh(refreshBaru)],
    });
  }

  return kirimJson(res, 404, { error: 'tidak ditemukan' });
});

server.listen(PORT, () => log.info('token-service siap', { port: PORT }));

async function berhenti() {
  server.close();
  await redis.quit().catch(() => {});
  process.exit(0);
}
process.on('SIGTERM', berhenti);
process.on('SIGINT', berhenti);
