import client from 'prom-client';

export function buatMetrikHttp(namaLayanan) {
  const registry = new client.Registry();
  registry.setDefaultLabels({ service: namaLayanan });
  client.collectDefaultMetrics({ register: registry });

  const durasiHttp = new client.Histogram({
    name: 'http_server_request_duration_seconds',
    help: 'Durasi permintaan HTTP dalam detik',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.2, 0.3, 0.5, 1, 2.5, 5],
    registers: [registry],
  });

  function catatRequest(method, route, statusCode, mulaiMs) {
    const durasiDetik = Math.max(0, (performance.now() - mulaiMs) / 1000);
    durasiHttp.observe(
      { method: method || 'GET', route: route || 'tidak_dikenal', status_code: String(statusCode) },
      durasiDetik,
    );
  }

  async function layaniMetrics(res) {
    res.writeHead(200, {
      'Content-Type': registry.contentType,
      'Cache-Control': 'no-store',
    });
    res.end(await registry.metrics());
  }

  return { registry, durasiHttp, catatRequest, layaniMetrics };
}
