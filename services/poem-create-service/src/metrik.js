/**
 * Metrik Prometheus (metode RED, laporan 12.1): laju, galat, dan histogram
 * durasi per rute. p95 POST /api/poems dihitung dari histogram ini.
 */
import client from 'prom-client';

export function buatMetrik(namaLayanan) {
  const registry = new client.Registry();
  registry.setDefaultLabels({ service: namaLayanan });
  client.collectDefaultMetrics({ register: registry });

  const durasi = new client.Histogram({
    name: 'http_server_request_duration_seconds',
    help: 'Durasi permintaan HTTP',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.2, 0.3, 0.5, 1, 2.5, 5],
    registers: [registry],
  });

  const pengajuan = new client.Counter({
    name: 'rasa_poem_submissions_total',
    help: 'Pengajuan puisi menurut hasil (baru, ulang, konflik, tidak_valid)',
    labelNames: ['hasil'],
    registers: [registry],
  });

  return { registry, durasi, pengajuan };
}
