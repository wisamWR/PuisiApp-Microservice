# image-service

T2.5, kelompok 2 Penulisan puisi. Satu image dengan dua entrypoint (pola "satu image per domain" di laporan Bab 14.1), sehingga pratinjau dan gambar final memakai kode render yang sama persis.

| Entrypoint | Layanan | Peran |
| --- | --- | --- |
| `node src/preview.js` | image-preview-service | `GET /api/images/preview`: JPEG 540 px secara sinkron saat penulis mengetik. Stateless, tanpa basis data |
| `node src/render-worker.js` | image-render-worker | Konsumsi `poem.submitted` dan `poem.revised` (`q.image-render`), render JPEG 1080 px, unggah ke S3, terbitkan `poem.image.rendered` |

```txt
penulis mengetik -> gateway -> image-preview-service -> JPEG 540 px (Cache-Control 24 jam, ETag)
poem.submitted -> q.image-render -> image-render-worker -> S3 poems/{poem_id}/v{versi}.jpg
                                                       -> poem.image.rendered (analysis.events)
```

## Kontrak

- API pratinjau: [contracts/openapi/image-preview.yaml](../../contracts/openapi/image-preview.yaml)
- Event: [contracts/events/poem.image.rendered.v1.json](../../contracts/events/poem.image.rendered.v1.json)

## Template

Tiga template di [assets/templates](assets/templates): `latar1` Malam Hujan, `latar2` Kertas Senja, `latar3` Daun Pagi. Setiap template terdiri atas satu SVG latar (tanpa teks) dan satu entri di `templates.json` yang menentukan warna, font, dan kotak teks.

- Latar dirasterkan sekali ke memori saat start untuk ukuran 540 dan 1080 px. Setiap permintaan hanya menempelkan lapisan teks.
- Ukuran huruf mengecil otomatis sampai bait muat di kotak teks; baris panjang dibungkus per kata. Teks yang tetap tidak muat pada ukuran minimum dipotong dengan elipsis.
- Font: DejaVu Serif dan DejaVu Sans (`font-dejavu`, dipasang di Dockerfile).
- Menambah template: buat SVG latar, tambahkan entri di `templates.json`, lalu tambahkan id-nya ke `TEMPLATE_SAH` poem-create-service. Bila desain template lama berubah, naikkan `VERSI_RENDER` di `src/preview-app.js` agar cache pratinjau ikut berganti.

## Keputusan teknis

| Hal | Keputusan | Alasan |
| --- | --- | --- |
| Pustaka gambar | `sharp` (libvips) menggantikan Jimp | Pratinjau sekitar 40 ms per render, jauh di bawah target 300 ms; teks dirender sebagai SVG sehingga tajam di setiap ukuran |
| Kunci S3 | `poems/{poem_id}/v{versi}.jpg`, `Cache-Control: immutable` | Versi lama tidak pernah ditimpa; CloudFront tidak perlu invalidasi (laporan 10.3) |
| Idempotensi worker | tanpa basis data; unggah ke kunci yang sama dan `event_id` deterministik (`eventTurunan`) | Retry dan event duplikat menghasilkan objek dan event yang sama |
| Galat | template tak dikenal atau teks kosong = `GalatPermanen` (DLQ); galat S3 = sementara (retry 2/8/32 detik) | |
| Pemanasan | render sekali per template saat start | Render teks pertama memicu fontconfig membangun cache font (beberapa detik) |
| Pratinjau publik | tanpa `auth_request` di gateway, dibatasi 10 permintaan/detik per IP | Sesuai Listing A.6; hasil hanya bergantung pada query string sehingga aman di-cache CDN |

## Variabel lingkungan

| Variabel | Layanan | Keterangan |
| --- | --- | --- |
| `PORT` | keduanya | bawaan 8080 |
| `MEREK` | keduanya | teks merek di bawah gambar, bawaan `RASA` |
| `TEMPLATE_DIR` | keduanya | bawaan `assets/templates` |
| `RABBITMQ_*`, `PREFETCH` | worker | prefetch bawaan 2 (render memakai CPU) |
| `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_PUBLIC_BASE_URL` | worker | lihat `.env.example`; di EC2 endpoint dan kunci dikosongkan (IAM LabRole) |

## Menjalankan dan menguji

```bash
docker compose up -d --build api-gateway image-preview-service image-render-worker poem-create-service outbox-relay-submission
```

```bash
npm test
```

Uji integrasi lewat gateway dan T2.1 asli (dari laptop, dengan stack berjalan):

```bash
node scripts/uji-integrasi.js
```

Hasil di laptop pengembang (12 November 2026), lewat gateway:

| Pemeriksaan | Hasil |
| --- | --- |
| Pratinjau, 60 render unik pada 8 permintaan/detik | semua 200, p50 48 ms, p95 86 ms |
| Semburan 60 permintaan serentak | 39 ditolak 429 oleh rate limit gateway |
| POST puisi sampai `poem.image.rendered` tiba | sekitar 0,8 detik |
| Gambar final dari URL publik MinIO | JPEG 1080 px, sekitar 58 KB, `Cache-Control: immutable` |
| Pemuatan dan pemanasan template saat start | sekitar 0,3 detik di container |

`poem.revised` (T2.4) sudah diikat ke `q.image-render`. Worker membaca `poem_id`, `version`, `quote_text`, dan `template_id` dari payload, jadi T2.4 perlu menyertakan field yang sama.
