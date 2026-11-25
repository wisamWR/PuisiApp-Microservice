import client from 'prom-client';

export function buatMetrik(namaLayanan) {
  const registry = new client.Registry();
  registry.setDefaultLabels({ service: namaLayanan });
  client.collectDefaultMetrics({ register: registry });
  const durasi = new client.Histogram({
    name: 'http_server_request_duration_seconds',
    help: 'Durasi permintaan HTTP',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.01, 0.025, 0.05, 0.1, 0.2, 0.3, 0.5, 1, 2.5],
    registers: [registry],
  });
  const render = new client.Histogram({
    name: 'rasa_image_render_duration_seconds',
    help: 'Durasi render gambar kutipan final',
    labelNames: ['template'],
    buckets: [0.05, 0.1, 0.2, 0.5, 1, 2],
    registers: [registry],
  });
  return { registry, durasi, render };
}
