# ADR: Outbox relay dengan Debezium Server

- Status: diterima
- Tanggal: 10 November 2026
- Task: T0.3
- Penulis: Wisam

## Konteks

Layanan yang menulis data bisnis harus menerbitkan event tanpa masalah dual-write (Bab 6 diktat). Laporan menetapkan Transactional Outbox dengan Change Data Capture lewat Debezium Server, dengan relay polling sebagai alternatif (Tabel 15.1). Event harus sampai ke topic exchange domain sesuai `contracts/routing.json`, bukan ditebak dari awalan nama event.

## Hasil spike

Spike dilakukan dengan `quay.io/debezium/server:3.7.1.Final`, PostgreSQL 16 (`wal_level=logical`, `pgoutput`), dan RabbitMQ 4.1.8.

| Temuan | Akibat |
| --- | --- |
| Sink RabbitMQ Debezium Server hanya menerbitkan ke **satu** exchange (statis atau nama topic). Routing key berasal dari `static`, `topic`, atau `key`. | Tidak bisa langsung menyebar ke 7 exchange domain. |
| Properti vhost adalah `connection.virtual.host` (diteruskan ke `ConnectionFactoryConfigurator`), bukan `virtualHost`. | Dengan nama yang salah, relay jatuh ke vhost `/` dan gagal `NOT_ALLOWED`. |
| Replication slot yang dibuat **sebelum** publication membuat `pgoutput` macet permanen: `publication "outbox_pub" does not exist`. | Publication harus dibuat lebih dulu daripada slot. |
| Image MinIO dan sebagian image lain berpindah registry; Debezium Server 3.x hanya ada di Quay. | Image dipin ke `quay.io`. |
| (Ditemukan di T2.1, 10 Nov) Satu klaster Postgres berisi banyak database. Slot milik database yang sepi tidak pernah maju walaupun WAL klaster terus bertambah: slot `outbox_example` tertahan 6 MB dan terus naik. `lsn.flush.mode=connector_and_driver` tidak membantu. | Tanpa perbaikan, WAL menumpuk sampai `max_slot_wal_keep_size` lalu slot dibatalkan dan relay rusak. |
| Debezium Server hanya menyimpan posisi untuk record yang **sampai ke sink**. Record heartbeat yang dibuang dengan SMT `Filter` tidak memajukan slot. | Heartbeat harus dikirim ke sink, lalu dibuang di sisi RabbitMQ. |

## Keputusan

1. **Debezium Server dipakai** (spike berhasil). Relay polling di `libs/node` tersedia sebagai cadangan dan sudah diuji.
2. **Satu container relay per database ber-outbox**, dari satu image dan satu templat (`infra/debezium/application.properties` + `infra/debezium/relay.yml`). Yang berbeda hanya `RELAY_DB` dan `RELAY_SLOT`.
3. **Routing dua tahap:**
   - Debezium menerbitkan semua event ke exchange `outbox.relay` dengan routing key = `event_type` (record key dari Outbox Event Router).
   - `outbox.relay` diikat ke exchange domain dengan exchange-to-exchange binding yang dibangkitkan dari `routing.json` oleh container `rabbitmq-topologi`.
   - Event yang tidak terdaftar jatuh ke alternate exchange `outbox.unrouted` lalu tertampung di `q.outbox.unrouted`, jadi tercatat dan tidak hilang diam-diam. Pustaka juga menolak event tak terdaftar saat ditulis ke outbox, sebelum commit.
   - Skema tabel outbox tetap persis seperti laporan (tidak ada kolom tambahan).
4. **Tabel outbox, publication, dan slot dibuat saat init database** (`infra/postgres/init/_outbox.psql`) dengan urutan publication lalu slot. Akibatnya:
   - tidak ada event yang terlewat walaupun layanan menulis sebelum relay pertama kali menyala;
   - `snapshot.mode=no_data`: kehilangan berkas offset tidak menerbitkan ulang seluruh outbox lama;
   - publication menerbitkan `insert` (outbox) dan `update` (heartbeat). Baris outbox tidak pernah di-UPDATE, dan DELETE pembersihan tidak menjadi event.
