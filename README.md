# Puisi App

Platform komunitas puisi tempat penulis menerbitkan karya dan pembaca menemukan puisi yang sesuai dengan suasana hatinya. Dua ciri utamanya adalah pemilihan puisi menurut suasana hati (Mood) dan jaminan keaslian karya (Keaslian serta Laporan dan sengketa).

Proyek tugas Hands-On mata kuliah Pengembangan Perangkat Lunak Scalable (PACS262521), Kelompok D, dengan arsitektur microservice dan event-driven. Nama aplikasi masih sementara.

Rancangan lengkap ada di laporan "Rancangan Arsitektur Platform Publikasi Karya Sastra Puisi Scalable" dan halaman Notion "All Specifications".

## Arsitektur singkat

- Komunikasi sinkron hanya dari klien ke API Gateway (Nginx), lalu ke satu layanan. Perintah yang memicu proses asinkron membalas `202 Accepted`.
- Komunikasi antarlayanan selalu asinkron lewat RabbitMQ: satu topic exchange per domain, satu queue per layanan konsumen, masing-masing dengan DLQ.
- Satu basis data per layanan. Layanan lain memakai salinan lewat event.
- Layanan yang menulis data menerbitkan event dengan Transactional Outbox; outbox relay meneruskannya ke RabbitMQ.
- Konsumen idempoten (tabel `processed_event`) dan mengabaikan event dengan `aggregate_version` lebih lama.
- Sesi stateless: JWT RS256 di cookie httpOnly, diverifikasi gateway lewat `auth_request`.

## Teknologi

| Kebutuhan | Teknologi |
| --- | --- |
| Layanan API | Node.js |
| Worker analisis teks | Python |
| Basis data | PostgreSQL 16, MongoDB 7, Redis 7 |
| Message broker | RabbitMQ 4 (quorum queue, delayed message exchange) |
| Outbox relay | Debezium Server |
| Gerbang | Nginx |
| Penyimpanan gambar | Amazon S3 (MinIO di lokal) |
| Kontainer | Docker, Docker Compose |
| Frontend | Belum ditetapkan |

## Struktur repositori

```txt
services/<nama-layanan>        satu folder per layanan
libs/node, libs/python         pustaka bersama: amplop event, publisher, konsumen idempoten, outbox
contracts/events               skema JSON setiap event (pemilik: Zoya)
contracts/openapi              OpenAPI per layanan
frontend                       aplikasi web
infra/docker-compose.yml       compose induk: RabbitMQ, PostgreSQL, MongoDB, Redis, MinIO, Mailpit
infra/docker-compose.dev.yml   override laptop: port ke 127.0.0.1
infra/compose/<domain>.yml     layanan per domain, digabung lewat include
infra/postgres/init            NN-<layanan>.sql: database + user per layanan
infra/nginx/conf.d             rute gateway per domain
infra/rabbitmq                 image RabbitMQ + plugin
infra/observability            Prometheus, Loki, Grafana
docs                           catatan desain, ADR, runbook
```

Detail infrastruktur dan cara menambah layanan ada di [infra/README.md](infra/README.md).

## Menjalankan secara lokal

Prasyarat: Docker Desktop (atau Docker Engine) dengan Docker Compose v2.20 ke atas, serta Git.

```bash
git clone https://github.com/wisamWR/PuisiApp-Microservice.git
```

```bash
cd PuisiApp-Microservice
```

```bash
cp .env.example .env
```

```bash
docker compose up -d
```

Perintah dijalankan dari root repositori. Variabel `COMPOSE_FILE` di `.env` otomatis menggabungkan `infra/docker-compose.yml` dengan `infra/docker-compose.dev.yml`. Build pertama mengunduh image dan plugin RabbitMQ, jadi butuh beberapa menit.

Cek bahwa semua container berstatus `healthy`:

```bash
docker compose ps
```

