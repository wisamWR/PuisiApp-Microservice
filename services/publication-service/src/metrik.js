import client from 'prom-client';

export function buatMetrik(namaLayanan) {
  const registry = new client.Registry();
  registry.setDefaultLabels({ service: namaLayanan });
  client.collectDefaultMetrics({ register: registry });
  const transisi = new client.Counter({
    name: 'rasa_publication_events_total',
    help: 'Event yang diproses publication-service menurut jenis dan aksi (ubah, abaikan, basi, tolak, tunda)',
    labelNames: ['event_type', 'aksi'],
    registers: [registry],
  });
  return { registry, transisi };
}
