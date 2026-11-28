export class CircuitBreaker {
  constructor({
    nama = 'redis-feed',
    errorThreshold = 3,
    resetTimeoutMs = 5000,
    sekarangFn = () => Date.now(),
  } = {}) {
    this.nama = nama;
    this.errorThreshold = errorThreshold;
    this.resetTimeoutMs = resetTimeoutMs;
    this.sekarangFn = sekarangFn;

    this.state = 'CLOSED'; // CLOSED | OPEN | HALF-OPEN
    this.failureCount = 0;
    this.nextAttemptAt = 0;
  }

  getStatus() {
    if (this.state === 'OPEN' && this.sekarangFn() >= this.nextAttemptAt) {
      this.state = 'HALF-OPEN';
    }
    return {
      nama: this.nama,
      state: this.state,
      failureCount: this.failureCount,
      errorThreshold: this.errorThreshold,
    };
  }

  async eksekusi(operasiFn, fallbackFn) {
    const statusSaatIni = this.getStatus();

    // Jika sirkuit OPEN, langsung alihkan ke jalur Fallback tanpa membebani dependensi
    if (statusSaatIni.state === 'OPEN') {
      return fallbackFn(new Error(`CircuitBreaker [${this.nama}] sedang OPEN`));
    }

    try {
      const hasil = await operasiFn();
      // Berhasil -> tutup kembali sirkuit (CLOSED) dan reset penghitung gagal
      this.failureCount = 0;
      this.state = 'CLOSED';
      return hasil;
    } catch (err) {
      this.failureCount += 1;
      if (this.state === 'HALF-OPEN' || this.failureCount >= this.errorThreshold) {
        this.state = 'OPEN';
        this.nextAttemptAt = this.sekarangFn() + this.resetTimeoutMs;
      }
      return fallbackFn(err);
    }
  }
}
