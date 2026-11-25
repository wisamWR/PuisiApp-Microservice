import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { sesiUji } from '../src/sesi-uji.js';

/** Server tiruan layanan akun k1: login 401 dua kali (kredensial belum tiba), lalu 200. */
function serverAkun({ registerStatus = 201 } = {}) {
  let percobaanLogin = 0;
  const jwt = `x.${Buffer.from(JSON.stringify({ sub: 'akun-123', username: 'uji' })).toString('base64url')}.y`;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.url === '/api/auth/register') {
        const b = JSON.parse(body);
        assert.match(b.username, /^uji_[0-9a-f]{10}$/);
        assert.ok(b.password.length >= 8 && b.email.endsWith('@uji.local') && b.display_name);
        res.writeHead(registerStatus, { 'content-type': 'application/json' }).end('{"id":"akun-123"}');
      } else if (req.url === '/api/auth/login') {
        percobaanLogin++;
        if (percobaanLogin < 3) return res.writeHead(401).end('{"error":"username atau password salah"}');
        res.writeHead(200, {
          'set-cookie': [`access_token=${encodeURIComponent(jwt)}; Path=/; HttpOnly`, 'refresh_token=r; Path=/api/auth'],
        }).end('{}');
      } else res.writeHead(404).end();
    });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, url: `http://127.0.0.1:${server.address().port}`, login: () => percobaanLogin })));
}

test('daftar lalu login, mencoba ulang selama kredensial belum sampai ke login-service', async () => {
  const { server, url, login } = await serverAkun();
  try {
    const s = await sesiUji(url, { batasMs: 5000 });
    assert.equal(s.userId, 'akun-123');
    assert.match(s.cookie, /^access_token=x\./);
    assert.match(s.username, /^uji_/);
    assert.equal(login(), 3);
  } finally {
    server.close();
  }
});

test('layanan akun tidak ada (stub auth): cookie contoh dan stub-user', async () => {
  const { server, url } = await serverAkun({ registerStatus: 502 });
  try {
    assert.deepEqual(await sesiUji(url), { cookie: 'access_token=dev', userId: 'stub-user', username: null });
  } finally {
    server.close();
  }
});

test('COOKIE dari env didahulukan', async () => {
  process.env.COOKIE = 'access_token=abc';
  process.env.USER_ID = 'u-9';
  try {
    assert.deepEqual(await sesiUji('http://127.0.0.1:1'), { cookie: 'access_token=abc', userId: 'u-9', username: null });
  } finally {
    delete process.env.COOKIE;
    delete process.env.USER_ID;
  }
});
