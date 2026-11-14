# puisi-event-lib (libs/python)

Pustaka event-driven Python untuk layanan worker PuisiApp. Perilakunya diselaraskan dengan `libs/node` (amplop `envelope.v1.json`, routing `routing.json`, publisher confirm, idempotensi PostgreSQL, retry `x-percobaan` dengan full jitter, dan DLQ quorum).

## Cara Pemasangan

Pengembangan & pengujian lokal:
pip install -r libs/python/requirements-dev.txt
PYTHONPATH=libs/python pytest -v libs/python/tests

Dockerfile layanan worker (hanya dependensi runtime produksi):
COPY contracts /contracts
COPY libs/python /app/libs/python
RUN pip install --no-cache-dir -r /app/libs/python/requirements.txt && pip install --no-cache-dir --no-deps /app/libs/python

## Variabel Lingkungan

- `SERVICE_NAME` (**wajib** diisi pada layanan penerbit event; `buat_event` dan `event_turunan` akan melempar `ValueError` jika kosong tanpa parameter `producer`. Khusus `buat_logger()`, jika kosong akan memakai nama cadangan `tanpa-nama`).
- `CONTRACTS_DIR` (default `<repo>/contracts` atau `/contracts`): Lokasi folder kontrak bersama (`envelope.v1.json`, `routing.json`).
- `PREFETCH` (default `10`): Jumlah pesan belum di-ack maksimal per worker (`basic_qos`).
- `LOG_LEVEL` (default `INFO`): Level log JSON (`DEBUG`, `INFO`, `WARNING`, `ERROR`).

## Referensi API

1. `buat_event(event_type, aggregate_id, aggregate_version, payload, ...)` dan `event_turunan(sumber, event_type, payload, ...)` untuk membentuk amplop event valid sesuai `envelope.v1.json` dengan `event_id` deterministik UUIDv5.
2. `buat_publisher(channel).terbitkan(event)` untuk menerbitkan event dengan `confirm_delivery()`, resolusi exchange dari `routing.json`, serta header AMQP `correlation_id` dan `traceparent`.
3. `StorePg(pg_conn)` dan `buat_konsumen(channel, antrean=..., ikatan=..., store=..., handler=..., versi_tersimpan=...)` untuk konsumsi idempoten (`INSERT ... ON CONFLICT DO NOTHING`), pengecekan event basi, retry `x-percobaan` dengan jeda `random() * 2000 * 4^n` ms, serta DLQ quorum (`dlx`, `x-delivery-limit: 5`, langsung DLQ untuk `GalatPermanen`).
