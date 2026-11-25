#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buatPembatasLaju } from './rate-limit.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA_DIR = path.join(ROOT, 'tools', 'seed-data');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');
const POEMS_FILE = path.join(DATA_DIR, 'poems.json');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

const URLS_DEFAULT = {
  register: 'http://register-service:8080',
  login: 'http://login-service:8080',
  create: 'http://poem-create-service:8080',
  delete: 'http://poem-delete-service:8080',
};

const TEMPLATE_ID = 'latar2';

function bacaJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function simpanState(state) {
  const temporary = `${STATE_FILE}.tmp`;
  writeFileSync(temporary, JSON.stringify(state, null, 2), 'utf8');
  renameSync(temporary, STATE_FILE);
}

function parseArgs() {
  const options = {
    count: 50,
    rate: 10,
    dryRun: false,
    reset: false,
    ...URLS_DEFAULT,
  };

  const args = process.argv.slice(2);
  const urlOptions = {
    '--register-url': 'register',
    '--login-url': 'login',
    '--poem-create-url': 'create',
    '--poem-delete-url': 'delete',
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help') {
      console.log(`
Penggunaan:
  node tools/seed/index.js [opsi]

Opsi:
  --count <angka>          Jumlah puisi (default: 50)
  --rate <angka>           Request per detik (default: 10)
  --register-url <url>     URL Register Service
  --login-url <url>        URL Login Service
  --poem-create-url <url>  URL Poem Create Service
  --poem-delete-url <url>  URL Poem Delete Service
  --dry-run                Validasi lokal tanpa request API
  --reset                  Menghapus puisi seed yang tercatat
  --help                   Menampilkan bantuan
`);
      process.exit(0);
    }

    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    if (arg === '--reset') {
      options.reset = true;
      continue;
    }

    if (['--count', '--rate', ...Object.keys(urlOptions)].includes(arg)) {
      const value = args[++i];
      if (!value || value.startsWith('--')) {
        throw new Error(`Nilai untuk ${arg} belum diberikan.`);
      }

      if (urlOptions[arg]) {
        options[urlOptions[arg]] = value.replace(/\/+$/, '');
      } else {
        const number = Number(value);
        if (!Number.isFinite(number) || number <= 0) {
          throw new Error(`${arg} harus berupa angka positif.`);
        }
        if (arg === '--count' && !Number.isInteger(number)) {
          throw new Error('--count harus berupa bilangan bulat.');
        }
        options[arg === '--count' ? 'count' : 'rate'] = number;
      }
      continue;
    }

    throw new Error(`Opsi tidak dikenal: ${arg}`);
  }

  return options;
}

function validasiData(accounts, poems, count) {
  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new Error('accounts.json harus berisi daftar akun.');
  }
  if (!Array.isArray(poems) || poems.length < count) {
    throw new Error(`poems.json harus memiliki minimal ${count} puisi.`);
  }

  const usernames = new Set();
  for (const account of accounts) {
    for (const field of ['username', 'email', 'password', 'display_name']) {
      if (typeof account[field] !== 'string' || !account[field].trim()) {
        throw new Error(`Data akun ${account.username || '(tanpa username)'} tidak valid: ${field}.`);
      }
    }
    if (usernames.has(account.username)) {
      throw new Error(`Username duplikat: ${account.username}`);
    }
    usernames.add(account.username);
  }

  const emotions = ['senang', 'sedih', 'cinta', 'marah', 'takut'];
  const themes = ['rindu', 'kesepian', 'alam', 'perjuangan', 'keluarga', 'religius', 'lainnya'];
  const emotionCounts = Object.fromEntries(emotions.map((item) => [item, 0]));

  for (const poem of poems.slice(0, count)) {
    if (!poem.title || !poem.body || !poem.emotion || !poem.theme) {
      throw new Error(`Data puisi tidak lengkap: ${poem.title || '(tanpa judul)'}`);
    }
    if (poem.title.length > 150) throw new Error(`Judul terlalu panjang: ${poem.title}`);
    if (poem.body.length > 8000) throw new Error(`Isi puisi terlalu panjang: ${poem.title}`);
    if (!emotions.includes(poem.emotion)) throw new Error(`Emosi tidak valid: ${poem.emotion}`);
    if (!themes.includes(poem.theme)) throw new Error(`Tema tidak valid: ${poem.theme}`);

    const stanzas = poem.body.split(/\n\s*\n/).filter((item) => item.trim());
    if (stanzas.length === 0 || stanzas[0].length > 280) {
      throw new Error(`Bait kutipan tidak valid: ${poem.title}`);
    }
    emotionCounts[poem.emotion]++;
  }

  return emotionCounts;
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(15000),
  });

  const text = await response.text();
  let body = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { message: text };
    }
  }
  return { response, body };
}

