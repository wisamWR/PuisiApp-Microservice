# k7-keaslian: Plagiarisme dan Jejak Keaslian

Branch: `k7-keaslian` | Penanggung jawab: Raffa | Task: T7.1 sampai T7.4 | Frontend: panel Jejak Keaslian dan lencana level originalitas

## Cakupan

Deteksi kemiripan teks, penetapan level originalitas, kalibrasi ambang, dan pencatatan Jejak Keaslian (rantai hash SHA-256).

## Layanan dan Komponen

| Layanan | Tipe | Data | Task |
| --- | --- | --- | --- |
| fingerprint-worker | worker, stateless, CPU-bound | tanpa state | T7.1 |
| similarity-worker | worker, ber-state | similarity-db (PostgreSQL): signature dan bucket LSH | T7.2 |
| dataset dan kalibrasi | skrip evaluasi | dataset berlabel | T7.3 |
| authorship-worker | worker | authorship-db (PostgreSQL, append-only) | T7.4 |
| authorship-query-service | API | authorship-read-db | T7.4 |

## Endpoint

| Metode | Path | Keterangan |
| --- | --- | --- |
| GET | `/api/poems/{id}/authorship` | tabel versi dan hash rantai (JSON) |
| GET | `/api/poems/{id}/authorship/certificate` | sertifikat yang dapat diunduh (PDF) |

## Event

| Event | Peran |
| --- | --- |
| `poem.submitted`, `poem.revised` | consume (fingerprint dan authorship) |
| `poem.fingerprint.created` | publish (fingerprint), consume (similarity) |
| `poem.similarity.scored` | publish (similarity), consume (publication, poem-query, processing-tracker, case-queue) |
| `authorship.recorded` | publish (authorship), consume (processing-tracker, authorship-query, evidence) |

## Catatan Teknis

- Fingerprint: normalisasi NFC, huruf kecil, buang tanda baca dan stopword; shingle 3 kata; signature MinHash 128 nilai untuk puisi utuh dan untuk setiap bait.
- Similarity: LSH 32 band × 4 baris. Peluang menjadi kandidat `P(s) = 1 − (1 − s⁴)³²` (0,050 untuk s=0,2; 0,564 untuk 0,4; 0,873 untuk 0,5). Kandidat dihitung Jaccard dan containment; skor akhir adalah nilai terbesar pada tingkat puisi maupun bait.
- Level originalitas: ORISINAL (<0,20), TERINSPIRASI (0,20 sampai 0,49), MIRIP (0,50 sampai 0,79), DUGAAN_JIPLAKAN (≥0,80). Puisi dengan kurang dari 15 shingle dibatasi paling tinggi pada MIRIP dan tidak pernah ditahan otomatis.
- `poem.similarity.scored` menjadi gerbang publikasi: puisi tidak terbit tanpa event ini (jalur kritis). Pesan `x-delivery-limit=5` dan DLQ wajib dipantau.
- Pemisahan fingerprint dan similarity disengaja: fingerprint murni CPU-bound dan mudah direplikasi, sedangkan similarity memegang indeks seluruh repositori di basis data, bukan di memori proses.
- T7.3: dataset berlabel (asli, terinspirasi, parafrase, salinan) dan tabel presisi/recall per level. Ambang di konfigurasi similarity-worker diperbarui bila perlu; ambang awal belum terkalibrasi.
- Jejak Keaslian: `h_i = SHA256(i ‖ poem_id ‖ versi ‖ SHA256(teks) ‖ t_i ‖ h_{i−1})` dengan `h_0` berupa 64 karakter nol. Tabel `authorship_record` hanya mengizinkan INSERT (`REVOKE UPDATE, DELETE`) dan memiliki `UNIQUE(poem_id, versi)`. Satu-satunya penulis tabel ini adalah `authorship-worker` agar rantai tercatat berurutan.
- Batasan fitur dinyatakan eksplisit di UI dan sertifikat: Jejak Keaslian hanya membuktikan kapan teks tercatat di platform, bukan siapa penulis aslinya dan bukan sertifikat hak cipta.
- Publik hanya melihat label level; skor dan puisi pembanding hanya untuk penulis dan moderator.

## Dependensi

T0.2, T0.6, T2.1 (event `poem.submitted`; uji awal memakai contoh event dari T0.10).

## Alur Git

Kerjakan langsung di `k7-keaslian`, awali commit dengan kode task (`T7.1: minhash`). Gabungkan `main` ke branch ini setiap hari kerja dan buat PR ke `main` minimal tiap Jumat.