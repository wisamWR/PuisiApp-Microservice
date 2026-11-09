# k2-penulisan: Penulisan dan Siklus Puisi

Branch: `k2-penulisan` | Penanggung jawab: Wisam | Task: T2.1 sampai T2.8 | Frontend: Tulis Puisi, Notifikasi, Puisi Saya

## Cakupan

Sisi tulis puisi, mesin status publikasi, read model puisi, pratinjau dan gambar kutipan, pelacakan status pemrosesan, serta notifikasi. Kelompok ini memiliki jalur kritis pengunggahan sampai terbit.

## Layanan dan Komponen

| Layanan | Tipe | Data | Task |
| --- | --- | --- | --- |
| poem-create-service | API | submission-db + outbox | T2.1 |
| publication-service | worker | publication-db + outbox | T2.2 |
| poem-query-service | API + consumer proyeksi | poem-read-db (replika baca) + cache Redis | T2.3 |
| poem-edit-service, poem-delete-service | API | revision-db, deletion-db + outbox, salinan kepemilikan | T2.4 |
| image-preview-service, image-render-worker | API, worker | S3 (objek berversi) | T2.5 |
| processing-tracker, status-stream-service | worker, API | progress-store (Redis hash) | T2.7 |
| notification-service | API | notif-db | T2.8 |

## Endpoint

| Metode | Path | Respons |
| --- | --- | --- |
| POST | `/api/poems` | 202 `{poem_id, versi: 1, status: PROCESSING}` |
| PUT | `/api/poems/{id}` | 202; revisi menjadi versi baru |
| DELETE | `/api/poems/{id}` | 202; soft delete |
| GET | `/api/poems/{id}`, `/api/poems?author=` | 200 dari Redis atau replika |
| GET | `/api/poems/{id}/status/stream` | SSE |
| GET | `/api/images/preview` | 200 `image/jpeg`, stateless, di-cache CDN |
| GET | `/api/me/poems`, `/api/notifications` | 200 |

## Event

| Event | Peran |
| --- | --- |
| `poem.submitted`, `poem.revised`, `poem.deleted` | publish (create, edit, delete) lewat outbox |
| `poem.published`, `poem.held`, `poem.hidden` | publish (publication) |
| `poem.image.rendered` | publish (image-render) |
| `poem.processing.updated`, `poem.processing.completed` | publish (processing-tracker) |
| `poem.similarity.scored`, `case.decided` | consume (publication) |
| 14 jenis event puisi dan analisis | consume (poem-query) |

## Catatan Teknis

- `POST /api/poems` hanya menulis `submission` dan `outbox` dalam satu transaksi lokal lalu membalas 202. Penulis diambil dari `X-User-Id`, bukan dari body.
- Idempotensi pengajuan dijaga `UNIQUE(author_id, idempotency_key)` dari header `Idempotency-Key`.
- `publication-service` memiliki satu invarian: mesin status PROCESSING, PUBLISHED, REPROCESSING, HELD, HIDDEN, DELETED. Dua event dapat tiba bersamaan, sehingga dipakai optimistic locking pada `publication.row_version`; transaksi yang kalah diulang dari pesan yang sama. Hanya hasil plagiarisme yang menjadi gerbang publikasi (jalur kritis).
- `poem-query-service`: cache-aside `poem:{id}` (TTL 10 menit, jitter acak ±10%), lock `SET lock:poem:{id} NX PX 2000` untuk mencegah stampede, dan penolakan event dengan `aggregate_version` lebih lama.
- `poem-edit-service` memakai tabel `poem_ownership` hasil salinan `poem.submitted`. Jika salinan belum terbentuk, balas 409 dan klien mencoba lagi.
- Gambar akhir dirender per versi ke `/img/puisi/{poem_id}/v{versi}.jpg` (immutable, tanpa invalidasi CDN). Kegagalan sementara memakai retry backoff dengan jitter, lalu DLQ.
- `status-stream-service` mendistribusikan pesan antar-replika lewat Redis pub/sub karena koneksi SSE berumur panjang.
- Frontend (T2.6) menyimpan draf di `localStorage` dan menampilkan puisi secara optimistik setelah 202.

## Dependensi

T0.2, T0.3 (outbox relay), T0.6, T0.10 (penerbit contoh event untuk pengujian kelompok lain).

## Alur Git

Kerjakan langsung di `k2-penulisan`, awali commit dengan kode task (`T2.1: validasi judul`). Gabungkan `main` ke branch ini setiap hari kerja dan buat PR ke `main` minimal tiap Jumat.