async function daftarAkun(account, registerUrl) {
  const { response, body } = await request(
    `${registerUrl}/api/auth/register`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(account),
    },
  );

  if (response.status === 201) {
    console.log(`Akun terdaftar: ${account.username}`);
    return body.id;
  }

  if (response.status === 409) {
    console.log(`Akun sudah ada, akan login: ${account.username}`);
    return null;
  }

  throw new Error(
    `Registrasi ${account.username} gagal (${response.status}): ${JSON.stringify(body)}`,
  );
}

function ambilIdentitasDariCookie(cookies) {
  const accessCookie = cookies
    .map((item) => item.split(';')[0])
    .find((item) => item.startsWith('access_token='));

  if (!accessCookie) {
    throw new Error('Cookie access_token tidak ditemukan.');
  }

  const token = decodeURIComponent(accessCookie.slice('access_token='.length));
  const bagian = token.split('.');
  if (bagian.length !== 3) throw new Error('Format JWT tidak valid.');

  const payload = JSON.parse(Buffer.from(bagian[1], 'base64url').toString('utf8'));
  if (typeof payload.sub !== 'string' || !payload.sub) {
    throw new Error('JWT tidak memiliki klaim sub sebagai ID pengguna.');
  }

  return { cookie: cookies.map((item) => item.split(';')[0]).join('; '), userId: payload.sub };
}

async function login(account, loginUrl) {
  let lastError;

  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const { response, body } = await request(
        `${loginUrl}/api/auth/login`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            username: account.username,
            password: account.password,
          }),
        },
      );

      if (response.ok) {
        const cookies = typeof response.headers.getSetCookie === 'function'
          ? response.headers.getSetCookie()
          : [response.headers.get('set-cookie')].filter(Boolean);

        const identity = ambilIdentitasDariCookie(cookies);
        console.log(`Login berhasil: ${account.username}`);
        return identity;
      }

      lastError = new Error(
        `Login ${account.username} gagal (${response.status}): ${JSON.stringify(body)}`,
      );
      if (response.status !== 401 || attempt === 4) break;
    } catch (error) {
      lastError = error;
      if (attempt === 4) break;
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  throw lastError;
}

function ambilIdPuisi(body, location, createUrl) {
  const id = body?.id ?? body?.poem_id ?? body?.data?.id ?? body?.data?.poem_id;
  if (id) return String(id);

  if (location) {
    const pathname = new URL(location, createUrl).pathname;
    const match = pathname.match(/\/api\/poems\/([^/]+)$/);
    if (match) return decodeURIComponent(match[1]);
  }

  throw new Error('ID puisi tidak ditemukan pada respons API.');
}

async function kirimPuisi(poem, index, account, identity, createUrl, limiter) {
  const payload = {
    title: poem.title,
    body: poem.body,
    quote_stanza: 0,
    template_id: TEMPLATE_ID,
    category: 'puisi',
    keywords: [poem.theme],
  };

  let result;
  await limiter({
    terbitkan: async () => {
      result = await request(`${createUrl}/api/poems`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-user-id': identity.userId,
          // Kunci tetap per puisi: seed yang diulang mendapat puisi yang sama, bukan duplikat.
          'Idempotency-Key': `seed-t010-${String(index + 1).padStart(3, '0')}`,
        },
        body: JSON.stringify(payload),
      });

      if (result.response.status !== 202) {
        throw new Error(
          `Gagal membuat puisi "${poem.title}" (${result.response.status}): ${JSON.stringify(result.body)}`,
        );
      }
    },
  }, {});

  const id = ambilIdPuisi(
    result.body,
    result.response.headers.get('location'),
    createUrl,
  );

  console.log(`Puisi dibuat: ${poem.title} (${account.username})`);
  return id;
}

