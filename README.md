# k3-jelajah: Jelajah dan Baca

Branch: `k3-jelajah` | Penanggung jawab: Azka | Task: T3.1 sampai T3.4 | Frontend: Beranda, Detail Puisi, Pencarian, Profil Penulis, Simpanan

## Cakupan

Antarmuka baca puisi: beranda, halaman detail yang menjadi wadah komponen kelompok lain, pencarian, profil penulis, serta bookmark dan bagikan tautan.

## Layanan dan Komponen

| Komponen | Data | Task |
| --- | --- | --- |
| Feed terbaru dan teratas, halaman Beranda dan Detail Puisi | memakai read model `poem-query` | T3.1 |
| search-service | indeks PostgreSQL full-text, dibangun dari event | T3.2 |
| endpoint dan halaman profil penulis | read model | T3.3 |
| bookmark-service | bookmark-db (PostgreSQL) | T3.4 |

## Endpoint

| Metode | Path | Keterangan |
| --- | --- | --- |
| GET | `/api/feed/latest`, `/api/feed/top` | feed publik; micro-cache Nginx |
| GET | `/api/search?q=&type=` | pencarian judul, penulis, kata kunci |
| GET | `/api/authors/{username}` | nama tampil, bio, jumlah puisi, daftar puisi terbit |
| bookmark | endpoint simpan dan hapus simpanan | tombol simpan dan bagikan |

Nama path feed dan bookmark ditetapkan saat implementasi dan didaftarkan di OpenAPI.

## Event

| Event | Peran |
| --- | --- |
| `poem.published`, `poem.hidden`, `poem.deleted` | consume (indeks pencarian dan feed) |
| `poem.keywords.extracted` | consume (indeks pencarian berdasarkan kata kunci) |
| `user.profile.updated` | consume (nama tampil penulis) |

## Catatan Teknis

- Halaman Detail Puisi menyediakan slot komponen untuk kelompok lain: vote (k9), komentar (k4), laporan (k8), Jejak Keaslian (k7), alur emosi (k5). Susun kontrak props komponen sejak awal agar kelompok lain dapat mendaftarkannya tanpa mengubah halaman.
- Feed publik tidak bergantung pada identitas pengguna, sehingga aman di-cache Nginx selama 3 detik dengan `proxy_cache_lock` dan `proxy_cache_use_stale updating`.
- Tampilan hanya memuat puisi berstatus PUBLISHED. Indeks pencarian harus menghapus entri saat menerima `poem.hidden` atau `poem.deleted`.
- Karena T3.1 dimulai sebelum `poem-query-service` selesai, kembangkan terhadap OpenAPI dan mock server dari T0.6, lalu uji dengan layanan asli sebagai syarat integrasi.
- T3.4: halaman bagikan perlu HTML sisi server dengan meta Open Graph karena crawler media sosial tidak menjalankan JavaScript. Dikerjakan Raffa, direview Azka.

## Dependensi

T0.5, T0.6, T1.4 (profil), T2.2, T2.3, T6.1 (kata kunci untuk pencarian).

## Alur Git

Kerjakan langsung di `k3-jelajah`, awali commit dengan kode task (`T3.1: halaman detail`). Gabungkan `main` ke branch ini setiap hari kerja dan buat PR ke `main` minimal tiap Jumat.