# poem-edit-service dan poem-delete-service

T2.4, kelompok 2 Penulisan puisi. Dua layanan terpisah (database berbeda), didokumentasikan bersama karena polanya sama. Kode delete ada di [../poem-delete-service](../poem-delete-service).

| Layanan | Endpoint | Database | Event terbit | Event dikonsumsi |
| --- | --- | --- | --- | --- |
| poem-edit-service | `PUT /api/poems/{id}` | revision_db | `poem.revised` | `poem.submitted`, `poem.deleted` (`q.poem-edit`) |
| poem-delete-service | `DELETE /api/poems/{id}` | deletion_db | `poem.deleted` | `poem.submitted`, `poem.revised` (`q.poem-delete`) |

Kontrak: [poem-edit-delete.yaml](../../contracts/openapi/poem-edit-delete.yaml), [poem.revised.v1.json](../../contracts/events/poem.revised.v1.json), [poem.deleted.v1.json](../../contracts/events/poem.deleted.v1.json).

## Cara kerja

- **Kepemilikan tanpa panggilan sinkron.** Setiap layanan menyimpan salinan `poem_ownership` yang dibangun dari event (laporan 5.2, teknik 3). Pemeriksaan pemilik dibaca dari database sendiri.
- **Revisi append-only.** Setiap revisi menjadi baris baru `(poem_id, versi)`; versi lama tidak pernah diubah. Baris kepemilikan dikunci (`FOR UPDATE`) sehingga revisi bersamaan mendapat nomor versi berurutan.
- **Validasi sama dengan pengajuan.** Aturan judul, isi, bait kutipan, template, dan pembersihan HTML berasal dari [poem-common](../poem-common), paket yang juga dipakai poem-create-service.
- **Idempotensi.** `PUT` wajib `Idempotency-Key` (kirim ulang = versi sama, isi beda = 409). `DELETE` idempoten secara alami: hapus kedua kali = 202 yang sama tanpa event baru.
- **Transactional Outbox.** Data dan event ditulis dalam satu transaksi; `outbox-relay-revision` dan `outbox-relay-deletion` menerbitkannya.
- **`poem.deleted` bersifat final.** Konsumen harus memprosesnya tanpa membandingkan versi, karena penghapusan bisa berbalapan dengan revisi. poem-delete-service mengonsumsi `poem.revised` agar `last_version` akurat (tambahan dari Tabel 6.3 laporan).

| Respons | PUT | DELETE |
| --- | --- | --- |
| 202 | versi baru diterima | terhapus (`Idempotent-Replayed` bila sudah sebelumnya) |
| 403 | bukan pemilik | bukan pemilik |
| 404 | tidak ada, sudah dihapus, atau baru diajukan dan salinan kepemilikan belum tiba (coba lagi beberapa detik) | tidak ada |
| 409 | Idempotency-Key untuk isi berbeda | - |

## Menjalankan

Edit dan hapus adalah tahap **Lengkap** (Sprint 2), di luar cakupan demo PA3, jadi hanya berjalan dengan profil:

```bash
docker compose --profile lengkap up -d --build
```

Volume PostgreSQL lama perlu skrip init baru (tanpa menghapus data):

```bash
MSYS_NO_PATHCONV=1 docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U postgres -f /docker-entrypoint-initdb.d/21-poem-edit.sql
```

```bash
MSYS_NO_PATHCONV=1 docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U postgres -f /docker-entrypoint-initdb.d/22-poem-delete.sql
```

## Pengujian

```bash
npm test
```

Uji integrasi siklus lengkap lewat gateway (buat, revisi, gambar v2, hapus, edit setelah hapus), dari laptop:

```bash
node scripts/uji-integrasi.js
```

Hasil 12 November 2026: 15/15 pemeriksaan lolos. Revisi v2 diproses ulang image-render-worker (gambar `v2.jpg`, `v1.jpg` tetap ada), `poem.deleted` membawa `last_version` 2, dan PUT setelah hapus dibalas 404.

## Belum tercakup

- Tombol Edit dan Hapus di halaman detail menunggu kerangka frontend (T0.5) dan halaman detail (T2.6/T3.x).
- "Puisi terhapus hilang dari feed, pencarian, dan detail" bergantung pada konsumen `poem.deleted` milik poem-query (T2.3), mood-feed, theme-feed, dan search; `poem.deleted` sudah terbit ke `poem.events` untuk mereka.