5. **User `debezium`** hanya punya `LOGIN REPLICATION`, `CONNECT` per database ber-outbox, `SELECT` pada tabel outbox, dan `SELECT, INSERT, UPDATE` pada `debezium_heartbeat`.
6. `max_slot_wal_keep_size=1024MB` membatasi WAL yang ditahan slot milik relay yang mati lama.
7. **Heartbeat setiap 10 detik** supaya slot database yang sepi tetap maju:
   - `heartbeat.action.query` meng-update tabel `debezium_heartbeat` (ikut publication) di database relay itu sendiri;
   - kunci record heartbeat diubah menjadi nama database (SMT `ExtractField$Key`), sehingga routing key-nya satu kata tanpa titik;
   - `outbox.relay` diikat ke exchange `outbox.heartbeat` (tanpa queue) dengan pola `*`, sehingga heartbeat sampai ke sink (posisi tersimpan) lalu dibuang RabbitMQ. `event_type` selalu mengandung titik, jadi tidak pernah cocok dengan `*`.
   - Hasil: ketinggalan slot turun dari 6 MB (dan terus naik) menjadi di bawah 1 KB; `q.outbox.unrouted` tidak bertambah.
   - Volume yang dibuat sebelum 10 November perlu `infra/postgres/migrasi/2026-11-10-heartbeat-outbox.sql`.

## Hasil uji (lokal, Docker Desktop)

| Kriteria T0.3 | Hasil |
| --- | --- |
| Baris outbox muncul di exchange yang benar < 2 detik | 642 sampai 666 ms untuk `poem.submitted`, `report.created`, `case.decided`, `appeal.filed`, `user.registered` |
| Event tidak hilang ketika RabbitMQ mati sementara | 5 event ditulis saat RabbitMQ mati 20 detik; kelimanya tiba 15 detik setelah RabbitMQ hidup |
| Restart relay tidak menerbitkan ulang event lama | relay melanjutkan dari offset tersimpan; jumlah publish ke `q.example` tidak bertambah |
| `report.*`, `case.*`, `appeal.*` ke `moderation.events` | lolos |
| Event tak terdaftar | tertampung di `q.outbox.unrouted` (0 -> 1) |
| Relay polling cadangan | 3 event tiba, baris outbox terhapus setelah publisher confirm |

Uji bisa diulang dengan `docker compose exec example-consumer node scripts/uji-outbox.js`.

## Konsekuensi

- Satu komponen tambahan per database (sekitar 250 sampai 380 MB memori per container Debezium). Tahap demo punya 5 database ber-outbox (account, submission, revision, deletion, publication), jadi sekitar 1,5 sampai 2 GB. Bila memori EC2 tidak cukup, database tertentu dapat memakai relay polling tanpa mengubah kode layanan.
- Ada satu hop tambahan (`outbox.relay` lalu exchange domain) di dalam broker; biayanya kecil.
- Setiap perubahan `routing.json` wajib diikuti `docker compose run --rm rabbitmq-topologi`.
- Relay keluar (dan di-restart Docker) selama RabbitMQ mati; WAL tertahan di slot sampai relay pulih.
- Dalam mode Debezium, baris outbox tidak dihapus relay. Layanan menjalankan `bersihkanOutbox(pool)` secara berkala (misalnya setiap jam, menghapus baris lebih tua dari 24 jam).
- Relay polling dan Debezium tidak boleh berjalan bersamaan untuk database yang sama, karena event akan terbit ganda (tetap aman bagi konsumen idempoten, tetapi boros).

## Cara menambah relay untuk database baru

1. Di `infra/postgres/init/NN-<layanan>.sql`, setelah membuat database:

```sql
GRANT CONNECT ON DATABASE submission_db TO debezium;
\connect submission_db
\set pemilik poem_create
\set slot outbox_submission
\ir _outbox.psql
```

2. Di `infra/compose/<domain>.yml`:

```yaml
  outbox-relay-submission:
    extends: { file: debezium/relay.yml, service: outbox-relay }
    environment:
      RELAY_DB: submission_db
      RELAY_SLOT: outbox_submission
    volumes:
      - relay-submission-data:/debezium/data
    depends_on:
      rabbitmq-topologi: { condition: service_completed_successfully }
      poem-create-service: { condition: service_healthy }

volumes:
  relay-submission-data: {}
```

3. Layanan memanggil `jalankanMigrasi(pool, { folder, outbox: true })` dan menulis event dengan `simpanDenganOutbox`.