async function resetSeed(accounts, loginUrl, deleteUrl, state) {
  if (!existsSync(STATE_FILE)) {
    throw new Error('state.json tidak ditemukan. Tidak ada data seed yang dapat di-reset.');
  }

  const limiter = buatPembatasLaju(10);
  let deleted = 0;

  for (const account of accounts) {
    const ids = state.poems.filter((item) => item.username === account.username);
    if (ids.length === 0) continue;

    const identity = await login(account, loginUrl);

    for (const item of ids) {
      let result;
      await limiter({
        terbitkan: async () => {
          result = await request(
            `${deleteUrl}/api/poems/${encodeURIComponent(item.id)}`,
            {
              method: 'DELETE',
              headers: { 'x-user-id': identity.userId },
            },
          );
        },
      }, {});

      if (result.response.status === 202 || result.response.status === 404) {
        state.poems = state.poems.filter((entry) => entry.id !== item.id);
        simpanState(state);
        deleted++;
        console.log(`Reset puisi: ${item.id}`);
      } else {
        throw new Error(
          `Gagal menghapus ${item.id} (${result.response.status}): ${JSON.stringify(result.body)}`,
        );
      }
    }
  }

  console.log(`Reset selesai. Puisi dihapus/tidak ditemukan: ${deleted}`);
}

async function main() {
  const options = parseArgs();
  const accounts = bacaJson(ACCOUNTS_FILE);
  const poems = bacaJson(POEMS_FILE);
  const selectedPoems = poems.slice(0, options.count);
  const emotionCounts = validasiData(accounts, poems, options.count);

  if (options.dryRun) {
    console.log('DRY RUN BERHASIL: tidak ada request API yang dikirim.');
    console.log(`Akun valid: ${accounts.length}`);
    console.log(`Puisi valid: ${selectedPoems.length}`);
    for (const [emotion, count] of Object.entries(emotionCounts)) {
      console.log(`${emotion}: ${count} puisi`);
    }
    console.log(`Template: ${TEMPLATE_ID}`);
    console.log(`Register: ${options.register}`);
    console.log(`Login: ${options.login}`);
    console.log(`Poem Create: ${options.create}`);
    console.log(`Poem Delete: ${options.delete}`);
    return;
  }

  const state = existsSync(STATE_FILE)
    ? bacaJson(STATE_FILE)
    : { poems: [] };

  if (!Array.isArray(state.poems)) {
    throw new Error('Format state.json tidak valid.');
  }

  if (options.reset) {
    await resetSeed(accounts, options.login, options.delete, state);
    return;
  }

  const limiter = buatPembatasLaju(options.rate);
  const registeredIds = new Map();

  for (const account of accounts) {
    const id = await daftarAkun(account, options.register);
    if (id) registeredIds.set(account.username, id);
  }

  const identities = new Map();
  for (const account of accounts) {
    const identity = await login(account, options.login);
    const registeredId = registeredIds.get(account.username);

    if (registeredId && registeredId !== identity.userId) {
      throw new Error(`ID registrasi dan ID JWT berbeda untuk ${account.username}.`);
    }

    identities.set(account.username, identity);
  }

  for (let i = 0; i < selectedPoems.length; i++) {
    const poem = selectedPoems[i];
    const account = accounts[i % accounts.length];
    const identity = identities.get(account.username);

    const id = await kirimPuisi(
      poem,
      i,
      account,
      identity,
      options.create,
      limiter,
    );

    if (!state.poems.some((item) => item.id === id)) {
      state.poems.push({
        id,
        username: account.username,
        title: poem.title,
      });
      simpanState(state);
    }
  }

  console.log(`Seed selesai: ${selectedPoems.length} puisi berhasil dikirim melalui API.`);
  console.log(`Akun: ${accounts.length} | Puisi: ${selectedPoems.length}`);
  console.log(`Rate maksimum: ${options.rate} request/detik`);
  console.log(`State tersimpan: ${STATE_FILE}`);
}

main().catch((error) => {
  console.error('Seed gagal:', error.message);
  process.exitCode = 1;
});
