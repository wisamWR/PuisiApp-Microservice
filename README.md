# k4-komunitas: Komentar

Branch: `k4-komunitas` | Penanggung jawab: Zoya | Task: T4.1 | Frontend: bagian komentar di halaman Detail Puisi

## Cakupan

Diskusi pembaca pada puisi dengan pengaman terhadap spam dan komentar kasar.

## Layanan dan Komponen

| Layanan | Tipe | Data |
| --- | --- | --- |
| comment-service (`services/comment-service`, Node.js) | API + consumer | comment-db (PostgreSQL) + outbox, salinan status publikasi |

## Endpoint

| Metode | Path | Keterangan |
| --- | --- | --- |
| GET | `/api/poems/{id}/comments?page=` | daftar komentar berhalaman |
| POST | `/api/poems/{id}/comments` | maksimal 1.000 karakter, HTML dibuang |
| DELETE | `/api/comments/{id}` | hanya penulis komentar atau moderator |
| POST | `/api/comments/{id}/report` | membuka kasus di antrean moderator |

## Event

| Event | Peran |
| --- | --- |
| `comment.created`, `comment.deleted` | publish lewat outbox |
| `comment.reported` | publish; dikoordinasikan dengan T8.2 (boleh berupa pembukaan kasus lewat event) |
| `poem.published`, `poem.hidden`, `poem.deleted` | consume; menyimpan salinan status publikasi |

## Catatan Teknis

- Komentar hanya boleh dibuat pada puisi berstatus PUBLISHED. Komentar disembunyikan saat puisi HIDDEN atau DELETED, tanpa memanggil layanan lain secara sinkron.
- Sanitasi input di layanan penerima (buang HTML, batas 1.000 karakter) dan batas ukuran body di gateway.
- Rate limit komentar di gateway, misalnya 10 per menit per pengguna; melebihi batas dibalas 429. Tambahkan zona `limit_req` pada `infra/nginx/conf.d/comment.conf`.
- Otorisasi hapus diperiksa di layanan: pengguna lain tidak dapat menghapus komentar orang lain. Peran moderator dibaca dari header `X-User-Role` yang diisi gateway.
- Daftarkan skema event dan layanan baru di `/contracts/events` dan katalog layanan.

## Kriteria Selesai

- Komentar pada puisi yang disembunyikan tidak tampil.
- Pengguna lain tidak bisa menghapus komentar orang lain.
- Melewati rate limit dibalas 429.

## Dependensi

T0.6 (kontrak event), T2.2 (event publikasi), T8.2 (antrean kasus untuk laporan komentar).

## Alur Git

Kerjakan langsung di `k4-komunitas`, awali commit dengan kode task (`T4.1: endpoint komentar`). Gabungkan `main` ke branch ini setiap hari kerja dan buat PR ke `main` minimal tiap Jumat.