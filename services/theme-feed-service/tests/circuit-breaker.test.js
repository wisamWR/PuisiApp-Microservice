import assert from 'node:assert/strict';
import test from 'node:test';
import { CircuitBreaker } from '../src/circuit-breaker.js';
import { buatServerHttp } from '../src/http.js';

test('Circuit Breaker berpindah CLOSED -> OPEN -> HALF-OPEN -> CLOSED dan mengaktifkan fallback', async () => {
  let waktuSekarang = 1_000;
  const cb = new CircuitBreaker({
    nama: 'redis-test',
    errorThreshold: 3,
    resetTimeoutMs: 5_000,
    sekarangFn: () => waktuSekarang,
  });

  let redisMati = true;
  const indeksSimulasi = {
    async ambilFeed() {
      if (redisMati) throw new Error('ECONNREFUSED Redis');
      return { total: 1, items: [{ poem_id: 'p-ok', title: 'Pulih' }] };
    },
    async ringkasanTema() {
      return { total_poems: 0, themes: [] };
    },
  };

  const server = buatServerHttp({ indeksTema: indeksSimulasi, circuitBreaker: cb });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();

  try {
    // 1. Status awal CLOSED
    assert.equal(cb.getStatus().state, 'CLOSED');

    // 2. Gagal 3x (mencapai errorThreshold) -> OPEN + Fallback aktif
    for (let i = 0; i < 3; i++) {
      const res = await fetch(`http://127.0.0.1:${port}/api/feed/theme/alam`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.degraded, true);
    }
    assert.equal(cb.getStatus().state, 'OPEN');

    // 3. Lewati resetTimeoutMs -> HALF-OPEN
    waktuSekarang += 5_500;
    assert.equal(cb.getStatus().state, 'HALF-OPEN');

    // 4. Redis pulih -> request berhasil -> kembali CLOSED
    redisMati = false;
    const resPulih = await fetch(`http://127.0.0.1:${port}/api/feed/theme/alam`);
    const bodyPulih = await resPulih.json();
    assert.equal(bodyPulih.degraded, false);
    assert.equal(bodyPulih.total, 1);
    assert.equal(cb.getStatus().state, 'CLOSED');
  } finally {
    server.close();
  }
});
