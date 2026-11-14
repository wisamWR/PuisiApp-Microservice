# k1-akun: Akun dan Identitas

Branch: `k1-akun` | Penanggung jawab: Azka | Task: T1.1 sampai T1.7 | Frontend: halaman Daftar, Masuk, dan Profil

## Cakupan

Registrasi, autentikasi stateless (JWT), pengelolaan profil, pemulihan akun, serta peran pengguna. Layanan identitas menjadi dasar semua kelompok lain karena gateway memverifikasi sesi melalui `token-service`.

## Layanan dan Komponen

| Layanan | Tipe | Data | Task |
| --- | --- | --- | --- |
| register-service | API | account-db (PostgreSQL) + outbox | T1.1 |
| login-service | API | credential-db (PostgreSQL), salinan kredensial dari event | T1.2 |
| token-service | API | token-store (Redis): refresh token dan daftar cabut | T1.2, T1.4 |
| profile-service | API | profile-db (PostgreSQL) + outbox | T1.5 |
| account-recovery-service, email-worker | API, worker | recovery-db | T1.6 |
| peran dan hapus akun | API | account-db | T1.7 |

## Endpoint

| Metode | Path | Keterangan |
| --- | --- | --- |
| POST | `/api/auth/register` | 201; username unik dan validasi email |
| POST | `/api/auth/login` | 200; set cookie access dan refresh |
| POST | `/api/auth/refresh` | rotasi refresh token; token lama langsung dicabut |
| POST | `/api/auth/logout` | 204; refresh token dicabut, `jti` access token masuk daftar cabut |
| GET | `/internal/auth/verify` | hanya untuk `auth_request` gateway; membalas 200 dengan `X-User-Id` dan `X-User-Role`, atau 401 |
| GET, PUT | `/api/profiles/{id\|me}` | nama tampil dan bio |
| PUT | `/api/admin/users/{id}/role` | ubah peran (admin) |
| DELETE | `/api/me` | hapus akun sendiri |

## Event

| Event | Peran | Catatan |
| --- | --- | --- |
| `user.registered` | publish (register) | konsumen: login, profile, poem-query |
| `user.profile.updated` | publish (profile) | konsumen: poem-query |
| `user.role.changed`, `user.deleted` | publish | event baru; daftarkan skema di `/contracts/events` |
| `user.registered` | consume (login, profile) | idempoten; salinan lokal kredensial dan profil |

## Catatan Teknis

- Kata sandi di-hash dengan Argon2id. `login-service` bersifat CPU-bound sehingga diberi jatah CPU lebih besar dan minimal 2 replika.
- Access token JWT RS256 berumur 15 menit (klaim `sub`, `role`, `jti`, `exp`). Refresh token acak berumur 7 hari. Keduanya dikirim sebagai cookie `HttpOnly`, `Secure`, dan `SameSite=Strict`.
- Hasil `auth_request` di-cache gateway 30 detik per token, sehingga pencabutan token berlaku paling lambat 30 detik setelah logout.
- Kunci privat JWT dimuat dari Docker secret, tidak dari repositori.
- Rate limit `login` dan `register` ditegakkan di gateway (10 permintaan per menit per IP).
- `token-service` menggantikan stub token buatan T0.4 dan menjadi prioritas pemantauan karena berada di jalur sinkron semua permintaan terautentikasi.
- T1.6: tautan verifikasi dan reset berbatas waktu; email dikirim asinkron oleh `email-worker` (Mailpit pada lingkungan pengembangan). Dikerjakan Sabila, direview Azka.
- T1.7: nasib puisi milik akun yang dihapus harus diputuskan lebih dulu (pertimbangkan dampaknya ke `poem.deleted` dan Jejak Keaslian).

## Dependensi

T0.2 (pustaka event), T0.4 (gateway), T0.5 (kerangka frontend), T0.6 (kontrak event).

## Alur Git

Kerjakan langsung di `k1-akun`, awali commit dengan kode task (`T1.1: validasi username`). Gabungkan `main` ke branch ini setiap hari kerja dan buat PR ke `main` minimal tiap Jumat.