| UI | Alamat | Login (dari `.env`) |
| --- | --- | --- |
| RabbitMQ management | http://localhost:15672 | `RABBITMQ_USER` / `RABBITMQ_PASS` |
| MinIO console | http://localhost:9001 | `S3_ACCESS_KEY` / `S3_SECRET_KEY` |
| Mailpit | http://localhost:8025 | - |

Berkas `.env` tidak boleh di-commit. Nilai di `.env.example` hanya untuk laptop.

Menghentikan semua container (data tetap tersimpan):

```bash
docker compose down
```

## Alur kerja Git

### Branch

Ada 10 branch tetap: `main` dan 9 branch kelompok fitur.

| Branch | Kelompok fitur | Penanggung jawab |
| --- | --- | --- |
| `main` | Integrasi dan rilis, diberi tag per milestone | PM (review dan merge) |
| `k1-akun` | 1. Akun dan identitas | Azka |
| `k2-penulisan` | 2. Penulisan puisi | Wisam |
| `k3-search` | 3. Jelajah dan baca | Azka |
| `k4-community` | 4. Komunitas | Zoya |
| `k5-mood` | 5. Mood | Sabila |
| `k6-theme` | 6. Tema | Sabila |
| `k7-auth` | 7. Keaslian (authorship dan plagiarisme) | Raffa |
| `k8-laporan` | 8. Laporan dan sengketa | Zoya |
| `k9-vote` | 9. Suara dan peringkat | Raffa |

`k7-auth` adalah Keaslian (authorship), bukan autentikasi. Autentikasi ada di `k1-akun`.

### Aturan

1. Kerjakan task kelompok langsung di branch kelompoknya; tidak perlu membuat branch baru. Awali setiap commit dengan kode task, misalnya `T2.1: validasi judul dan isi`. Jalankan `git pull --rebase` sebelum push.
2. Setiap hari kerja dan sebelum membuat PR, gabungkan `main` ke branch kelompok supaya perubahan kontrak, pustaka, dan infrastruktur cepat masuk. Konflik diselesaikan pemilik kelompok.
3. Hanya PM yang me-review dan me-merge ke `main`. Anggota membuat pull request lalu menunggu PM; tidak perlu approval dari anggota lain.
4. Branch kelompok diajukan ke `main` lewat PR **secara berkala**, minimal setiap Jumat, dan setiap kali kelompok lain membutuhkan hasilnya (event, endpoint, kontrak). Jangan menunggu sampai fitur lengkap di akhir: merge kecil yang sering mencegah konflik menumpuk di berkas bersama. Syarat merge: CI hijau dan uji integrasi kelompok lolos.
5. Task lintas kelompok dikerjakan di branch kelompok pemilik fitur: T1.6 (Sabila) di `k1-akun`, T3.4 (Raffa) di `k3-search`.
6. Task di luar kelompok (semua T0.x, T10.x, dan perubahan bersama pada `contracts/`, `libs/`, `infra/`) memakai branch pendek `T<kode>-<deskripsi>` (contoh `T0.3-outbox-relay`), diajukan ke `main` lewat PR, lalu branch dihapus setelah di-merge. Beri tahu Zoya bila mengubah `contracts/`.
7. Ubah berkas bersama hanya di bagian domain sendiri: `infra/compose/<domain>.yml`, `infra/nginx/conf.d/<domain>.conf`, `infra/nginx/routes/<domain>.conf`, `infra/postgres/init/NN-<layanan>.sql`.
8. PM memberi tag di `main` pada setiap milestone (PA3 dan seterusnya).

### Proteksi branch

| Branch | Aturan di GitHub |
| --- | --- |
| `main` | Wajib lewat pull request (tanpa minimal approval), hanya PM yang dapat merge, force push diblokir. Push langsung ditolak dengan pesan `GH013: Repository rule violations` |
| `k1` sampai `k9` | Tanpa aturan; setiap branch dikelola pemilik kelompoknya |

Bila push ke `main` ditolak, pindahkan commit ke branch baru lalu ajukan PR:

```bash
git switch -c T<kode>-<deskripsi>
```

```bash
git push -u origin T<kode>-<deskripsi>
```

```bash
git branch -f main origin/main
```
