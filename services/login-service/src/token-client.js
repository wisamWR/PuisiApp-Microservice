export class TokenServiceUnavailableError extends Error {
  constructor(message, { cause, reason = 'unavailable', retryAfterSec = 5 } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'TokenServiceUnavailableError';
    this.statusCode = 503;
    this.reason = reason;
    this.retryAfterSec = retryAfterSec;
  }
}

export function hitungBackoffJitter(percobaanKe, {
  baseDelayMs = 100,
  maxDelayMs = 1000,
  random = Math.random,
} = {}) {
  const exp = Math.min(maxDelayMs, baseDelayMs * (2 ** Math.max(0, percobaanKe - 1)));
  const jitter = random() * exp;
  return Math.round(exp * 0.5 + jitter * 0.5);
}

function adalahGalatSementara(err) {
  if (!err) return false;
  if (err.name === 'TimeoutError' || err.name === 'AbortError') return true;
  if (typeof err.status === 'number' && err.status >= 500) return true;
  const kode = err.code || err.cause?.code;
  return ['ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ETIMEDOUT', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT'].includes(kode);
}

export function buatKlienToken({
  baseUrl,
  fetchFn = fetch,
  sleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  randomFn = Math.random,
  nowFn = () => Date.now(),
  timeoutMs = Number(process.env.TOKEN_SERVICE_TIMEOUT_MS) || 1200,
  maxRetries = Number(process.env.TOKEN_SERVICE_MAX_RETRIES) || 2,
  baseDelayMs = Number(process.env.TOKEN_SERVICE_RETRY_BASE_MS) || 100,
  maxDelayMs = Number(process.env.TOKEN_SERVICE_RETRY_MAX_MS) || 800,
  failureThreshold = Number(process.env.TOKEN_SERVICE_CB_FAILURE_THRESHOLD) || 5,
  openDurationMs = Number(process.env.TOKEN_SERVICE_CB_OPEN_MS) || 10000,
  halfOpenMaxProbes = Number(process.env.TOKEN_SERVICE_CB_HALF_OPEN_PROBES) || 2,
  log = null,
} = {}) {
  const rootUrl = String(baseUrl || '').replace(/\/+$/, '');
  let state = 'CLOSED'; // CLOSED | OPEN | HALF_OPEN
  let consecutiveFailures = 0;
  let openedAtMs = 0;
  let halfOpenProbesInFlight = 0;

  function evaluasiState(sekarang) {
    if (state === 'OPEN' && sekarang - openedAtMs >= openDurationMs) {
      state = 'HALF_OPEN';
      halfOpenProbesInFlight = 0;
      log?.warn?.('circuit breaker token-service masuk HALF_OPEN');
    }
    return state;
  }

  function catatSukses() {
    consecutiveFailures = 0;
    if (state === 'HALF_OPEN') {
      state = 'CLOSED';
      halfOpenProbesInFlight = 0;
      log?.info?.('circuit breaker token-service pulih ke CLOSED');
    }
  }

  function catatGagalSementara(err, sekarang) {
    consecutiveFailures += 1;
    if (state === 'HALF_OPEN' || consecutiveFailures >= failureThreshold) {
      state = 'OPEN';
      openedAtMs = sekarang;
      halfOpenProbesInFlight = 0;
      log?.warn?.('circuit breaker token-service terbuka (OPEN)', {
        gagalBeruntun: consecutiveFailures,
        durasiMs: openDurationMs,
        alasan: err?.message,
      });
    }
  }

  async function kirimPercobaan(akun) {
    const signal = typeof AbortSignal?.timeout === 'function'
      ? AbortSignal.timeout(timeoutMs)
      : undefined;
    const res = await fetchFn(`${rootUrl}/internal/tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sub: akun.id,
        username: akun.username,
        role: akun.role,
      }),
      ...(signal ? { signal } : {}),
    });

    if (!res.ok) {
      const galat = new Error(`token-service membalas ${res.status}`);
      galat.status = res.status;
      throw galat;
    }

    const data = await res.json();
    if (!data?.access_token || !data?.refresh_token) {
      throw new Error('respons token-service tidak lengkap');
    }
    return { access_token: data.access_token, refresh_token: data.refresh_token };
  }

  async function mintaToken(akun) {
    const sekarang = nowFn();
    const kondisiSaatIni = evaluasiState(sekarang);

    if (kondisiSaatIni === 'OPEN') {
      const sisaDetik = Math.max(1, Math.ceil((openDurationMs - (sekarang - openedAtMs)) / 1000));
      throw new TokenServiceUnavailableError('token-service sedang tidak tersedia (circuit open)', {
        reason: 'circuit_open',
        retryAfterSec: sisaDetik,
      });
    }

    if (kondisiSaatIni === 'HALF_OPEN') {
      if (halfOpenProbesInFlight >= halfOpenMaxProbes) {
        throw new TokenServiceUnavailableError('token-service sedang diuji coba (half-open)', {
          reason: 'half_open_saturated',
          retryAfterSec: Math.max(1, Math.ceil(openDurationMs / 1000)),
        });
      }
      halfOpenProbesInFlight += 1;
    }

    try {
      let percobaan = 0;
      while (true) {
        try {
          const hasil = await kirimPercobaan(akun);
          catatSukses();
          return hasil;
        } catch (err) {
          if (!adalahGalatSementara(err)) {
            if (kondisiSaatIni === 'HALF_OPEN' || state === 'HALF_OPEN') {
              catatSukses();
            }
            throw err;
          }
          if (percobaan >= maxRetries) {
            catatGagalSementara(err, nowFn());
            throw new TokenServiceUnavailableError('gagal menghubungi token-service', {
              cause: err,
              reason: err?.name === 'TimeoutError' || err?.name === 'AbortError' ? 'timeout' : 'upstream_error',
              retryAfterSec: Math.max(1, Math.ceil(openDurationMs / 1000)),
            });
          }

          percobaan += 1;
          const jedaMs = hitungBackoffJitter(percobaan, {
            baseDelayMs,
            maxDelayMs,
            random: randomFn,
          });
          await sleepFn(jedaMs);
        }
      }
    } finally {
      if (kondisiSaatIni === 'HALF_OPEN' && halfOpenProbesInFlight > 0) {
        halfOpenProbesInFlight -= 1;
      }
    }
  }

  return {
    mintaToken,
    getState: () => evaluasiState(nowFn()),
  };
}
