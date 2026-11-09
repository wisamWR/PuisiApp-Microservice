# k9-suara: Upvote, Downvote, dan Peringkat

Branch: `k9-vote` | Penanggung jawab: Raffa | Task: T9.1 sampai T9.3 | Frontend: tombol upvote dan downvote

## Cakupan

Pemberian suara yang bergelombang (write burst), penyimpanan permanen secara write-behind, dan perhitungan skor peringkat.

## Layanan dan Komponen

| Layanan | Tipe | Data | Task |
| --- | --- | --- | --- |
| vote-service | API | vote-live (Redis hash), salinan kepemilikan dan status publikasi | T9.1 |
| vote-persist-worker | worker | vote-db (PostgreSQL) | T9.2 |
| ranking-worker | worker | ranking-store (Redis hash) | T9.3 |
| tombol vote di UI | frontend | tampilan optimistik | T9.3 |

## Endpoint

| Metode | Path | Keterangan |
| --- | --- | --- |
| PUT | `/api/poems/{id}/vote` | body `nilai` = 1, −1, atau 0 (tarik suara); 200 berisi skor tampil, dilayani dari Redis |

## Event

| Event | Peran |
| --- | --- |
| `vote.cast` | publish (vote-service; `nilai_lama`, `nilai_baru`), consume (vote-persist, ranking) |
| `poem.score.updated` | publish (ranking-worker), consume (poem-query, mood-feed, theme-feed) |
| `poem.submitted`, `poem.published`, `poem.hidden`, `poem.deleted` | consume (vote-service; salinan pemilik dan status) |

## Catatan Teknis

- Satu suara per pengguna per puisi adalah satu invarian, sehingga `vote-service` tetap satu layanan. Operasi inti adalah satu skrip Lua atomik di Redis: `HSET vote:{poem_id} user nilai` sambil mengembalikan nilai lama.
- Aturan penolakan: pemilik puisi tidak dapat memberi suara pada puisinya (dari salinan `poem.submitted`), dan suara hanya diterima pada puisi yang sudah terbit.
- Rate limit 30 suara per menit per pengguna: zona `limit_req` di gateway berbasis cookie token, ditegakkan ulang di layanan memakai Redis. Akun berumur kurang dari 24 jam diberi bobot rendah dalam peringkat untuk mengurangi brigading.
- Jumlah downvote tidak memicu moderasi otomatis.
- `vote-persist-worker` mengambil batch 200 pesan atau 1 detik, melakukan UPSERT ke `vote-db`, dan hanya melakukan ack setelah commit. Konsumen bersifat idempoten.
- Satu-satunya data yang untuk sementara hanya ada di Redis adalah suara yang belum dipersist, dan data ini juga tercatat di queue `q.vote-persist`.
- Peringkat memakai batas bawah interval kepercayaan Wilson dengan z = 1,96: `W = (p̂ + z²/2n − z·√(p̂(1−p̂)/n + z²/4n²)) / (1 + z²/n)`. Contoh: 2 upvote tanpa downvote menghasilkan 0,342; 10 upvote dan 1 downvote menghasilkan 0,623; 90 upvote dan 10 downvote menghasilkan 0,826.
- Antarmuka menampilkan hasil optimistik lalu menyesuaikan setelah respons. Tampilan publik hanya memuat skor gabungan; rincian upvote dan downvote hanya terlihat oleh penulis.
- Target pengujian beban: sekitar 200 suara per detik (uji lokal dahulu; pengukuran resmi di T10.2).

## Dependensi

T0.2, T0.6, T2.1 dan T2.2 (salinan kepemilikan dan status; uji awal memakai contoh event dari T0.10).

## Alur Git

Kerjakan langsung di `k9-suara`, awali commit dengan kode task (`T9.1: skrip lua vote`). Gabungkan `main` ke branch ini setiap hari kerja dan buat PR ke `main` minimal tiap Jumat.