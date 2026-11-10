# API Gateway Nginx (T0.4)

Satu-satunya pintu masuk sistem. Hanya gateway yang memetakan port ke host.
PJ: @MdAzka.

## Struktur
| Berkas | Isi |
| --- | --- |
| `nginx.conf` | Pengaturan umum, zona rate limit (login 10 per menit per IP), zona cache (auth 30 detik, feed 3 detik), resolver DNS Docker |
| `docker-entrypoint.sh` | Merender alamat layanan dari variabel lingkungan, lalu menjalankan nginx |
| `templates/vars.conf.template` | Variabel `$up_*` berisi alamat layanan (dari `.env`) |
| `conf.d/gateway.conf` | Server utama: verifikasi token (`/_auth`), `/health`, respons 401, rute frontend |
| `conf.d/stub-auth.conf` | Stub verifikasi token untuk pengembangan. Hapus setelah token-service (T1.2) dipakai |
| `routes/<domain>.conf` | Lokasi per domain. Setiap kelompok menambah berkasnya sendiri |
| `common/proxy-headers.conf` | Header proxy bersama |
| `tests/` | Uji perilaku gateway tanpa Docker |

### Mengapa `routes/` terpisah dari `conf.d/`
Spesifikasi menulis satu berkas `conf.d/<domain>.conf` berisi upstream dan location. Nginx tidak mengizinkan `location` di luar blok `server`, jadi lokasi ditaruh di `routes/` dan di-include dari server. `conf.d/` hanya berisi blok `server`.

### Mengapa alamat dibaca saat request
Upstream dengan nama host di-resolve saat nginx start. Layanan yang belum ada akan membuat gateway gagal start. Dengan variabel dan resolver Docker, gateway tetap hidup, dan request ke layanan yang belum ada hanya mengembalikan 502.

## Rute domain Akun (kelompok 1)
| Metode | Path | Akses |
| --- | --- | --- |
| POST | /api/auth/register | publik |
| POST | /api/auth/login | publik, 10 per menit per IP |
| POST | /api/auth/refresh | publik (cookie refresh) |
| POST | /api/auth/logout | wajib login |
| POST | /api/auth/verify-email | publik |
| POST | /api/auth/forgot-password, /api/auth/reset-password | publik |
| GET, PUT | /api/profiles/me | wajib login |
| GET | /api/profiles/{id} | publik, hanya GET |
| DELETE | /api/me | wajib login |

## Keamanan header
Gateway selalu menimpa `X-User-Id` dan `X-User-Role`. Pada rute publik nilainya dikosongkan. Pada rute yang butuh login diisi dari hasil verifikasi token. Klien tidak bisa memalsukannya.

## Variabel lingkungan
Lihat blok "API gateway (T0.4)" di `.env.example`. Nama variabel adalah `FRONTEND_HOST`, `REGISTER_HOST`, `LOGIN_HOST`, `PROFILE_HOST`, `RECOVERY_HOST`, dan `AUTH_HOST`. Sebelum token-service ada, `AUTH_HOST=127.0.0.1:8099` menunjuk ke stub di dalam gateway sendiri.

## Menjalankan pengujian
Dari root repositori (butuh `nginx` dan `envsubst`):
```
bash infra/nginx/tests/run-gateway-tests.sh
bash infra/nginx/tests/run-tests.sh
```
Hasil yang diharapkan: `RINGKASAN: lulus=18 gagal=0`.

## Belum diuji
- Rute feed dan vote milik kelompok lain. Zonanya sudah disiapkan dan diuji dengan rute sementara.
- Uji dari host dengan Docker Compose. Menunggu layanan lain dan sudah ada T0.1 di repo.
