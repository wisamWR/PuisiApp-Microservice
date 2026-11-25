# notification-service (T2.8)

Notifikasi berbahasa Indonesia untuk penulis dan pelapor, dibangun dari event. Kontrak API: [`contracts/openapi/poem-notification.yaml`](../../contracts/openapi/poem-notification.yaml). Pasangan frontend: halaman Notifikasi, badge di header, dan halaman Puisi Saya (`GET /api/me/poems` di poem-query-service).

| | |
| --- | --- |
| API | `GET /api/notifications?page=&size=&unread=`, `GET /api/notifications/unread-count`, `POST /api/notifications/{id}/read`, `POST /api/notifications/read-all` |
| Queue | `q.notification` (+ DLQ) |
| Basis data | `notif_db`: `notifikasi`, salinan `puisi` / `laporan` / `kasus`, `processed_event` |
| Profil compose | `lengkap` |

## Event dan penerima

| Event | Penerima | Notifikasi |
| --- | --- | --- |
| `poem.published` | penulis | terbit / revisi terbit / lolos tinjauan / tampil kembali (tergantung status sebelumnya) |
| `poem.held` | penulis | ditahan, beserta alasan dari publication-service |
| `poem.hidden` | penulis | disembunyikan, alasan, jendela banding 7 hari |
| `poem.processing.completed` | penulis | analisis selesai (hanya versi terbaru) |
| `report.created` | penulis terlapor, pelapor | dilaporkan / laporan diterima |
| `case.decided` | pelapor; penulis hanya bila laporan ditolak dan puisi tetap terbit | hasil keputusan |
| `appeal.filed` | pengaju banding | banding diterima |
| `poem.submitted`, `poem.revised`, `poem.deleted`, `case.opened` | – | salinan pemilik, judul, status, dan pasangan kasus–laporan |

Event status tidak membawa `author_id` atau judul, jadi layanan menyimpan salinan kecil dari `poem.submitted` / `poem.revised`. Bila event status tiba sebelum salinan itu ada, event ditunda (retry 2, 8, 32 detik).

Keputusan moderator yang mengubah status puisi dikabarkan ke penulis lewat `poem.published` / `poem.hidden` yang menyusul, bukan lewat `case.decided`, supaya penulis tidak menerima dua notifikasi untuk satu keputusan.

## Tanpa duplikat

Dua lapis: `processed_event` (event yang sama diabaikan) dan `UNIQUE (event_id, penerima_id)` dengan id notifikasi UUIDv5 dari `event_id` + penerima. Notifikasi tidak bertambah walau event dikirim ulang.

## Menjalankan

```bash
docker compose --profile lengkap up -d notification-service
```

Untuk volume PostgreSQL yang sudah ada, jalankan skrip init sekali:

```bash
MSYS_NO_PATHCONV=1 docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U postgres -f /docker-entrypoint-initdb.d/25-notification.sql
```

## Pengujian

```bash
TEST_DATABASE_URL=postgres://postgres:postgres_dev_only@localhost:5433/notif_uji npm test
```

Uji integrasi lewat gateway dengan poem-create, publication-service, poem-query, image-render-worker, dan processing-tracker asli:

```bash
GATEWAY_URL=http://localhost:8080 node scripts/uji-integrasi.js
```
