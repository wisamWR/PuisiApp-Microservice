# infra

Infrastruktur lokal dan konfigurasi bersama RASA.

| Berkas / folder | Isi | Pemilik |
| --- | --- | --- |
| `docker-compose.yml` | Compose induk: RabbitMQ, PostgreSQL, MongoDB, Redis, MinIO, Mailpit, jaringan, volume | Wisam |
| `docker-compose.dev.yml` | Override laptop: membuka port ke `127.0.0.1` | Wisam |
| `compose/<domain>.yml` | Layanan per domain, digabung lewat `include` | PJ domain (lihat CODEOWNERS) |
| `compose/contoh.yml` | `example-consumer` (T0.2), hanya jalan dengan `--profile contoh` | Wisam |
| `postgres/init/NN-<layanan>.sql` | Database + user per layanan | PJ layanan |
| `rabbitmq/` | Image RabbitMQ + plugin delayed message dan Prometheus | Wisam |
| `debezium/` | Templat outbox-relay (Debezium Server): `application.properties` dan `relay.yml` untuk `extends` | Wisam |
| `postgres/init/_outbox.psql` | Tabel outbox + publication + slot, di-include skrip DB ber-outbox | Wisam |
| `nginx/conf.d/<domain>.conf` | Rute gateway per domain (T0.4) | Azka |
| `observability/` | Prometheus, Loki, Grafana (T0.8) | Raffa |

## Layanan infrastruktur

| Layanan | Image | Port lokal | Keterangan |
| --- | --- | --- | --- |
| rabbitmq | `rasa/rabbitmq` (build dari `rabbitmq:4.1.8-management`) | 5672, UI 15672 | vhost `rasa`; plugin `rabbitmq_delayed_message_exchange` 4.1.0 |
| postgres | `postgres:16.15-alpine` | 5432 | `wal_level=logical` untuk outbox relay |
| mongodb | `mongo:7.0.45` | 27017 | hasil analisis (keyword, theme, emotion) |
| redis | `redis:7.4.12-alpine` | 6379 | dengan password, AOF aktif |
| minio | `bitnamilegacy/minio:2025.7.23-debian-12-r5` | 9000, konsol 9001 | pengganti S3, bucket dibuat otomatis dari `S3_BUCKET` |
| mailpit | `axllent/mailpit:v1.29.7` | SMTP 1025, UI 8025 | pengganti SMTP |

Image MinIO resmi tidak lagi dipublikasikan di Docker Hub maupun Quay, sehingga dipakai build Bitnami yang dibekukan. Image ini hanya untuk laptop; EC2 memakai Amazon S3 asli.

Semua port hanya terbuka di `127.0.0.1` dan hanya lewat `docker-compose.dev.yml`. Di EC2 berkas itu tidak dipakai, sehingga hanya gateway yang memetakan port.

Selain itu ada `rabbitmq-topologi`, container sekali jalan yang memasang exchange domain dan binding `outbox.relay` dari `contracts/routing.json`. Jalankan ulang setiap `routing.json` berubah:

```bash
docker compose run --rm rabbitmq-topologi
```

Outbox relay (Debezium) dijelaskan di [docs/adr/outbox-relay.md](../docs/adr/outbox-relay.md), termasuk cara menambah relay untuk database baru.

## Jaringan

| Jaringan | Anggota | Internal |
| --- | --- | --- |
| `edge` | api-gateway | tidak |
| `app` | layanan API, worker, RabbitMQ, Mailpit | ya |
| `data` | basis data, Redis, RabbitMQ, MinIO, relay | ya |
| `obs` | observability | ya |
| `egress` | layanan yang butuh internet (image-render-worker ke S3) | tidak |

Layanan hanya bergabung ke jaringan yang dibutuhkan. Layanan API umumnya `[app, data]`.

## Menambah layanan

Tulis di `compose/<domain>.yml`. Path relatif dihitung dari folder `infra/`.

```yaml
services:
  poem-create-service:
    build: ../services/poem-create-service
    restart: unless-stopped
    environment:
      SERVICE_NAME: poem-create-service
      PORT: "8080"
      DATABASE_URL: postgres://poem_create:${POEM_CREATE_DB_PASS}@${POSTGRES_HOST}:${POSTGRES_PORT}/submission_db
      AMQP_URL: amqp://${RABBITMQ_USER}:${RABBITMQ_PASS}@${RABBITMQ_HOST}:${RABBITMQ_PORT}/${RABBITMQ_VHOST}
    networks: [app, data]
    depends_on:
      postgres: { condition: service_healthy }
      rabbitmq: { condition: service_healthy }
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:8080/health"]
      interval: 10s
      timeout: 3s
      retries: 3
```

Aturan:

- Semua alamat dependensi berasal dari variabel di `.env` (`${POSTGRES_HOST}`, `${RABBITMQ_HOST}`, dan seterusnya), bukan nama container yang ditulis langsung di kode. Ini syarat deploy terdistribusi (T10.7).
- Tidak ada `ports:` di layanan. Akses dari luar hanya lewat gateway.
- Setiap layanan wajib punya `healthcheck` (`/health`).
- Variabel baru ditambahkan ke `.env.example` di root repositori.

## Menambah database layanan

1. Salin `postgres/init/01-example.sql` menjadi `postgres/init/NN-<layanan>.sql`.
2. Ganti nama role dan database. Satu layanan, satu database, satu user.
3. Tambahkan `<LAYANAN>_DB_PASS` ke `.env.example` dan `.env`.
4. Skrip init hanya berjalan ketika volume PostgreSQL masih kosong. Untuk menjalankannya ulang:

```bash
docker compose down -v
```

```bash
docker compose up -d
```

`down -v` menghapus semua data lokal (PostgreSQL, MongoDB, Redis, RabbitMQ, MinIO).

Nomor `NN` mengikuti nomor kelompok supaya urutan dan pemilik jelas:

| NN | Kelompok |
| --- | --- |
| `0x` | contoh dan bersama |
| `1x` | 1 Akun |
| `2x` | 2 Penulisan |
| `3x` | 3 Jelajah |
| `4x` | 4 Komunitas |
| `5x` | 5 Mood |
| `6x` | 6 Tema |
| `7x` | 7 Keaslian |
| `8x` | 8 Laporan |
| `9x` | 9 Suara |

Tabel (termasuk `outbox` dan `processed_event`) dibuat oleh migrasi layanan masing-masing, bukan oleh skrip init.

## Perintah berguna

Status dan kesehatan container:

```bash
docker compose ps
```

Log satu layanan:

```bash
docker compose logs -f rabbitmq
```

Masuk ke psql sebagai superuser:

```bash
docker compose exec postgres psql -U postgres
```
