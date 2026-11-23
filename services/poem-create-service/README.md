# poem-create-service

T2.1, kelompok 2 Penulisan puisi. Menerima pengajuan puisi baru, memvalidasi, menyimpan puisi versi 1 dan event `poem.submitted` dalam satu transaksi (Transactional Outbox), lalu langsung membalas `202 Accepted`.

```txt
klien -> api-gateway (auth_request, X-User-Id) -> poem-create-service
           -> submission_db: INSERT submission + INSERT outbox (satu transaksi) -> 202
outbox-relay-submission (Debezium) -> outbox.relay -> poem.events (poem.submitted)
```

Layanan ini **tidak terhubung ke RabbitMQ**. Pengajuan tetap diterima walaupun broker mati; event terbit setelah broker pulih.

## Kontrak

- API: [contracts/openapi/poem-create.yaml](../../contracts/openapi/poem-create.yaml)
- Event: [contracts/events/poem.submitted.v1.json](../../contracts/events/poem.submitted.v1.json)

`POST /api/poems` (wajib login):

```json
{
  "title": "Jendela yang Basah",
  "body": "sore turun tanpa permisi\nhujan mengetuk kaca\n\nseperti nama yang tak jadi kupanggil",
  "quote_stanza": 0,
  "template_id": "latar2",
  "category": "lirik",
  "keywords": ["hujan", "rindu"]
}
```

Header wajib `Idempotency-Key` (8 sampai 64 karakter, dibuat klien sekali per draf).

| Aturan | Nilai |
| --- | --- |
| Judul | 1 sampai 150 karakter, satu baris |
| Isi | 1 sampai 8.000 karakter, bait dipisah satu baris kosong |
| Bait kutipan | indeks bait berbasis 0, bait terpilih maksimal 280 karakter |
| Template | `TEMPLATE_SAH` (bawaan `latar1,latar2,latar3`) |
| HTML | semua tag dibuang, isi `<script>`/`<style>` ikut dibuang |
| Kategori, kata kunci manual | opsional; maksimal 60 karakter, 10 kata kunci x 40 karakter |
| Penulis | dari header `X-User-Id` gateway; `author_id` di body ditolak |

| Respons | Arti |
| --- | --- |
| 202 | diterima; body berisi data puisi untuk tampilan optimistik, header `Location` |
| 202 + `Idempotent-Replayed: true` | kirim ulang dengan key dan isi yang sama; tidak ada puisi baru |
| 400 | validasi gagal (`rincian` per field) atau `Idempotency-Key` tidak ada |
| 401 | tidak ada `X-User-Id` |
| 409 | key sama untuk isi berbeda |
| 413, 415 | body > 64 KB, bukan JSON |

## Variabel lingkungan

| Variabel | Keterangan |
| --- | --- |
| `DATABASE_URL` | `postgres://poem_create:...@<host>:5432/submission_db` |
| `TEMPLATE_SAH` | daftar template sah, dipisah koma |
| `PORT` | bawaan 8080 |
| `DB_POOL_MAX` | bawaan 10 |
| `SERVICE_NAME`, `LOG_LEVEL` | lihat libs/node |

Endpoint operasional: `/health`, `/health/live`, `/health/ready` (cek basis data), `/metrics` (Prometheus, termasuk histogram `http_server_request_duration_seconds`).

## Menjalankan dan menguji

```bash
docker compose up -d --build api-gateway poem-create-service outbox-relay-submission
```

```bash
npm test
```

Uji integrasi lewat gateway dan relay asli (dari laptop, dengan stack berjalan):

```bash
node scripts/uji-integrasi.js
```

Uji beban lokal (p95 sampai 202):

```bash
node scripts/uji-beban.js 500 20
```

Hasil di laptop pengembang (10 November 2026): 500 permintaan, konkurensi 20, 667 req/detik, p50 25 ms, p95 56 ms, p99 75 ms, semua 202. Event `poem.submitted` tiba di `poem.events` sekitar 0,3 sampai 1 detik setelah 202.

## Catatan untuk kelompok lain

- Konsumen `poem.submitted` bisa langsung mengikat queue ke `poem.events` dengan routing key `poem.submitted` lewat `buatKonsumen` di libs/node.
- `quote_text` sudah berisi teks bait kutipan; tidak perlu memecah `body` lagi.
- `author_id` adalah teks (maks. 64 karakter), mengikuti ID dari kelompok 1. Selama stub auth gateway dipakai, nilainya `stub-user`.
