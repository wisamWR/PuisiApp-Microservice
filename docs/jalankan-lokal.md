# Menjalankan PuisiApp secara lokal

Seluruh aplikasi (29 container) berjalan dengan Docker Compose dari branch `main`.

## Prasyarat

- Docker Desktop menyala, Docker Compose v2.20 ke atas
- Git
- RAM minimal sekitar 8 GB
- Internet untuk build pertama (10–20 menit, mengunduh base image)

## Langkah

Jalankan di PowerShell (Windows). Di macOS/Linux, ganti `Copy-Item` dengan `cp` dan `Add-Content` dengan `echo ... >> .env`.

```powershell
git clone https://github.com/wisamWR/PuisiApp-Microservice.git
cd PuisiApp-Microservice
Copy-Item .env.example .env
```

Khusus Windows: port 5432 sering diblokir Windows atau dipakai PostgreSQL lokal, jadi pindahkan ke 5433.

```powershell
Add-Content .env "POSTGRES_HOST_PORT=5433"
```

Build dan jalankan:

```powershell
docker compose up -d --build
docker compose ps
```

Semua container harus `healthy`, kecuali `rabbitmq-topologi` yang memang `Exited (0)` (hanya jalan sekali untuk membuat topologi RabbitMQ).

Buka http://localhost:8080, lalu daftar akun, masuk, pilih mood, dan tulis puisi.

## Alamat lain

| Layanan | Alamat | Keterangan |
| --- | --- | --- |
| Aplikasi | http://localhost:8080 | lewat api-gateway |
| RabbitMQ UI | http://localhost:15672 | user dan password: `RABBITMQ_USER`/`RABBITMQ_PASS` di `.env` |
| Mailpit | http://localhost:8025 | email verifikasi dan reset kata sandi |
| MinIO console | http://localhost:9001 | gambar puisi (pengganti S3) |

## Masalah umum

| Gejala | Solusi |
| --- | --- |
| `docker compose up` gagal dengan "unhealthy" pada start pertama | Postgres belum selesai init. Jalankan ulang `docker compose up -d` |
| `ports are not available ... 5432` | Tambahkan `POSTGRES_HOST_PORT=5433` ke `.env` |
| Port 8080 sudah dipakai | Tambahkan `GATEWAY_HOST_PORT=8081` ke `.env`, buka http://localhost:8081 |
| `lookup registry-1.docker.io: no such host` | Internet atau DNS bermasalah, perbaiki koneksi lalu ulangi |
| Login hilang setelah layanan di-restart | Kunci JWT dibuat sementara. Agar tetap, jalankan `bash infra/jwt-keys.sh` (Git Bash) lalu `docker compose up -d` |

## Mematikan

```powershell
docker compose down      # data tetap tersimpan
docker compose down -v   # hapus semua data, mulai dari nol
```

## Catatan

- Layanan tahap Lengkap (edit dan hapus puisi) hanya jalan dengan `docker compose --profile lengkap up -d`.
- Fitur yang belum di-merge ke `main` belum bisa dicoba.
- Setelah `git pull`, jalankan `docker compose up -d --build` agar image ikut diperbarui.
