# Puisi App

Platform komunitas puisi tempat penulis menerbitkan karya dan pembaca menemukan puisi yang sesuai dengan suasana hatinya. Dua ciri utamanya adalah pemilihan puisi menurut suasana hati (Mood) dan jaminan keaslian karya (Keaslian serta Laporan dan sengketa).

Proyek ini dibuat untuk tugas Hands-On mata kuliah Pengembangan Perangkat Lunak Scalable (PACS262521), Kelompok D, dengan arsitektur microservice dan event-driven. Nama aplikasi masih bersifat sementara.

## Arsitektur Singkat

- Komunikasi sinkron hanya dari klien ke API Gateway (Nginx), lalu ke satu layanan.
- Komunikasi antarlayanan berjalan secara asinkron melalui RabbitMQ.
- Setiap layanan memiliki basis datanya sendiri; layanan lain memakai salinan lewat event.
- Layanan yang menulis data menerbitkan event dengan pola Transactional Outbox.
- Sesi bersifat stateless: JWT di cookie httpOnly, diverifikasi gateway.

Rancangan lengkap dan spesifikasi per kelompok fitur ada di halaman Notion "All Specifications".

## Teknologi

| Kebutuhan | Teknologi |
| --- | --- |
| Layanan API | Node.js |
| Worker analisis teks | Python |
| Basis data | PostgreSQL 16, MongoDB 7, Redis 7 |
| Message broker | RabbitMQ 4 (quorum queue) |
| Outbox relay | Debezium Server |
| Gerbang | Nginx |
| Penyimpanan gambar | Amazon S3 |
| Frontend | Belum ditetapkan |
| Kontainer | Docker, Docker Compose |

## Struktur Repositori

```
services/<nama-layanan>   satu folder per layanan
libs/node, libs/python    pustaka bersama (event, outbox, konsumen idempoten)
contracts/events          skema JSON setiap event
frontend                  aplikasi web
infra                     docker-compose, nginx, rabbitmq, observability
docs                      catatan desain dan runbook
```

## Menjalankan Secara Lokal

Prasyarat: Docker dan Docker Compose.

```
git clone <url-repositori>
cd <nama-repositori>
cp .env.example .env
docker compose -f infra/docker-compose.yml up -d
```

Setelah semua kontainer berstatus healthy, antarmuka manajemen RabbitMQ dapat dibuka di `http://localhost:15672`.

Berkas `.env` berisi kredensial dan tidak boleh di-commit.

## Alur Kerja Git

Branch yang digunakan:

| Branch | Fungsi |
| --- | --- |
| `main` | Snapshot yang siap deploy. Diberi tag, misalnya `demo-v1`. Hanya menerima merge dari `develop`. |
| `develop` | Cabang integrasi. Semua pekerjaan masuk ke sini lewat pull request. |
| `grp<nomor>-<nama>` | Satu branch per kelompok fitur, dimiliki penanggung jawabnya. |

Branch kelompok fitur:

| Branch | Kelompok fitur | Penanggung jawab |
| --- | --- | --- |
| `grp1-akun` | Akun dan identitas | Azka |
| `grp2-penulisan` | Penulisan puisi | Wisam |
| `grp3-jelajah` | Jelajah dan baca | Azka |
| `grp4-komunitas` | Komunitas | Zoya |
| `grp5-mood` | Mood | Sabila |
| `grp6-tema` | Tema | Sabila |
| `grp7-keaslian` | Keaslian | Raffa |
| `grp8-moderasi` | Laporan dan sengketa | Zoya |
| `grp9-suara` | Suara dan peringkat | Raffa |

Aturan:

1. Gabungkan `develop` ke branch kelompok setiap hari agar tidak tertinggal.
2. Buat pull request ke `develop` setiap satu task selesai, tanpa menunggu seluruh kelompok selesai.
3. Pull request wajib lolos CI dan di-review minimal satu orang.
4. Gunakan merge commit, bukan squash, agar riwayat branch kelompok tetap selaras dengan `develop`.
5. Cantumkan kode task di judul pull request dan pesan commit, misalnya `[T2.1] poem-create: validasi input`.
6. Perubahan pada `contracts/` memerlukan persetujuan pemilik kelompok yang menggunakan kontrak tersebut. Perubahan tidak kompatibel menaikkan versi skema.

## Definisi Selesai untuk Setiap Layanan

- Kode lolos lint dan pengujian unit.
- Pengujian integrasi dengan RabbitMQ dan basis data berjalan lewat Docker Compose.
- Konsumen diuji terhadap event duplikat dan event basi.
- Tersedia endpoint `/health` dan `/metrics`, serta log JSON.
- Endpoint terdokumentasi dengan OpenAPI dan skema event terdaftar di `contracts/`.
- Layanan berjalan dengan `docker compose up` tanpa langkah manual.

## Tim

Kelompok D: Wisam, Azka, Sabila, Raffa, dan Zoya.
