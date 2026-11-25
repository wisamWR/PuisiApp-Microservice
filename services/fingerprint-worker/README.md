# Fingerprint Worker

Fingerprint Worker merupakan layanan Python pada PuisiApp Microservice yang bertugas menghasilkan fingerprint puisi menggunakan teknik **Shingling** dan **MinHash** untuk mendukung proses deteksi kemiripan puisi.

## 1. Teknologi

- Python 3.11+
- RabbitMQ sebagai message broker
- Pika untuk komunikasi RabbitMQ
- Shingling dengan ukuran 3 kata
- MinHash dengan 128 nilai hash
- SHA-256 sebagai fungsi hash
- Pytest untuk pengujian
- Docker untuk containerization
- Shared library `libs/python/event_lib`

## 2. Tanggung Jawab Layanan

Fingerprint Worker memiliki tanggung jawab:

1. Mengonsumsi event `poem.submitted` dan `poem.revised`.
2. Melakukan normalisasi teks puisi.
3. Menghilangkan tanda baca dan stopwords.
4. Membentuk shingle dari setiap tiga kata berurutan.
5. Menghitung signature MinHash sebanyak 128 nilai untuk seluruh puisi.
6. Menghitung signature MinHash untuk setiap bait puisi.
7. Menghasilkan `event_id` deterministik menggunakan UUIDv5 berdasarkan `poem_id` dan `version`.
8. Menerbitkan event `poem.fingerprint.created`.

Layanan bersifat stateless dan tidak memiliki database sendiri.

## 3. Struktur Folder

```text
fingerprint-worker/
├── src/
│   └── app/
│       ├── __init__.py
│       ├── config.py
│       ├── event.py
│       ├── fingerprint.py
│       └── main.py
├── tests/
│   ├── test_event.py
│   ├── test_fingerprint.py
│   └── test_health.py
├── Dockerfile
├── pyproject.toml
└── README.md
```

## 4. Konfigurasi

| Environment Variable | Default | Keterangan |
|---|---|---|
| `SERVICE_NAME` | `fingerprint-worker` | Nama layanan |
| `HOST` | `0.0.0.0` | Host HTTP server |
| `PORT` | `8080` | Port health endpoint |
| `AMQP_URL` | Kosong | URL koneksi RabbitMQ |
| `MINHASH_SEED` | `42` | Seed MinHash |
| `MINHASH_NUM_HASHES` | `128` | Jumlah nilai signature |
| `SHINGLE_SIZE` | `3` | Jumlah kata per shingle |

## 5. Event

### Input

- `poem.submitted`
- `poem.revised`

### Output

`poem.fingerprint.created`

Payload output berisi:

- `poem_id`
- `version`
- `shingle_count`
- `signature`
- `stanza_signatures`

Setiap signature memiliki 128 nilai.

## 6. Pengujian

Menjalankan unit test:

```bash
pytest services/fingerprint-worker/tests -v
```

Pemeriksaan sintaks:

```bash
python -m py_compile services/fingerprint-worker/src/app/main.py
```

## 7. Menjalankan dengan Docker

Build image:

```bash
docker build -f services/fingerprint-worker/Dockerfile -t puisiapp/fingerprint-worker:dev .
```

Menjalankan melalui Docker Compose:

```bash
docker compose --env-file .env -f infra/docker-compose.yml -f infra/docker-compose.dev.yml up -d rabbitmq fingerprint-worker
```

Memeriksa status:

```bash
docker compose --env-file .env -f infra/docker-compose.yml -f infra/docker-compose.dev.yml ps rabbitmq fingerprint-worker
```

Memeriksa log:

```bash
docker compose --env-file .env -f infra/docker-compose.yml -f infra/docker-compose.dev.yml logs -f fingerprint-worker
```

## 8. Health Check

Endpoint:

```http
GET /health
```

Respons berhasil:

```json
{
  "status": "ok",
  "service": "fingerprint-worker"
}
```

## 9. Pengujian Implementasi

Pengujian unit dan end-to-end dilakukan untuk memastikan:

- Normalisasi teks berjalan konsisten.
- Teks dengan perbedaan kapitalisasi dan tanda baca menghasilkan signature yang sama.
- Signature utama memiliki 128 nilai.
- Setiap bait memiliki signature 128 nilai.
- Event output mengikuti struktur kontrak `poem.fingerprint.created`.
- Event ID bersifat deterministik berdasarkan puisi dan versinya.