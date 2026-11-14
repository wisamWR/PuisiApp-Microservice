# PuisiApp Node.js Service Template

Template dasar untuk membangun layanan microservice berbasis Node.js pada proyek PuisiApp.

## 1. Requirements

Perangkat dan teknologi yang dibutuhkan:

- Node.js versi 24 atau lebih baru
- npm
- Docker (opsional, untuk menjalankan service dalam container)
- PostgreSQL (opsional, untuk menggunakan fitur database dan migrasi)

## 2. Struktur Direktori

```text
_template-node/
├── src/
│   ├── config.js
│   └── main.js
├── tests/
│   └── health.test.js
├── Dockerfile
├── eslint.config.js
├── package.json
├── package-lock.json
└── README.md
```

Service menggunakan shared library `@puisiapp/events` yang tersedia di `libs/node` untuk memanfaatkan fungsi bersama seperti logging dan migrasi database.

## 3. Installation

Masuk ke direktori template:

```bash
cd services/_template-node
```

Install seluruh dependencies:

```bash
npm ci
```

Dependency `@puisiapp/events` menggunakan local package dari `../../libs/node`.

Ketika template disalin menjadi service baru di dalam direktori `services/`, pastikan struktur repository tetap dipertahankan agar referensi dependency tersebut tetap valid.

## 4. Environment Configuration

Service menggunakan environment variables untuk mengatur konfigurasi dan koneksi ke dependency.

| Variable     | Keterangan                         | Default      |
| ------------ | ---------------------------------- | ------------ |
| SERVICE_NAME | Nama service                       | node-service |
| HOST         | Host server                        | 0.0.0.0      |
| PORT         | Port server                        | 8080         |
| DATABASE_URL | URL koneksi PostgreSQL             | Tidak ada    |
| AMQP_URL     | URL koneksi RabbitMQ               | Tidak ada    |
| REDIS_URL    | URL koneksi Redis                  | Tidak ada    |
| S3_ENDPOINT  | Endpoint penyimpanan S3-compatible | Tidak ada    |
| SMTP_HOST    | Alamat SMTP server                 | Tidak ada    |

Konfigurasikan environment variables sesuai kebutuhan service. Jangan menyimpan credential atau connection string sensitif secara langsung di dalam source code.

## 5. Running the Service

Jalankan service menggunakan perintah:

```bash
npm start
```

Secara default, service berjalan pada port `8080`.

### Health Check Endpoint

Service menyediakan endpoint:

```http
GET /health
```

Contoh response:

```json
{
  "status": "ok",
  "service": "node-service"
}
```

Endpoint `/health` mengembalikan HTTP 200 apabila service berjalan dengan baik. Endpoint yang tidak tersedia akan mengembalikan HTTP 404.

## 6. Shared Library and Database Migration

Template menggunakan shared library `@puisiapp/events` dari direktori `libs/node`.

Fungsi yang digunakan:

- `buatLogger()` untuk membuat logger service.
- `jalankanMigrasi()` untuk menjalankan migrasi database menggunakan shared library.

Apabila `DATABASE_URL` dikonfigurasi, service akan membuat koneksi PostgreSQL dan menjalankan `jalankanMigrasi()` ketika service dimulai.

Apabila `DATABASE_URL` tidak dikonfigurasi, proses migrasi database dilewati.

Contoh penggunaan:

```javascript
import pg from "pg";
import { buatLogger, jalankanMigrasi } from "@puisiapp/events";

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const log = buatLogger("node-service");

await jalankanMigrasi(pool, { log });
```

Pengelolaan migrasi dilakukan melalui shared library sehingga service tidak perlu menyediakan implementasi migrasi database sendiri.

## 7. Testing and Code Quality

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

## 8. Docker

Build Docker image dari direktori root repository:

```bash
docker build -f services/_template-node/Dockerfile -t puisiapp-node-service .
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

Container menggunakan healthcheck untuk memantau kondisi service secara berkala.

## 9. Development Guidelines

Beberapa ketentuan yang perlu diperhatikan ketika mengembangkan service:

- Gunakan environment variables untuk konfigurasi service dan dependency.
- Gunakan shared library `@puisiapp/events` untuk fungsi bersama yang sudah tersedia.
- Hindari membuat implementasi logging dan migrasi database yang duplikat.
- Hindari hardcode alamat container atau host dependency.
- Pertahankan endpoint `/health` untuk kebutuhan healthcheck.
- Tambahkan unit test untuk setiap fitur baru.
- Jalankan ESLint, Prettier, dan unit test sebelum membuat Pull Request.
- Jangan menyimpan credential atau informasi sensitif di dalam repository.
