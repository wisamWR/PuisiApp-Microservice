\# PuisiApp Node.js Service Template

Template dasar untuk membangun layanan microservice berbasis Node.js pada proyek PuisiApp.

\## 1. Requirements

Perangkat dan teknologi yang dibutuhkan:

\- Node.js versi 24 atau lebih baru

\- npm

\- Docker (opsional, untuk menjalankan service dalam container)

\- PostgreSQL (opsional, untuk menggunakan fitur database dan migrasi)

\## 2. Struktur Direktori

```text

\_template-node/

├── migrations/

│   ├── 001\_processed\_event.sql

│   └── 002\_outbox.sql

├── src/

│   ├── config.js

│   ├── database.js

│   └── main.js

├── tests/

│   └── health.test.js

├── Dockerfile

├── eslint.config.js

├── package.json

└── README.md

```

\## 3. Installation

Masuk ke direktori template:

```bash

cd services/\_template-node

```

Install seluruh dependencies:

```bash

npm ci

```

\## 4. Environment Configuration

Service menggunakan environment variables untuk mengatur konfigurasi dan koneksi ke dependency.

| Variable | Keterangan | Default |

|---|---|---|

| SERVICE\_NAME | Nama service | node-service |

| HOST | Host server | 0.0.0.0 |

| PORT | Port server | 8080 |

| DATABASE\_URL | URL koneksi PostgreSQL | Tidak ada |

| AMQP\_URL | URL koneksi RabbitMQ | Tidak ada |

| REDIS\_URL | URL koneksi Redis | Tidak ada |

| S3\_ENDPOINT | Endpoint penyimpanan S3-compatible | Tidak ada |

| SMTP\_HOST | Alamat SMTP server | Tidak ada |

Konfigurasikan environment variables sesuai lingkungan deployment. Jangan menyimpan credential atau connection string sensitif secara langsung di dalam source code.

\## 5. Running the Service

Jalankan service menggunakan perintah:

```bash

npm start

```

Secara default, service berjalan pada port `8080`.

\### Health Check Endpoint

Service menyediakan endpoint:

```http

GET /health

```

Contoh response:

```json

{

&#x20; "status": "ok",

&#x20; "service": "node-service"

}

```

Endpoint `/health` mengembalikan HTTP 200 apabila service berjalan dengan baik. Endpoint yang tidak tersedia akan mengembalikan HTTP 404.

\## 6. Database Migrations

Template menyediakan dua file migration:

\- `001\_processed\_event.sql`: membuat tabel `processed\_event` untuk mencatat event yang telah diproses.

\- `002\_outbox.sql`: membuat tabel `outbox` untuk menyimpan event yang akan dipublikasikan.

Sebelum menjalankan migration, pastikan environment variable `DATABASE\_URL` sudah dikonfigurasi dan database PostgreSQL dapat diakses.

Jalankan seluruh migration menggunakan perintah:

```bash

node --input-type=module -e "import { runMigrations } from './src/database.js'; console.log(await runMigrations());"

```

Untuk membuat PostgreSQL publication `outbox\_pub` setelah migration:

```bash

node --input-type=module -e "import { runMigrations } from './src/database.js'; console.log(await runMigrations({ createPublication: true }));"

```

Migration yang telah berhasil dijalankan akan dicatat dalam tabel `schema\_migrasi`, sehingga tidak dijalankan ulang pada eksekusi berikutnya.

Pembuatan publication membutuhkan konfigurasi PostgreSQL dan hak akses yang sesuai.

\## 7. Testing and Code Quality

Jalankan unit test:

```bash

npm test

```

Jalankan pemeriksaan kode menggunakan ESLint:

```bash

npm run lint

```

Periksa konsistensi format kode menggunakan Prettier:

```bash

npm run format:check

```

Pastikan seluruh pemeriksaan berhasil sebelum melakukan Pull Request.

\## 8. Docker

Build Docker image dari direktori root repository:

```bash

docker build -f services/\_template-node/Dockerfile -t puisiapp-node-service .

```

Jalankan container:

```bash

docker run -d --name puisiapp-node-service -p 8080:8080 puisiapp-node-service

```

Periksa endpoint health:

```bash

curl http://localhost:8080/health

```

Periksa status Docker healthcheck:

```bash

docker inspect --format='{{.State.Health.Status}}' puisiapp-node-service

```

Container akan menggunakan healthcheck untuk memantau kondisi service secara berkala.

\## 9. Development Guidelines

Beberapa ketentuan yang perlu diperhatikan ketika mengembangkan service:

\- Gunakan environment variables untuk konfigurasi service dan dependency.

\- Hindari hardcode alamat container atau host dependency.

\- Pertahankan endpoint `/health` untuk kebutuhan healthcheck.

\- Tambahkan file migration baru dengan penamaan berurutan.

\- Tambahkan unit test untuk setiap fitur baru.

\- Jalankan ESLint, Prettier, dan unit test sebelum membuat Pull Request.

\- Jangan menyimpan credential atau informasi sensitif di dalam repository.
