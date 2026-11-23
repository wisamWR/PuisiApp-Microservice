# poem-query-service (T2.3)

Sisi baca puisi (CQRS). Read model dibangun dari 14 jenis event, sehingga detail puisi lengkap (teks, penulis, status, gambar, kata kunci, tema, emosi, originalitas, skor) tersedia tanpa panggilan sinkron ke layanan lain.

| | |
| --- | --- |
| API | `GET /api/poems/{id}`, `GET /api/poems?author=&page=&size=`. Kontrak: [`contracts/openapi/poem-query.yaml`](../../contracts/openapi/poem-query.yaml) |
| Queue | `q.poem-query` (+ `q.poem-query.dlq`) |
| Basis data | `poem_read_db`: `poem` (per puisi), `poem_versi` (per versi), `penulis`, `processed_event` |
| Cache | Redis, cache-aside untuk detail, kunci `poem-query:detail:<poem_id>`, TTL `CACHE_TTL_DETIK` (bawaan 30) |
| Menerbitkan event | tidak (tanpa outbox) |

## Event yang dikonsumsi

| Event | Kolom yang diisi |
| --- | --- |
| `poem.submitted`, `poem.revised` | teks versi (`poem_versi`), pemilik, versi terbaru |
| `poem.published`, `poem.held`, `poem.hidden` | status, versi tampil, `published_at` (event lebih lama dari `status_at` diabaikan) |
| `poem.deleted` | status DELETED, final |
| `poem.image.rendered` | gambar versi itu |
| `poem.keywords.extracted`, `poem.themes.extracted`, `poem.emotion.analyzed`, `poem.similarity.scored` | analisis versi itu |
| `poem.score.updated` | skor dan jumlah suara (berdasarkan `updated_at`) |
| `user.registered`, `user.profile.updated` | username, nama tampil, bio |

Setiap event hanya meng-upsert kolomnya sendiri, jadi urutan kedatangan event dari layanan yang berbeda tidak memengaruhi hasil akhir (diuji dengan 20 urutan acak di `test/db.test.js`). Hasil analisis disimpan per versi, sehingga hasil untuk versi lama tidak menimpa versi baru.

Asumsi kontrak:
- Event analisis yang tidak punya `version` di payload memakai `aggregate_version` amplop sebagai versi puisi (`aggregate_id = poem_id`).
- `user.*` memakai `aggregate_id` sebagai ID pengguna. `payload.id` dan `payload.display_name` juga dibaca bila ada; register-service (k1) saat ini mengirim keduanya.

## Visibilitas

| Status | Penulis, moderator, admin | Pengguna lain |
| --- | --- | --- |
| PUBLISHED | versi terbaru (REPROCESSING bila revisi sedang dinilai) | versi terbit |
| PROCESSING, HELD, HIDDEN | ya | 404 |
| DELETED | 404 | 404 |

Cache menyimpan bundel mentah yang sama untuk semua pembaca, lalu aturan visibilitas diterapkan setiap permintaan, jadi cache tidak pernah membocorkan puisi orang lain. Setelah transaksi proyeksi commit, cache puisi yang berubah dihapus; `user.*` menghapus cache semua puisi penulis itu. Bila Redis mati, layanan tetap membaca dari basis data (header `X-Cache: MISS`).

## Menjalankan

Layanan ikut `docker compose up -d`. Untuk volume PostgreSQL yang sudah ada, jalankan skrip init barunya sekali:

```bash
MSYS_NO_PATHCONV=1 docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U postgres -f /docker-entrypoint-initdb.d/24-poem-query.sql
```

Mock server untuk frontend (T3.1) tanpa layanan asli:

```bash
npx @stoplight/prism-cli mock contracts/openapi/poem-query.yaml --port 4011
```

## Rebuild proyeksi

Bila read model rusak atau tertinggal, bangun ulang dari basis data sumber kelompok 2. Skrip memakai proyeksi yang sama dengan konsumen dan aman diulang. Data milik kelompok lain (gambar, analisis, skor, nama penulis) tetap utuh kecuali memakai `--kosongkan`.

```bash
DATABASE_URL=postgres://postgres:postgres_dev_only@localhost:5433/poem_read_db SUMBER_SUBMISSION_URL=postgres://postgres:postgres_dev_only@localhost:5433/submission_db SUMBER_REVISION_URL=postgres://postgres:postgres_dev_only@localhost:5433/revision_db SUMBER_PUBLICATION_URL=postgres://postgres:postgres_dev_only@localhost:5433/publication_db SUMBER_DELETION_URL=postgres://postgres:postgres_dev_only@localhost:5433/deletion_db node scripts/rebuild.js
```

## Pengujian

```bash
npm test
```

`test/db.test.js` berjalan bila `TEST_DATABASE_URL` (dan `TEST_REDIS_URL` untuk uji hit ratio) diisi:

```bash
TEST_DATABASE_URL=postgres://postgres:postgres_dev_only@localhost:5433/poem_read_uji TEST_REDIS_URL=redis://:redis_dev_only@localhost:6379 npm test
```

Uji integrasi dengan event asli T2.1, T2.2, dan image-render-worker, termasuk hit ratio 1.000 baca:

```bash
docker compose exec poem-query-service node scripts/uji-integrasi.js
```
