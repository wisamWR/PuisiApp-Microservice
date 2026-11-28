# Hasil Uji Perbaikan Poin Kritis Database (D1–D8)

Branch `fix/database` (dasar `main` 8ed9286), 27 November 2026. Semua uji
dijalankan di stack compose terpisah:

```
docker compose -p puisidb --env-file .env -f infra/docker-compose.yml ...
```

## Ringkasan perubahan

| Task | Perubahan | Berkas utama |
|------|-----------|--------------|
| D1 | Pool PostgreSQL dibatasi di semua layanan: `connectionTimeoutMillis` 2 dtk, `statement_timeout` 5 dtk, **`query_timeout`** (batas di sisi klien), `pool.on('error')` | `services/*/src/index.js`, `account-recovery-service/src/main.js` |
| D2 | `GET /health/ready` yang menjalankan `SELECT 1`; healthcheck compose memakai endpoint ini | login, register, profile, account-recovery, mood-feed; `infra/compose/identity.yml`, `analysis.yml` |
| D3 | Role `replicator`, slot fisik `replika_1`, aturan `pg_hba` replikasi | `infra/postgres/init/02-replikasi.sh`, `migrasi/2026-11-27-replikasi.sh` |
| D4 | Service `postgres-replica` (hot standby, `pg_basebackup -R`), `wal_level=logical` agar siap jadi primary | `infra/docker-compose.yml`, `infra/postgres/replika-entrypoint.sh` |
| D5 | `buatPoolBaca`: GET ke replika, cadangan ke primary + jeda 30 dtk | `libs/node/src/pool-baca.js`; poem-query, mood-feed |
| D6 | Alert slot replikasi; relay polling mode kuras (`RELAY_SEJAK`, `RELAY_SEKALI`) | `infra/observability/prometheus_alerts.yml`, `libs/node/bin/relay-polling.js` |
| D7 | Skrip failover + runbook | `infra/postgres/failover.sh`, `docs/runbook.md` |
| Lain | Duplikat service `mailpit` di `compose/identity.yml` dihapus (membuat `docker compose` di `main` gagal memuat konfigurasi) | `infra/compose/identity.yml` |

## Uji D1–D2: DB tidak menjawab (`docker compose pause postgres`)

| Pemeriksaan | Sebelum `query_timeout` | Sesudah |
|-------------|-------------------------|---------|
| `/health/ready` 5 layanan | menggantung tanpa batas | 503 dalam 2–6 dtk |
| `POST /api/auth/login` | menggantung | gagal dalam ~2 dtk (500) |
| `GET /api/feed/mood/senang` | - | 200 dalam 72 ms (dari indeks Redis) |
| Status container | - | `unhealthy`, `RestartCount=0` |
| Setelah `unpause` | - | `healthy` lagi dalam ~10 dtk tanpa restart |

Temuan: `statement_timeout` dijalankan server, sehingga tidak berlaku saat server
beku. `connectionTimeoutMillis` hanya untuk koneksi baru. Tanpa `query_timeout`
query di koneksi idle menunggu selamanya.

## Uji D3–D5: replika baca

| Skenario | Hasil |
|----------|-------|
| Replikasi | `pg_stat_replication` = `streaming`, slot `replika_1` aktif, baris baru di primary langsung terbaca di replika |
| Arah baca | koneksi `poem_query` dan `mood_feed` ada di replika setelah GET |
| `stop postgres` | `GET /api/poems` 200 (87 ms), readiness 200, container tetap `healthy` |
| `stop postgres-replica` | request pertama 200 dalam 2,1 dtk, berikutnya 64–129 ms (primary); satu log "baca dialihkan ke primary" |
| Replika hidup lagi | kembali `streaming`, layanan tidak restart |

## Uji D6–D8: failover

Skenario: stack `postgres`, `postgres-replica`, `poem-create-service`,
`outbox-relay-submission`, `poem-query-service`.

1. Ajukan puisi: masuk read model poem-query (jalur normal).
2. `stop outbox-relay-submission`, ajukan puisi `celah3`: event hanya ada di
   tabel outbox (meniru Debezium yang tertinggal saat primary mati).
3. `kill postgres`: pengajuan baru gagal 500 dalam ~2 dtk.
4. `bash infra/postgres/failover.sh`.

| Pemeriksaan | Hasil |
|-------------|-------|
| Durasi skrip failover | **23 dtk** |
| Promote | `pg_is_in_recovery()` = `f` |
| Alias `postgres` | menunjuk ke replika; poem-create dan poem-query tidak di-restart |
| Event celah (`celah3`) | terkirim lewat kuras outbox (`jumlah: 1`) dan muncul di read model |
| Pengajuan setelah failover | 202, sampai read model lewat slot Debezium baru |
| Alert | `promtool check rules`: 11 rules valid (3 baru di grup `postgres_replication`) |

Nama metrik alert dicek langsung dari postgres-exporter v0.16.0:
`pg_replication_slot_slot_is_active`, `pg_replication_slot_safe_wal_size_bytes`
(label `slot_name`).

## Batasan yang tersisa

- Replikasi asinkron: transaksi terakhir yang belum sampai ke replika hilang saat failover.
- Failover manual (operator menjalankan skrip). Failback belum diotomatisasi, hanya langkah di runbook.
- Login dan layanan identitas membalas 500 (bukan 503) saat DB mati.
- `docker-compose.prod.yml` belum memuat replika (layanan lain masih menunggu T10.4).
- Skrip migrasi untuk volume lama (`migrasi/2026-11-27-replikasi.sh`) belum diuji.
- Tag image `puisiapp/node-tools:dev` dipakai bersama oleh semua stack/worktree. Saat uji, tag ini tertimpa build lain sehingga relay kuras berjalan tanpa kode baru. Bangun ulang (`docker compose build rabbitmq-topologi`) sebelum failover.
- Semua replika di satu host: tidak melindungi dari host EC2 mati.
