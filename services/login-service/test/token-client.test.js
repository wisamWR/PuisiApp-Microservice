import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buatKlienToken,
  hitungBackoffJitter,
  TokenServiceUnavailableError,
} from '../src/token-client.js';

const akunUji = { id: 'u-1', username: 'penyair', role: 'user' };

test('retry dengan backoff + jitter berhasil jika percobaan berikutnya sukses', async () => {
  let panggilan = 0;
  const jedaTercatat = [];
  const klien = buatKlienToken({
    baseUrl: 'http://token-service:8080',
    maxRetries: 2,
    baseDelayMs: 100,
    maxDelayMs: 500,
    randomFn: () => 0.5,
    sleepFn: async (ms) => {
      jedaTercatat.push(ms);
    },
    fetchFn: async () => {
      panggilan += 1;
      if (panggilan < 3) {
        return { ok: false, status: 503, json: async () => ({}) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'acc-1', refresh_token: 'ref-1' }),
      };
    },
  });

  const hasil = await klien.mintaToken(akunUji);
  assert.deepEqual(hasil, { access_token: 'acc-1', refresh_token: 'ref-1' });
  assert.equal(panggilan, 3);
  assert.equal(jedaTercatat.length, 2);
  assert.ok(jedaTercatat[1] > jedaTercatat[0]);
  assert.equal(klien.getState(), 'CLOSED');
});

test('circuit breaker berpindah CLOSED -> OPEN -> HALF_OPEN -> CLOSED dan fail-closed 503 saat OPEN', async () => {
  let waktu = 1000;
  let modeGagal = true;
  let panggilanFetch = 0;

  const klien = buatKlienToken({
    baseUrl: 'http://token-service:8080',
    maxRetries: 0,
    failureThreshold: 2,
    openDurationMs: 5000,
    nowFn: () => waktu,
    sleepFn: async () => {},
    fetchFn: async () => {
      panggilanFetch += 1;
      if (modeGagal) {
        const err = new Error('timeout');
        err.name = 'TimeoutError';
        throw err;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'acc-ok', refresh_token: 'ref-ok' }),
      };
    },
  });

  // 2 kegagalan memicu OPEN
  for (let i = 0; i < 2; i += 1) {
    await assert.rejects(
      () => klien.mintaToken(akunUji),
      (err) => err instanceof TokenServiceUnavailableError && err.statusCode === 503
    );
  }
  assert.equal(klien.getState(), 'OPEN');
  const jumlahSebelumOpen = panggilanFetch;

  // Saat OPEN, permintaan langsung gagal 503 tanpa memanggil fetch lagi
  await assert.rejects(
    () => klien.mintaToken(akunUji),
    (err) => err instanceof TokenServiceUnavailableError && err.statusCode === 503 && err.reason === 'circuit_open'
  );
  assert.equal(panggilanFetch, jumlahSebelumOpen);

  // Setelah melewati openDurationMs, masuk HALF_OPEN dan pulih ke CLOSED saat sukses
  waktu += 5000;
  assert.equal(klien.getState(), 'HALF_OPEN');
  modeGagal = false;
  const sukses = await klien.mintaToken(akunUji);
  assert.equal(sukses.access_token, 'acc-ok');
  assert.equal(klien.getState(), 'CLOSED');
});

test('hitungBackoffJitter menghasilkan nilai positif yang meningkat secara eksponensial', () => {
  const d1 = hitungBackoffJitter(1, { baseDelayMs: 100, maxDelayMs: 2000, random: () => 0.25 });
  const d2 = hitungBackoffJitter(2, { baseDelayMs: 100, maxDelayMs: 2000, random: () => 0.25 });
  const d3 = hitungBackoffJitter(3, { baseDelayMs: 100, maxDelayMs: 2000, random: () => 0.25 });
  assert.ok(d1 > 0 && d2 > d1 && d3 > d2);
});

test('token-service membalas 400 sebanyak N kali tidak membuka circuit breaker dan tidak membalas 503', async () => {
  const failureThreshold = 3;
  let panggilan = 0;

  const klien = buatKlienToken({
    baseUrl: 'http://token-service:8080',
    maxRetries: 2,
    failureThreshold,
    sleepFn: async () => {},
    fetchFn: async () => {
      panggilan += 1;
      return {
        ok: false,
        status: 400,
        json: async () => ({ error: 'bad request' }),
      };
    },
  });

  for (let i = 0; i < failureThreshold + 2; i += 1) {
    await assert.rejects(
      () => klien.mintaToken(akunUji),
      (err) => !(err instanceof TokenServiceUnavailableError) && err?.status === 400
    );
  }

  assert.equal(panggilan, failureThreshold + 2);
  assert.equal(klien.getState(), 'CLOSED');
});
