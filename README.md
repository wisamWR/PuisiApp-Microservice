# k6-tema: Kata Kunci dan Tema

Branch: `k6-tema` | Penanggung jawab: Sabila | Task: T6.1 sampai T6.3 | Frontend: halaman Jelajah Tema

## Cakupan

Auto-tagging kata kunci, ekstraksi tema, dan feed per tema.

## Layanan dan Komponen

| Layanan | Tipe | Data | Task |
| --- | --- | --- | --- |
| keyword-worker (Python) | worker | keyword-db (MongoDB) | T6.1 |
| theme-worker (Python) | worker | theme-db (MongoDB) | T6.2 |
| theme-feed-service | API + consumer indeks | theme-index (Redis sorted set) | T6.3 |

## Endpoint

| Metode | Path | Keterangan |
| --- | --- | --- |
| GET | `/api/feed/theme/{tema}?page=` | 200 dari Redis |
| GET | daftar tema | untuk halaman Jelajah Tema (path ditetapkan saat implementasi) |

## Event

| Event | Peran |
| --- | --- |
| `poem.submitted`, `poem.revised` | consume (keyword-worker dan theme-worker, masing-masing queue sendiri) |
| `poem.keywords.extracted` | publish (keyword-worker) |
| `poem.themes.extracted` | publish (theme-worker) |
| `poem.published`, `poem.hidden`, `poem.deleted`, `poem.score.updated` | consume (theme-feed) |

## Catatan Teknis

- `keyword-worker`: normalisasi, buang stopword, stemming Sastrawi, bobot TF-IDF. Statistik frekuensi dokumen dimiliki dan diperbarui sendiri oleh `keyword-db` setiap puisi baru diproses. Lima kata berbobot tertinggi menjadi tag otomatis. Kata kunci manual dari penulis disimpan terpisah dan tidak ditimpa.
- `theme-worker`: kamus tema berbobot (rindu, kesepian, alam, perjuangan, keluarga, religius, lainnya). Tema dengan skor kecocokan tertinggi menjadi tema utama; tema kedua dicatat sebagai pendamping bila skornya minimal setengah dari tema utama.
- Kedua worker bersifat idempoten (`processed_event` atau penulisan upsert), mengabaikan versi yang lebih lama berdasarkan `aggregate_version`, dan memakai retry backoff dengan jitter serta DLQ per queue.
- `theme-feed-service` membangun `feed:theme:{tema}` dari event, tanpa TTL, dan hanya memuat puisi yang sudah terbit dan sudah memiliki hasil ekstraksi tema.
- Tambahkan model dan data kamus sebagai berkas konfigurasi sehingga dapat diubah tanpa mengubah kontrak event.

## Dependensi

T0.2 (pustaka event Python), T0.6, T2.2.

## Alur Git

Kerjakan langsung di `k6-tema`, awali commit dengan kode task (`T6.1: tf-idf sastrawi`). Gabungkan `main` ke branch ini setiap hari kerja dan buat PR ke `main` minimal tiap Jumat.