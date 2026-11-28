# Runbook deploy PuisiApp ke EC2

Draf dari latihan deploy T0.9. T10.4 melanjutkannya untuk aplikasi lengkap, dan T10.7 untuk deploy terdistribusi.

Lab AWS Academy dimatikan sekitar 3 jam dan menghapus semua sumber daya saat direset, jadi deploy harus bisa diulang cepat dari image siap pakai di GHCR. **Target: deploy ulang dari nol di bawah 30 menit.**

## Yang di-deploy (T0.9)

| Komponen | Image |
| --- | --- |
| api-gateway | `ghcr.io/wisamwr/puisiapp-api-gateway` |
| rabbitmq (+ plugin delayed message) | `ghcr.io/wisamwr/puisiapp-rabbitmq` |
| rabbitmq-topologi (sekali jalan) | `ghcr.io/wisamwr/puisiapp-node-tools` |
| example-consumer (layanan contoh) | `ghcr.io/wisamwr/puisiapp-example-consumer` |
| postgres | `postgres:16.15-alpine` (resmi) |

Image didorong otomatis oleh `.github/workflows/publish.yml` setiap merge ke `main`, dengan tag `main` (terbaru) dan `sha-<commit>` (untuk rollback).

## Persiapan satu kali

1. **Visibilitas image GHCR.** Image yang didorong pertama kali bersifat privat. Untuk setiap paket `puisiapp-*` di https://github.com/wisamWR?tab=packages, buka **Package settings → Change visibility → Public**. Bila ingin tetap privat, EC2 harus login ke GHCR dengan personal access token berhak `read:packages` (lihat bagian "Image privat").
2. **Berkas `.env.production`** disimpan di luar repositori (misalnya di catatan pribadi tim). Salin dari `.env.example` lalu ubah:

| Variabel | Nilai produksi |
| --- | --- |
| `COMPOSE_FILE` | `infra/docker-compose.prod.yml` |
| `COMPOSE_PROJECT_NAME` | `puisiapp` |
| `GATEWAY_BIND` | `0.0.0.0` |
| `GATEWAY_HOST_PORT` | `80` |
| `IMAGE_TAG` | `main` (atau `sha-xxxxxxx`) |
| `CONTOH_HOST` | `example-consumer:8080` |
| semua `*_PASS`, `POSTGRES_PASSWORD`, `RABBITMQ_PASS` | kata sandi acak baru, bukan `*_dev_only` |

## Langkah deploy

Catat waktu setiap langkah di tabel "Catatan latihan" di bawah.

### 1. Buat instans EC2

Di AWS Academy Learner Lab, **Start Lab** lalu buka konsol AWS → EC2 → **Launch instance**:

- AMI: Amazon Linux 2023
- Tipe: `t3.medium` (4 GB) cukup untuk T0.9; `t3.large` (8 GB) untuk aplikasi lengkap (T10.4)
- Key pair: buat atau pilih yang sudah ada
- Security group: SSH 22 dari IP tim saja, HTTP 80 dari mana saja
- IAM instance profile: `LabInstanceProfile` (dipakai nanti untuk akses S3)
- Penyimpanan: 20 GB

### 2. Pasang Docker

```bash
ssh -i <kunci>.pem ec2-user@<IP-publik>
```

```bash
curl -fsSL https://raw.githubusercontent.com/wisamWR/PuisiApp-Microservice/main/infra/setup.sh | bash
```

```bash
exit
```

SSH ulang supaya grup `docker` aktif.

### 3. Ambil repositori dan konfigurasi

```bash
git clone --depth 1 https://github.com/wisamWR/PuisiApp-Microservice.git puisiapp
```

```bash
cd puisiapp
```

Salin isi `.env.production` ke berkas `.env` di root repositori (misalnya `nano .env`, lalu tempel).

### 4. Tarik image dan jalankan

```bash
docker compose pull
```

```bash
docker compose up -d
```

```bash
docker compose ps
```

Tunggu sampai semua berstatus `healthy` (dan `rabbitmq-topologi` berstatus `exited (0)`).

### 5. Uji

Dari browser atau laptop:

```bash
curl http://<IP-publik>/health
```

```bash
curl http://<IP-publik>/api/contoh/health
```

Keduanya harus menjawab 200. Lalu uji satu event terbit dan terkonsumsi, dari dalam EC2:

```bash
docker compose exec example-consumer node scripts/kirim-contoh.js
```

```bash
docker compose logs --tail 20 example-consumer
```

Log harus memuat `puisi contoh disimpan` dan `event duplikat diabaikan`.

### 6. Matikan

```bash
docker compose down
```

Lalu **End Lab** di AWS Academy. Untuk latihan kedua, ulangi dari langkah 1 dan catat waktunya.

## Rollback

