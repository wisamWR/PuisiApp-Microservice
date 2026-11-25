# publication-service (T2.2)

Worker yang memutuskan kapan puisi boleh tampil, berdasarkan skor kemiripan (kelompok 7) dan keputusan moderator (kelompok 8). Mesin status mengikuti diagram 4.2 All Specifications.

| | |
| --- | --- |
| Queue | `q.publication` (+ `q.publication.dlq`) |
| Konsumsi | `poem.submitted`, `poem.revised`, `poem.deleted`, `poem.similarity.scored`, `case.decided` |
| Terbitkan (outbox) | `poem.published`, `poem.held`, `poem.hidden` lewat `outbox-relay-publication` |
| Basis data | `publication_db`: tabel `publication` (satu baris per puisi), `processed_event`, `outbox` |
| HTTP | `/health`, `/health/ready`, `/metrics` saja |

## Mesin status

```mermaid
stateDiagram-v2
  [*] --> PROCESSING: poem.submitted
  PROCESSING --> PUBLISHED: skor original / inspired / similar
  PROCESSING --> HELD: skor suspected_plagiarism
  PUBLISHED --> REPROCESSING: poem.revised
  REPROCESSING --> PUBLISHED: skor versi baru di bawah dugaan
  REPROCESSING --> HELD: skor versi baru dugaan jiplakan
  HELD --> PUBLISHED: APPROVE / REJECT / RESTORE
  HELD --> HIDDEN: HIDE / DELETE
  PUBLISHED --> HIDDEN: HIDE / DELETE
  HIDDEN --> PUBLISHED: RESTORE (banding)
  PUBLISHED --> DELETED: poem.deleted
  HELD --> DELETED: poem.deleted
  HIDDEN --> DELETED: poem.deleted
```

Selama REPROCESSING, versi lama (`versi_tampil`) tetap tampil. `poem.deleted` berlaku dari status apa pun dan final.

Aturan tambahan di luar diagram:

| Situasi | Perlakuan |
| --- | --- |
| `poem.revised` saat masih PROCESSING / REPROCESSING | tetap menunggu skor, sekarang untuk versi terbaru; skor versi lama dianggap basi |
| `poem.revised` saat HELD / HIDDEN | ditolak; status ditentukan moderator |
| `case.decided` saat PROCESSING | ditolak; belum ada skor |
| APPROVE / REJECT pada PUBLISHED, atau keputusan selain RESTORE pada HIDDEN | status tetap, kasus dicatat |
| skor ulang untuk versi yang sudah diputuskan | diabaikan, tidak terbit dua kali |
| `poem.deleted` sebelum `poem.submitted` | disimpan sebagai tombstone DELETED |

Puisi hanya bisa mencapai PUBLISHED lewat skor kemiripan, atau lewat keputusan moderator atas puisi yang sudah pernah dinilai (HELD / HIDDEN). Jadi puisi tidak pernah terbit sebelum skor ada (diuji acak 2000 rangkaian di `test/mesin.test.js`).

## Urutan, event basi, dan konkurensi

| Kasus | Perlakuan |
| --- | --- |
| Event sama dikirim ulang | `processed_event` (libs/node), diabaikan sebagai duplikat |
| Versi lebih lama dari `versi` tersimpan | basi, diabaikan |
| `case.decided` dengan `decided_at` tidak lebih baru dari keputusan tersimpan | basi |
| Skor atau revisi tiba sebelum event pendahulunya | `GalatTunda`: di-retry 2, 8, 32 detik, lalu DLQ |
| Transisi tidak sah | dicatat `warn "transisi tidak sah ditolak"`, event di-ack |
| Dua event bersamaan untuk puisi yang sama | optimistic locking `row_version`: transaksi yang kalah melempar `GalatKonflik`, di-rollback, lalu di-retry |

Store konsumen sudah mengunci per `aggregate_id`. Tetapi `case.decided` memakai `aggregate_id = case_id`, jadi bisa berjalan bersamaan dengan event lain untuk puisi yang sama; `row_version` menangkap kasus itu.

## Asumsi kontrak (perlu dikonfirmasi)

| Event | Asumsi | Pemilik |
| --- | --- | --- |
| `poem.similarity.scored` | `aggregate_id = poem_id`, `aggregate_version` = versi puisi yang dinilai (payload tidak punya field versi) | Raffa (T7.2) |
| `case.decided` | APPROVE dan REJECT = puisi lolos / laporan ditolak; HIDE dan DELETE = sembunyikan; RESTORE = banding dikabulkan. `poem_id` diambil dari payload | Zoya (kelompok 8) |
| `poem.published` / `held` / `hidden` | `aggregate_id = poem_id`, `aggregate_version` = versi puisi yang tampil / ditahan. Payload mengikuti skema T0.6 (tanpa `author_id`) | konsumen kelompok 3, 5, 6, 9 |

## Menjalankan

Layanan ikut `docker compose up -d` (tanpa profil). Untuk volume PostgreSQL yang sudah ada, jalankan skrip init barunya sekali (lihat `infra/README.md`):

```bash
MSYS_NO_PATHCONV=1 docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U postgres -f /docker-entrypoint-initdb.d/23-publication.sql
```

## Pengujian

```bash
npm test
```

`test/db.test.js` (optimistic locking dan outbox dengan PostgreSQL asli) hanya berjalan bila `TEST_DATABASE_URL` diisi, misalnya `postgres://postgres:postgres_dev_only@localhost:5433/publication_uji` (basis data dibuat otomatis).

Uji integrasi dengan layanan asli (gateway, poem-create-service, outbox relay):

```bash
node scripts/uji-integrasi.js
```

Event palsu selama kelompok 7 dan 8 belum siap:

```bash
docker compose exec publication-service node scripts/kirim-event-palsu.js skor <poem_id> 1 original
```

```bash
docker compose exec publication-service node scripts/kirim-event-palsu.js kasus <poem_id> HIDE "alasan"
```
