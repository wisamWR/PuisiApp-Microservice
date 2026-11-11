/**
 * Galat yang tidak akan berhasil walaupun dicoba ulang (payload tidak valid,
 * aturan bisnis dilanggar, poison message). Konsumen langsung memindahkan
 * pesan ke DLQ tanpa retry.
 *
 * Galat lain dianggap sementara (basis data sibuk, S3 timeout) dan dicoba ulang.
 */
export class GalatPermanen extends Error {
  constructor(pesan, opsi) {
    super(pesan, opsi);
    this.name = 'GalatPermanen';
    this.permanen = true;
  }
}

/** @param {unknown} err */
export function apakahPermanen(err) {
  return Boolean(err && typeof err === 'object' && /** @type {any} */ (err).permanen === true);
}