Ganti `IMAGE_TAG` di `.env` dengan tag lama (`sha-xxxxxxx`, lihat tab Packages di GitHub), lalu:

```bash
docker compose pull
```

```bash
docker compose up -d
```

## Failover PostgreSQL

Primary `postgres` punya standby `postgres-replica` (streaming replication).
Saat primary mati, GET poem-query dan mood-feed tetap dilayani replika, tetapi
semua tulis gagal sampai failover.

**Cek kondisi replikasi** (primary hidup):

```bash
docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d postgres -c "select application_name, state, replay_lag from pg_stat_replication"'
```

**Failover** (primary mati dan tidak bisa segera dihidupkan). Dari root repositori, Git Bash:

```bash
bash infra/postgres/failover.sh
```

Bila stack dinyalakan dengan argumen compose lain, teruskan lewat `COMPOSE`, mis.
`COMPOSE="docker compose -p puisidb --env-file .env -f infra/docker-compose.yml" bash infra/postgres/failover.sh`.

Skrip menghapus container primary lama (volume `pg-data` tetap ada), mempromosikan
replika, memindahkan alias jaringan `postgres` ke replika (layanan tidak perlu
diubah atau di-restart), mereset offset Debezium, lalu menguras outbox sejak
10 menit sebelum transaksi terakhir yang diterima replika (`MARGIN_MENIT`).
Hasil uji: 23 detik (`docs/reliability/hasil-uji-database.md`).

Yang perlu diketahui:

- Replikasi asinkron: transaksi yang belum sampai ke replika saat primary mati hilang (biasanya < 1 detik terakhir).
- Setelah failover **jangan** menjalankan `docker compose up` untuk service `postgres`: container baru akan memakai nama `postgres` juga (split brain). Lakukan failback di bawah.
- Image `puisiapp/node-tools:dev` dipakai untuk menguras outbox. Bila tag ini juga dipakai worktree atau stack lain, jalankan `docker compose build rabbitmq-topologi` dulu agar berisi kode cabang yang sama.
- Health check `postgres-replica` sengaja `unhealthy` setelah promote (bukan standby lagi).

**Failback** (jendela perawatan, belum diotomatisasi):

1. Hentikan layanan tulis dan semua `outbox-relay-*`.
2. Hapus volume `pg-data` lama (isinya sudah tertinggal dari primary baru).
3. Bangun ulang `postgres` sebagai standby dari `postgres-replica` (pola `replika-entrypoint.sh` dengan `PRIMARY_HOST=postgres-replica`), tunggu sampai `streaming`.
4. Promote `postgres`, kembalikan alias jaringan, lalu bangun ulang `postgres-replica` dari volume kosong.
5. Jalankan langkah 5 dan 6 `failover.sh` (reset offset relay, kuras outbox).

**Replika tertinggal terlalu jauh** (alert `PostgresReplicationSlotNearInvalidation` untuk `replika_1`, atau slot sudah `lost`): bangun ulang replika.

```bash
docker compose rm -sf postgres-replica
```

```bash
docker volume rm <proyek>_pg-replica-data
```

```bash
docker compose up -d postgres-replica
```

**Slot outbox tidak aktif** (alert `PostgresReplicationSlotInactive` untuk `outbox_*`): nyalakan relay-nya. Bila Debezium tidak bisa dijalankan, kuras sementara dengan relay polling:

```bash
docker compose run --rm --no-deps -e DATABASE_URL=postgres://<user>:<pass>@postgres:5432/<db> -e RELAY_SEJAK=<waktu relay mati, ISO UTC> -e RELAY_SEKALI=1 rabbitmq-topologi node bin/relay-polling.js
```

Isi `RELAY_SEJAK`: Debezium tidak menghapus baris outbox, jadi tanpa batas waktu seluruh riwayat outbox diterbitkan ulang (aman karena idempoten, tetapi membanjiri queue).

## Image privat

Bila paket GHCR tidak dibuat publik, sebelum `docker compose pull`:

```bash
echo <PAT-read:packages> | docker login ghcr.io -u <username-github> --password-stdin
```

Jangan menyimpan token di repositori atau di riwayat shell bersama.

## Catatan latihan (T0.9)

Isi setelah setiap latihan. Waktu dalam menit.

| Langkah | Percobaan 1 | Percobaan 2 |
| --- | --- | --- |
| 1. Start Lab dan buat EC2 sampai bisa SSH | | |
| 2. `setup.sh` | | |
| 3. Clone dan `.env` | | |
| 4. `pull` dan `up` sampai semua healthy | | |
| 5. Uji `/health`, `/api/contoh/health`, event | | |
| **Total** | | |

### Masalah yang ditemui

| Masalah | Penyebab | Solusi / task baru |
| --- | --- | --- |
| | | |
