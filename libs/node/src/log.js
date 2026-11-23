/**
 * Logger JSON ke stdout. Setiap baris memuat ts, level, service, msg, dan
 * konteks (correlation_id, event_id, trace_id) agar bisa ditelusuri di Loki.
 */

const LEVEL = { debug: 10, info: 20, warn: 30, error: 40 };

/** Ambil trace-id dari header W3C traceparent ("00-<trace-id>-<span-id>-<flags>"). */
export function traceIdDari(traceparent) {
  if (typeof traceparent !== 'string') return undefined;
  const bagian = traceparent.split('-');
  return bagian.length === 4 ? bagian[1] : undefined;
}

function serialisasiGalat(err) {
  if (!(err instanceof Error)) return err;
  return { name: err.name, message: err.message, stack: err.stack };
}

/**
 * @param {string} [service]
 * @param {Record<string, unknown>} [konteks]
 * @param {{ level?: string, tulis?: (baris: string) => void }} [opsi]
 */
export function buatLogger(service = process.env.SERVICE_NAME ?? 'tanpa-nama', konteks = {}, opsi = {}) {
  const level = opsi.level ?? process.env.LOG_LEVEL ?? 'info';
  const tulis = opsi.tulis ?? ((baris) => process.stdout.write(`${baris}\n`));
  const minimum = LEVEL[level] ?? LEVEL.info;

  const catat = (lv) => (msg, field = {}) => {
    if (LEVEL[lv] < minimum) return;
    const { err, ...sisa } = field;
    const baris = { ts: new Date().toISOString(), level: lv, service, msg, ...konteks, ...sisa };
    if (err !== undefined) baris.err = serialisasiGalat(err);
    tulis(JSON.stringify(baris));
  };

  return {
    debug: catat('debug'),
    info: catat('info'),
    warn: catat('warn'),
    error: catat('error'),
    /** Logger turunan dengan konteks tambahan. */
    anak: (tambahan) => buatLogger(service, { ...konteks, ...tambahan }, { level, tulis }),
  };
}
