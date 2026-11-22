# register-service (T1.1)

Registrasi akun. PJ: @MdAzka. Kelompok 1 (Akun dan identitas).

## Endpoint
| Metode | Path | Respons |
| --- | --- | --- |
| POST | `/api/auth/register` | 201 `{id, username}`; 400 input tidak valid; 409 username atau email sudah dipakai |
| GET | `/health` | 200 |

Aturan validasi: username 3 sampai 30 karakter (huruf, angka, garis bawah), email valid (disimpan huruf kecil), kata sandi minimal 8 karakter, nama tampil 1 sampai 50 karakter.

## Yang terjadi saat registrasi
1. Kata sandi di-hash dengan **Argon2id**.
2. Akun dan baris outbox `user.registered` ditulis dalam **satu transaksi**.
3. Outbox-relay (T0.3) mengirim event ke RabbitMQ. Layanan lain (login, profil, query) membuat salinan datanya dari event ini, tidak membaca `account_db`.

Payload `user.registered`: `id`, `username`, `display_name`, `password_hash`, `role` (selalu `writer` pada registrasi). Kata sandi asli tidak pernah masuk log atau payload.

## Variabel lingkungan
`SERVICE_NAME` (wajib, nama penerbit event), `PORT` (3000 di compose), `DATABASE_URL`, `RABBITMQ_*`.

## Menjalankan uji
```
npm install
npm test          # uji unit validasi (tanpa infrastruktur)
```
Uji integrasi (PostgreSQL dengan `wal_level=logical`, skrip `infra/postgres/init/10-register.sql` sudah dijalankan) memeriksa: registrasi berhasil, username ganda 409, baris outbox tertulis, dan kata sandi asli tidak tersimpan.

## Belum diuji di sini
- Container dengan Docker Compose dan event sampai ke RabbitMQ lewat relay Debezium.
- Uji integrasi dengan gateway asli (T0.4) dan T0.3, yang wajib lulus sebelum status Done.
